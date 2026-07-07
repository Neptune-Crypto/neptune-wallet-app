use std::collections::HashMap;
use std::collections::HashSet;
use std::path::Path;
use std::path::PathBuf;
use std::sync::atomic::AtomicU64;
use std::sync::atomic::Ordering;

use anyhow::bail;
use anyhow::ensure;
use anyhow::Context;
use anyhow::Result;
use itertools::Itertools;
use neptune_cash::api::export::AdditionRecord;
use neptune_cash::api::export::KeyType;
use neptune_cash::api::export::NativeCurrencyAmount;
use neptune_cash::api::export::Network;
use neptune_cash::api::export::Timestamp;
use neptune_cash::api::export::Tip5;
use neptune_cash::api::export::Utxo;
use neptune_cash::application::config::data_directory::DataDirectory;
use neptune_cash::prelude::tasm_lib::prelude::Digest;
use neptune_cash::state::wallet::incoming_utxo::IncomingUtxo;
use neptune_cash::state::wallet::wallet_entropy::WalletEntropy;
use neptune_cash::state::wallet::wallet_state::IncomingUtxoRecoveryData;
use neptune_cash::util_types::mutator_set::commit;
use neptune_cash::util_types::mutator_set::removal_record::absolute_index_set::AbsoluteIndexSet;
use num_traits::Zero;
use pending::TransactionUpdater;
use rayon::prelude::*;
use serde::Deserialize;
use serde::Serialize;
use sqlx::Pool;
use sqlx::Sqlite;
use sqlx::SqliteConnection;
use strum::IntoEnumIterator;
use tracing::*;
use wallet_file::wallet_dir_by_id;
use wallet_state_table::UtxoBlockInfo;
use wallet_state_table::UtxoDbData;

use crate::config::wallet::ScanConfig;
use crate::config::wallet::WalletConfig;
use crate::config::Config;
use crate::rpc_client;
use crate::wallet::wallet_block::WalletBlock;

pub(crate) mod balance;
pub(crate) mod fake_archival_state;
pub(crate) mod fork;
pub(crate) mod incoming_randomness;
mod input;
pub(crate) mod wallet_block;
pub(crate) use input::InputSelectionRule;
pub(crate) mod block_cache;
mod key_cache;
pub(crate) mod keys;
mod pending;
mod spend;
pub(crate) mod sync;
pub(crate) mod wallet_file;
mod wallet_state_table;

pub(crate) struct WalletState {
    key: WalletEntropy,
    scan_config: ScanConfig,
    pub(crate) network: Network,

    /// The index of the *next* derived address. Equivalently the number of
    /// derived addresses of this type.
    symmetric_key_index: AtomicU64,

    /// The index of the *next* derived address. Equivalently the number of
    /// derived addresses of this type.
    generation_key_index: AtomicU64,

    /// The index of the *next* derived address. Equivalently the number of
    /// derived addresses of this type.
    ec_hybrid_key_index: AtomicU64,

    /// The index of the *next* derived address. Equivalently the number of
    /// derived addresses of this type.
    viewing_address_key_index: AtomicU64,

    /// The number of keys that will be looked ahead when scanning for UTXOs
    num_future_keys: AtomicU64,
    pub(crate) pool: Pool<Sqlite>,
    updater: TransactionUpdater,
    key_cache: key_cache::KeyCache,
    id: i64,
    spend_lock: tokio::sync::Mutex<()>,
}

impl WalletState {
    pub(crate) async fn new_from_config(config: &Config) -> Result<Self> {
        let wallet_config = config.get_current_wallet().await?;
        let database = Self::wallet_database_path(config, wallet_config.id).await?;
        Self::new(wallet_config, &database).await
    }

    pub(crate) async fn wallet_database_path(config: &Config, id: i64) -> Result<PathBuf> {
        let wallet_dir = Self::wallet_path(config, id).await?;
        DataDirectory::create_dir_if_not_exists(&wallet_dir).await?;
        Ok(wallet_dir.join("wallet_state.db"))
    }

    async fn wallet_database_internal(database: &Path) -> Result<Pool<Sqlite>> {
        let options = sqlx::sqlite::SqliteConnectOptions::new()
            .filename(database)
            .create_if_missing(true);

        sqlx::SqlitePool::connect_with(options)
            .await
            .map_err(|err| {
                anyhow::anyhow!(
                    "Could not connect to database: {err}. Path: {}",
                    database.to_string_lossy()
                )
            })
    }

    pub(crate) async fn wallet_database_connection(
        config: &Config,
        id: i64,
    ) -> Result<Pool<Sqlite>> {
        let database = Self::wallet_database_path(config, id).await?;
        Self::wallet_database_internal(&database).await
    }

    pub(crate) async fn wallet_path(config: &Config, id: i64) -> Result<PathBuf> {
        let data_dir = config.get_data_dir().await?;
        let network = config.get_network().await?;
        let wallet_dir = wallet_dir_by_id(&data_dir, network, id);
        Ok(wallet_dir)
    }

    pub(crate) async fn new(wallet_config: WalletConfig, database: &Path) -> Result<Self> {
        let pool = Self::wallet_database_internal(database).await?;

        let num_future_keys = wallet_config.scan_config.num_keys;

        let updater = TransactionUpdater::new(pool.clone()).await?;

        let state = Self {
            key: wallet_config.key,
            scan_config: wallet_config.scan_config,
            network: wallet_config.network,
            symmetric_key_index: AtomicU64::new(1),
            generation_key_index: AtomicU64::new(1),
            ec_hybrid_key_index: AtomicU64::new(1),
            viewing_address_key_index: AtomicU64::new(1),
            num_future_keys: AtomicU64::new(num_future_keys),
            pool: pool.clone(),
            updater,
            key_cache: key_cache::KeyCache::new(),
            id: wallet_config.id,
            spend_lock: tokio::sync::Mutex::new(()),
        };

        state.migrate_tables().await.context("migrate_tables")?;
        for key_type in KeyType::iter() {
            let val = state.persisted_key_index(key_type).await?;
            state.set_ephemeral_key_index(key_type, val, Ordering::Relaxed);
        }

        debug!("Wallet state initialized");

        Ok(state)
    }

    pub(crate) async fn start_height(&self) -> Result<u64> {
        if let Some(tip) = self.get_tip().await? {
            return Ok(tip.0 + 1);
        }
        info!(
            "new sync, using scan_config height: {}",
            self.scan_config.start_height
        );
        Ok(self.scan_config.start_height)
    }

    async fn store_all_key_indices(&self) -> Result<()> {
        for key_type in KeyType::iter() {
            let value = self.ephemeral_key_index(key_type);
            self.set_key_index(key_type, value).await?;
        }

        Ok(())
    }

    pub(crate) async fn import_randomness(
        &self,
        incoming_utxos: Vec<IncomingUtxoRecoveryData>,
    ) -> Result<NativeCurrencyAmount> {
        // Deduplicate recovery data, such that repeated entries don't lead to
        // wrong balances.
        info!("Num UTXOs in incoming randomness: {}", incoming_utxos.len());
        let incoming_utxos = Self::deduplicate_recovery_data(incoming_utxos);
        info!("After deduplication: {}", incoming_utxos.len());

        // Bump key indices to ensure wallet tracks enough keys
        let key_indices = self.max_key_index_used(&incoming_utxos);
        self.bump_key_indices(key_indices);

        // Bump key indices immediately, to match key count with imported
        // randomness.
        self.store_all_key_indices().await?;

        // Only consider not-yet-claimed UTXOs
        let incoming_utxos = self.not_yet_claimed(incoming_utxos).await?;
        info!(
            "Found {} not-yet-claimed UTXOs in recovery data",
            incoming_utxos.len()
        );

        // Only import UTXOs that this wallet has keys for
        let num_utxos_unclaimed = incoming_utxos.len();
        let incoming_utxos = self.have_matching_keys(incoming_utxos);
        info!(
            "Found {} not-yet-claimed UTXOs with known keys",
            incoming_utxos.len()
        );
        if incoming_utxos.len() != num_utxos_unclaimed {
            error!("Incoming UTXO recovery data contains data for which no keys are known.");
        }

        // Only import not-yet-spent UTXOs
        let incoming_utxos = Self::filter_unspent_utxos(incoming_utxos, |absis| async move {
            rpc_client::node_rpc_client()
                .are_bloom_indices_set(absis)
                .await
        })
        .await?;
        let value = incoming_utxos
            .iter()
            .map(|x| x.utxo.get_native_currency_amount())
            .fold(NativeCurrencyAmount::zero(), |acc, x| acc + x);
        info!(
            "Found {} not-yet-claimed and unspent UTXOs for a value of {value} NPT.",
            incoming_utxos.len()
        );

        // Only import UTXOs that were actually added to the AOCL
        let mut confirmed_valid = vec![];
        for incoming in incoming_utxos {
            let index_set = incoming.abs_i();

            let aocl_index = incoming.aocl_index;
            let msmps_recovery_data = match rpc_client::node_rpc_client()
                .restore_msmps(vec![index_set])
                .await
            {
                Ok(msmp) => msmp,
                Err(_) => {
                    warn!("Failed to restore membership proof for AOCL index {aocl_index}");
                    continue;
                }
            };
            ensure!(
                1 == msmps_recovery_data.membership_proofs.len(),
                "Expected only 1 MSMP to be returned by the server."
            );

            let membership_proof = match msmps_recovery_data.membership_proofs[0]
                .clone()
                .extract_ms_membership_proof(
                    incoming.aocl_index,
                    incoming.sender_randomness,
                    incoming.receiver_preimage,
                ) {
                Ok(msmp) => msmp,
                Err(err) => bail!(
                    "Server returned bad mutator set membership proof recovery data: {}",
                    err
                ),
            };

            let item = Tip5::hash(&incoming.utxo);
            let valid = msmps_recovery_data
                .tip_mutator_set
                .verify(item, &membership_proof);

            // If valid keep it
            if valid {
                confirmed_valid.push(incoming);
            } else {
                error!("Recovery data contains UTXOs that cannot be claimed. Skipping those. AOCL index: {}", incoming.aocl_index);
            }
        }

        info!("Importing {} confirmed valid UTXOs", confirmed_valid.len());

        let mut new_utxos = vec![];
        let mut total_recovered = NativeCurrencyAmount::zero();
        for recovery_data in confirmed_valid {
            let resp = rpc_client::node_rpc_client()
                .find_utxo_origin(recovery_data.addition_record())
                .await?;

            let Some((block_digest, block_header)) = resp else {
                error!("Unable to find origin of UTXO from imported randomness");
                continue;
            };

            total_recovered += recovery_data.utxo.get_native_currency_amount();
            let new_utxo = UtxoDbData {
                id: 0,
                hash: Tip5::hash(&recovery_data.utxo).to_hex(),
                recovery_data,
                spent_in_block: None,
                confirmed_in_block: UtxoBlockInfo {
                    block_height: block_header.height.into(),
                    block_digest,
                    timestamp: block_header.timestamp,
                },
                confirm_height: block_header.height.value().try_into()?,
                spent_height: None,
                confirmed_txid: None,
                spent_txid: None,
            };

            new_utxos.push(new_utxo);
        }

        info!("Importing {} new UTXOs to the wallet", new_utxos.len());

        let mut tx = self.pool.begin().await?;
        self.append_utxos(&mut tx, new_utxos).await?;

        tx.commit().await?;

        Ok(total_recovered)
    }

    pub(crate) async fn update_new_tip(
        &self,
        block: &WalletBlock,
        should_update: bool,
    ) -> Result<Option<u64>> {
        let height: u64 = block.kernel.header.height.into();

        let mut tx = self.pool.begin().await?;

        let _spend_guard = self.spend_lock.lock().await;

        debug!("check fork");
        if let Some((luca_height, luca_digest)) =
            self.find_rollback_luca(block).await.context("check fork")?
        {
            info!(
                "Fork detected! Reorganizing: reorganize_to_height: {luca_height} {luca_digest:x}"
            );
            self.roll_back(&mut tx, luca_height, luca_digest)
                .await
                .context("reorganize_to_height")?;
            tx.commit().await.context("commit db")?;
            return Ok(Some(luca_height));
        }
        debug!("update mutator set");

        let addition_records = block.all_addition_records();

        debug!("get removal_records");

        debug!("scan for incoming utxo");
        let incommings = self.par_scan_for_incoming_utxo(block).await?;
        let mut recovery_datas = Vec::with_capacity(incommings.len());

        let incoming = incommings
            .into_iter()
            .map(|v| (v.addition_record(), v))
            .collect::<std::collections::HashMap<_, _>>();

        debug!("iterate addition records");
        let num_aocl_leafs_prior_to_this_block = block.num_aocl_leafs_prior();
        for (aocl_leaf_index, addition_record) in
            (num_aocl_leafs_prior_to_this_block..).zip(addition_records.iter())
        {
            if let Some(incoming_utxo) = incoming.get(addition_record) {
                let r = incoming_utxo_recovery_data_from_incomming_utxo(
                    incoming_utxo.clone(),
                    aocl_leaf_index,
                );
                assert_eq!(
                    *addition_record,
                    r.addition_record(),
                    "Addition record of wallet's UTXO must match that from block"
                );

                if !r.utxo.all_type_script_states_are_valid() {
                    warn!("Received UTXO with unresolvable type script");
                    continue;
                }

                let timelock_info = if let Some(timelock) = incoming_utxo.utxo.release_date() {
                    if timelock > Timestamp::now() {
                        timelock.standard_format()
                    } else {
                        "released".to_owned()
                    }
                } else {
                    "none".to_owned()
                };
                info!(
                    "Received UTXO in block {height}. Value: {}. Timelock: {timelock_info}",
                    incoming_utxo.utxo.get_native_currency_amount(),
                );

                recovery_datas.push(r);
            }
        }

        debug!("append utxos");
        let mut db_datas = vec![];
        for recovery_data in recovery_datas {
            let digest = Tip5::hash(&recovery_data.utxo);
            let db_data = UtxoDbData {
                id: 0,
                hash: digest.to_hex(),
                recovery_data,
                spent_in_block: None,
                confirmed_in_block: UtxoBlockInfo {
                    block_height: height,
                    block_digest: block.hash,
                    timestamp: block.kernel.header.timestamp,
                },
                spent_height: None,
                confirm_height: height.try_into()?,
                confirmed_txid: None,
                spent_txid: None,
            };
            db_datas.push(db_data);
        }

        self.append_utxos(&mut tx, db_datas).await?;

        debug!("scan for spent utxos");
        let spents = self.scan_for_spent_utxos(&mut tx, block).await?;
        debug!("Found {} spent UTXOs", spents.len());

        let block_info = UtxoBlockInfo {
            block_height: block.kernel.header.height.into(),
            block_digest: block.hash,
            timestamp: block.kernel.header.timestamp,
        };

        let spent_updates = spents
            .iter()
            .map(|v| (v.2, block_info.clone()))
            .collect_vec();

        debug!("update spent utxos");
        self.update_spent_utxos(&mut tx, spent_updates).await?;

        debug!("scan for expected utxos");
        // update expected utxo with txid
        let expected = self
            .scan_for_expected_utxos(block)
            .await?
            .into_iter()
            .map(|(recovery, txid)| {
                let digest = Tip5::hash(&recovery.utxo);
                (digest, txid)
            })
            .collect_vec();

        debug!("update utxos with expected utxos");
        self.update_utxos_with_expected_utxos(&mut tx, expected, height.try_into()?)
            .await?;

        debug!(
            "set tip {} {:x}",
            block.kernel.header.height.value(),
            block.hash
        );
        self.set_tip(&mut tx, (block.kernel.header.height.into(), block.hash))
            .await?;

        tx.commit().await?;

        self.clean_old_expected_utxos().await?;

        if should_update {
            self.updater.update_transactions(self).await;
        }

        if height.is_multiple_of(20) {
            info!("sync finished: {}", height);
        } else {
            debug!("sync finished: {}", height);
        }

        Ok(None)
    }

    /// Return all UTXOs we *expect* to receive in the block.
    ///
    /// Caller must verify that they are *actually* present by comparing the
    /// returned list with the list of addition records in the block before
    /// inserting UTXOs in the database and updating balances.
    async fn par_scan_for_incoming_utxo(
        &self,
        block: &WalletBlock,
    ) -> anyhow::Result<Vec<IncomingUtxo>> {
        let transaction = block.kernel.body.transaction_kernel();

        let all_addition_records: HashSet<_> = block.all_addition_records().into_iter().collect();

        let spending_keys = self.known_and_future_keys();

        let mut all_announced = vec![];
        for (key_type, keys) in spending_keys {
            let incoming: Vec<_> = keys
                .par_iter()
                .map(|(key_idx, key)| {
                    let utxos: Vec<_> = key.scan_for_announced_utxos(transaction);
                    let actually_received = utxos
                        .iter()
                        .any(|utxo| all_addition_records.contains(&utxo.addition_record()));
                    if !utxos.is_empty() && actually_received {
                        // Only bump index if block actually contains this output.

                        let new_index = *key_idx + 1;
                        match key_type {
                            KeyType::Generation => self
                                .generation_key_index
                                .fetch_max(new_index, Ordering::SeqCst),
                            KeyType::Symmetric => self
                                .symmetric_key_index
                                .fetch_max(new_index, Ordering::SeqCst),
                            KeyType::EcHybrid => self
                                .ec_hybrid_key_index
                                .fetch_max(new_index, Ordering::SeqCst),
                            KeyType::ViewingAddress => self
                                .viewing_address_key_index
                                .fetch_max(new_index, Ordering::SeqCst),
                            _ => todo!(),
                        };
                    }

                    utxos
                })
                .flatten()
                .collect();

            all_announced.extend(incoming);
        }

        let (own_guesser_address, guesser_key_preimage) = {
            let own_guesser_key = self.key.guesser_fee_key();
            (
                own_guesser_key.to_address(),
                own_guesser_key.receiver_preimage(),
            )
        };
        let was_guessed_by_us = block
            .kernel
            .header
            .was_guessed_by(&own_guesser_address.into());

        let gusser_incoming_utxos = if was_guessed_by_us {
            let sender_randomness = block.hash;
            block
                .kernel
                .guesser_fee_utxos()
                .expect("Exported block must have guesser fee UTXOs")
                .into_iter()
                .map(|utxo| IncomingUtxo {
                    utxo,
                    sender_randomness,
                    receiver_preimage: guesser_key_preimage,
                    is_guesser_fee: true,
                })
                .collect_vec()
        } else {
            vec![]
        };

        let expected_utxos = self
            .scan_for_expected_utxos(block)
            .await?
            .into_iter()
            .map(|(utxo, _)| utxo)
            .collect_vec();

        // Ensure no double count in case UTXO is both expected and announced.
        // This is done by stroring all incoming UTXOs in a hash set, thus
        // removing duplicates.
        let receive: HashSet<_> = all_announced
            .into_iter()
            .chain(gusser_incoming_utxos)
            .chain(expected_utxos)
            .collect();

        // Bump derivation indices. Must be done *after* the iterators above
        // have been consumed.
        self.store_all_key_indices().await?;

        Ok(receive.into_iter().collect())
    }

    /// Return a list of UTXOs spent by this wallet in the transaction
    ///
    /// Returns a list of tuples (utxo, absolute-index-set, index-into-database).
    async fn scan_for_spent_utxos(
        &self,
        tx: &mut SqliteConnection,
        block: &WalletBlock,
    ) -> Result<Vec<(Utxo, AbsoluteIndexSet, i64)>> {
        let confirmed_absolute_index_sets: HashSet<_> = block
            .kernel
            .body
            .transaction_kernel()
            .inputs
            .iter()
            .map(|rr| rr.absolute_indices)
            .collect();

        let monitored_utxos = self.get_unspent_utxos(tx).await?;

        let mut spent_own_utxos = vec![];

        for monitored_utxo in monitored_utxos {
            let utxo: UtxoRecoveryData = monitored_utxo.recovery_data;

            if confirmed_absolute_index_sets.contains(&utxo.abs_i()) {
                spent_own_utxos.push((utxo.utxo.clone(), utxo.abs_i(), monitored_utxo.id));
            }
        }

        Ok(spent_own_utxos)
    }

    // returns (IncomingUtxo, txid) pairs
    pub(crate) async fn scan_for_expected_utxos(
        &self,
        block: &WalletBlock,
    ) -> Result<Vec<(IncomingUtxo, String)>> {
        let outputs = block.all_addition_records();

        let expected_utxos = self.expected_utxos().await?;
        let eu_map: HashMap<_, _> = expected_utxos
            .into_iter()
            .map(|eu| (eu.expected_utxo.addition_record, eu))
            .collect();

        let incommings = outputs
            .iter()
            .filter_map(move |a| {
                eu_map
                    .get(a)
                    .map(|eu| (IncomingUtxo::from(&eu.expected_utxo), eu.txid.to_owned()))
            })
            .collect_vec();
        Ok(incommings)
    }
}

impl From<IncomingUtxoRecoveryData> for UtxoRecoveryData {
    fn from(value: IncomingUtxoRecoveryData) -> Self {
        Self {
            utxo: value.utxo,
            sender_randomness: value.sender_randomness,
            receiver_preimage: value.receiver_preimage,
            aocl_index: value.aocl_index,
        }
    }
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
pub(crate) struct UtxoRecoveryData {
    pub(crate) utxo: Utxo,
    pub(crate) sender_randomness: Digest,
    pub(crate) receiver_preimage: Digest,
    pub(crate) aocl_index: u64,
}

impl UtxoRecoveryData {
    pub(crate) fn abs_i(&self) -> AbsoluteIndexSet {
        let utxo_digest = Tip5::hash(&self.utxo);

        AbsoluteIndexSet::compute(
            utxo_digest,
            self.sender_randomness,
            self.receiver_preimage,
            self.aocl_index,
        )
    }

    pub(crate) fn addition_record(&self) -> AdditionRecord {
        commit(
            Tip5::hash(&self.utxo),
            self.sender_randomness,
            self.receiver_preimage.hash(),
        )
    }
}

fn incoming_utxo_recovery_data_from_incomming_utxo(
    utxo: IncomingUtxo,
    num_aocl_leafs: u64,
) -> UtxoRecoveryData {
    let aocl_index = num_aocl_leafs;

    UtxoRecoveryData {
        utxo: utxo.utxo,
        sender_randomness: utxo.sender_randomness,
        receiver_preimage: utxo.receiver_preimage,
        aocl_index,
    }
}

#[cfg(test)]
mod tests {
    use std::range::Range;

    use neptune_cash::api::export::NativeCurrencyAmount;
    use neptune_cash::api::export::SpendingKey;
    use neptune_cash::application::json_rpc::core::model::wallet::block::RpcWalletBlock;
    use neptune_cash::protocol::consensus::block::Block;
    use num_traits::Zero;
    use tracing_test::traced_test;

    use super::*;
    use crate::tests::test_devnet_wallet;
    use crate::tests::test_wallet_db;
    use crate::tests::wallet_block_from_test_data;
    use crate::wallet::sync::SyncState;

    impl WalletState {
        fn get_future_spending_keys(&self) -> Vec<(u64, std::sync::Arc<SpendingKey>)> {
            let mut keys = vec![];
            for key_type in KeyType::iter() {
                let start = 0;
                let end = self.ephemeral_key_index(key_type) + 1;
                let end = end + self.scan_config.num_keys;
                let range = Range { start, end };

                keys.extend(self.keys(range, key_type));
            }

            keys
        }
    }

    #[traced_test]
    #[tokio::test]
    async fn print_future_addresses() {
        let network = Network::Main;
        let config = WalletConfig {
            id: 0,
            key: WalletEntropy::devnet_wallet(),
            scan_config: ScanConfig {
                num_keys: 60,
                start_height: 0,
                ..Default::default()
            },
            network,
        };

        let db_path = test_wallet_db().await;

        let wallet_state = WalletState::new(config, &db_path).await.unwrap();

        println!("Known addresses:");
        for key in wallet_state.all_known_keys() {
            println!("{}", key.to_address().to_display_bech32m(network).unwrap());
            println!(
                "receiver ID: {}; privacy_preimage: {}",
                key.receiver_identifier(),
                key.privacy_preimage()
            );
        }

        println!("Future addresses:");
        for (i, key) in wallet_state.get_future_spending_keys() {
            println!("{i}: {}", key.to_address().to_bech32m(network).unwrap());
            println!(
                "receiver ID: {}; privacy_preimage: {:x}",
                key.receiver_identifier(),
                key.privacy_preimage()
            );
        }
    }

    #[traced_test]
    #[tokio::test]
    async fn credits_utxo_to_gen_address_idx_1_and_2() {
        let network = Network::Main;
        let config = WalletConfig {
            id: 0,
            key: WalletEntropy::devnet_wallet(),
            scan_config: ScanConfig {
                num_keys: 100,
                start_height: 0,
                ..Default::default()
            },
            network,
        };
        let db_path = test_wallet_db().await;
        let wallet_state = WalletState::new(config.clone(), &db_path).await.unwrap();

        assert_eq!(
            1,
            wallet_state.ephemeral_key_index(KeyType::Generation),
            "Key index must be 1 prior to handling of block"
        );

        let num_checked_addrs_before = wallet_state.get_future_spending_keys().len();
        let mut block_height = 38260;
        let block_38260 = wallet_block_from_test_data(block_height).unwrap();

        wallet_state
            .update_new_tip(&block_38260, false)
            .await
            .unwrap();

        // Genesis block was never retrieved, so only income in block 38260
        // should be registered: 0.75 NPT.
        let three_quarters =
            NativeCurrencyAmount::coins(1).half() + NativeCurrencyAmount::coins(1).half().half();
        assert_eq!(three_quarters, wallet_state.get_balance().await.unwrap());
        assert_eq!(
            2,
            wallet_state.ephemeral_key_index(KeyType::Generation),
            "Key index must be 2 after handling block, as key with index 1 got a UTXO in it"
        );

        // Verify that bumping of keys was persisted.
        let wallet_state_persisted1 = WalletState::new(config.clone(), &db_path).await.unwrap();
        assert_eq!(
            2,
            wallet_state_persisted1.ephemeral_key_index(KeyType::Generation),
            "Persisted key index must match ephemeral key index"
        );

        // In block 38'289, the wallet sends 0.75 NPT, and receives 0.50 NPT.
        // Output is received on gen key with index 2.
        block_height += 1;
        while block_height < 38290 {
            let block = wallet_block_from_test_data(block_height).unwrap();
            wallet_state.update_new_tip(&block, false).await.unwrap();
            block_height += 1;
        }

        assert_eq!(
            NativeCurrencyAmount::coins(1).half(),
            wallet_state.get_balance().await.unwrap()
        );
        assert_eq!(
            3,
            wallet_state.ephemeral_key_index(KeyType::Generation),
            "Key index must be 3 after receiving UTXO to key with index 2"
        );

        // Verify that bumping of keys was persisted.
        let wallet_state_persisted2 = WalletState::new(config, &db_path).await.unwrap();
        assert_eq!(
            3,
            wallet_state_persisted2.ephemeral_key_index(KeyType::Generation),
            "Persisted key index must match ephemeral key index"
        );
        let num_checked_addrs_after = wallet_state.get_future_spending_keys().len();
        assert_eq!(
            num_checked_addrs_before + 2,
            num_checked_addrs_after,
            "Must check 2 more addresses since index was bumped by 2."
        );
    }

    #[traced_test]
    #[tokio::test]
    async fn credits_utxo_to_sym_address_idx_4() {
        let network = Network::Main;
        let config = WalletConfig {
            id: 0,
            key: WalletEntropy::devnet_wallet(),
            scan_config: ScanConfig {
                num_keys: 100,
                start_height: 0,
                recover_from_sym_digest_keys: false,
            },
            network,
        };

        let db_path = test_wallet_db().await;
        let wallet_state = WalletState::new(config.clone(), &db_path).await.unwrap();
        assert_eq!(
            1,
            wallet_state.ephemeral_key_index(KeyType::Symmetric),
            "Key index must be 1 prior to handling of block"
        );

        let block = wallet_block_from_test_data(38404).unwrap();

        let num_checked_addrs_before = wallet_state.get_future_spending_keys().len();
        wallet_state.update_new_tip(&block, false).await.unwrap();
        assert_eq!(
            5,
            wallet_state.ephemeral_key_index(KeyType::Symmetric),
            "Symmetric key index must be 5 after handling block, as key with index 4 got a UTXO in it"
        );

        // Verify that bumping of keys was persisted.
        let wallet_state_persisted = WalletState::new(config, &db_path).await.unwrap();
        assert_eq!(
            5,
            wallet_state_persisted.ephemeral_key_index(KeyType::Symmetric),
            "Persisted key index must match key index"
        );
        assert_eq!(
            num_checked_addrs_before + 4,
            wallet_state_persisted.get_future_spending_keys().len(),
            "Must check 4 more addresses since index was bumped by 4, persisted wallet."
        );
        assert_eq!(
            num_checked_addrs_before + 4,
            wallet_state.get_future_spending_keys().len(),
            "Must check 4 more addresses since index was bumped by 4, non-persisted wallet."
        );
        assert_eq!(
            NativeCurrencyAmount::coins(1).half().half(),
            wallet_state.get_balance().await.unwrap(),
            "Expected balance, non-persisted wallet"
        );
        assert_eq!(
            NativeCurrencyAmount::coins(1).half().half(),
            wallet_state_persisted.get_balance().await.unwrap(),
            "Expected balance, persisted wallet"
        );
    }

    #[traced_test]
    #[tokio::test]
    async fn recover_from_malformed_sym_address() {
        // I accidently sent to the address `sym_key.to_display_bech32m` instead
        // of `sym_key.to_bech32m` as I should have done. Luckily the former's
        // seed is just the hash of the latter. So we can recover funds from
        // both addresses. Setting the flag in scan-config allows for that.
        let network = Network::Main;
        let config = WalletConfig {
            id: 0,
            key: WalletEntropy::devnet_wallet(),
            scan_config: ScanConfig {
                num_keys: 100,
                start_height: 0,
                recover_from_sym_digest_keys: true,
            },
            network,
        };
        let db_path = test_wallet_db().await;
        let wallet_state = WalletState::new(config.clone(), &db_path).await.unwrap();

        let block = wallet_block_from_test_data(38333).unwrap();

        assert!(
            wallet_state.get_balance().await.unwrap().is_zero(),
            "Empty balance before applying block"
        );
        wallet_state.update_new_tip(&block, false).await.unwrap();
        assert!(
            !wallet_state.get_balance().await.unwrap().is_zero(),
            "Non-empty balance before applying block"
        );

        assert_eq!(
            5,
            wallet_state.ephemeral_key_index(KeyType::Symmetric),
            "Symmetric key index must be 5 after handling block, as key with index 4 got a UTXO in it"
        );
    }

    #[traced_test]
    #[tokio::test]
    async fn genesis_credits_devnet_wallet() {
        let network = Network::Main;
        let wallet_state = test_devnet_wallet().await;

        let genesis: RpcWalletBlock = (&Block::genesis(network)).into();
        let genesis: WalletBlock = genesis.into();
        let premine_keys = wallet_state.all_known_keys();
        println!("Num premine keys: {}", premine_keys.len());

        let expected_utxos = SyncState::check_premine_for_tests(network, &premine_keys);
        wallet_state
            .add_expected_utxo(expected_utxos)
            .await
            .unwrap();
        wallet_state.update_new_tip(&genesis, false).await.unwrap();

        assert_eq!(
            NativeCurrencyAmount::coins(20),
            wallet_state.get_balance().await.unwrap()
        );
    }
}
