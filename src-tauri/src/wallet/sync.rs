use std::sync::atomic::AtomicI8;
use std::sync::atomic::AtomicU64;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::Duration;

use anyhow::Context;
use anyhow::Result;
use neptune_cash::api::export::Network;
use neptune_cash::api::export::SpendingKey;
use neptune_cash::api::export::Timestamp;
use neptune_cash::protocol::consensus::block::Block;
use neptune_cash::state::wallet::expected_utxo::ExpectedUtxo;
use neptune_cash::state::wallet::expected_utxo::UtxoNotifier;
use neptune_cash::util_types::mutator_set::mutator_set_accumulator::MutatorSetAccumulator;
use serde::Serialize;
use tokio::select;
use tokio::sync::Mutex;
use tokio::sync::Notify;
use tokio::task::JoinHandle;
use tracing::*;

use super::fake_archival_state::FakeArchivalState;
use super::fake_archival_state::SnapshotReader;
use super::WalletState;
use crate::config::Config;
use crate::wallet::block_cache::BlockCacheImpl;
use crate::wallet::wallet_state_table::ExpectedUtxoData;

const SYNC_STOPPED: i8 = 0;
const SYNC_SYNCING: i8 = 1;
const SYNC_PAUSED: i8 = 2;
const SYNC_WAIT_PAUSE: i8 = 3;

pub const SYNC_BLOCK_BATCH_SIZE: u64 = 100;
pub struct SyncState {
    height: AtomicU64,
    updated_to_tip: AtomicI8,
    syncing: AtomicI8,
    fake_archival_state: FakeArchivalState,
    pub wallet: super::WalletState,
    cancel: AtomicI8,
    /// Used to notify the sync task to wake up and check for new blocks.
    waker: Notify,
    handler: Mutex<Option<JoinHandle<()>>>,
}

#[derive(Debug, Serialize)]
pub struct SyncStatus {
    pub height: u64,
    pub syncing: bool,
    pub updated_to_tip: bool,
}

static LAST_SYNC_EVENT_TIME: AtomicU64 = AtomicU64::new(0);

impl SyncState {
    pub async fn new(config: &Config) -> Result<Self> {
        let wallet = WalletState::new_from_config(config).await?;
        let data_dir = config.get_data_dir().await?;
        let snapshot_reader = match SnapshotReader::new(&data_dir).await {
            Ok(v) => {
                debug!("snapshot reader created : {:?}", v);
                Some(v)
            }
            Err(e) => {
                error!("failed to create snapshot reader: {:#?}", e);
                None
            }
        };

        let block_cache = if config.get_disk_cache().await? {
            info!("disk cache enabled");
            BlockCacheImpl::new_persist(&data_dir, config.get_network().await?, 200).await?
        } else {
            warn!("disk cache is disabled, this will cause performance issues");
            BlockCacheImpl::new_memory(200)
        };

        Ok(Self {
            height: AtomicU64::new(0),
            updated_to_tip: AtomicI8::new(0),
            syncing: AtomicI8::new(0),
            fake_archival_state: FakeArchivalState::new(
                block_cache,
                wallet.network,
                snapshot_reader,
            ),
            wallet,
            cancel: AtomicI8::new(0),
            waker: Notify::new(),
            handler: Mutex::new(None),
        })
    }

    pub async fn status(&self) -> SyncStatus {
        SyncStatus {
            height: self.height.load(Ordering::SeqCst),
            syncing: self.syncing.load(Ordering::SeqCst) != 0,
            updated_to_tip: self.updated_to_tip.load(Ordering::SeqCst) != 0,
        }
    }

    pub async fn reset_to_height(&self, height: u64) -> Result<()> {
        if self.syncing.load(Ordering::Relaxed) != SYNC_PAUSED {
            self.syncing.store(SYNC_WAIT_PAUSE, Ordering::Relaxed);
            loop {
                if self.syncing.load(Ordering::Relaxed) == SYNC_PAUSED {
                    break;
                }
                tokio::time::sleep(Duration::from_millis(100)).await;
            }
        }

        let task = async {
            let mut tx = self.wallet.pool.begin().await?;
            let block = self
                .fake_archival_state
                .get_block_by_height(height)
                .await
                .context("failed to get block by height")?
                .context("block not found")?;
            self.wallet.roll_back(&mut tx, height, block.hash).await?;
            tx.commit().await?;
            self.fake_archival_state.reset_to_height(height).await?;
            self.height.store(height + 1, Ordering::Relaxed);
            Ok::<(), anyhow::Error>(())
        };

        let result = task.await;
        self.syncing.store(SYNC_SYNCING, Ordering::Relaxed);
        self.waker.notify_one();

        result
    }

    pub async fn sync(self: Arc<Self>) {
        let self_clone = self.clone();
        let premine_utxos = loop {
            match self_clone.check_premine().await {
                Ok(utxos) => break utxos,
                Err(e) => {
                    error!("sync error: {:?}", e);
                    tokio::time::sleep(Duration::from_secs(5)).await;
                }
            }
        };

        if !premine_utxos.is_empty() {
            self.wallet
                .add_expected_utxo(premine_utxos)
                .await
                .expect("Must be able to add new expected UTXO for genesis block");
        }

        let task = tokio::spawn(async move {
            while let Err(e) = self_clone.sync_inner().await {
                error!("sync error: {:?}", e);
                tokio::time::sleep(Duration::from_secs(5)).await;
            }
        });

        self.handler.lock().await.replace(task);
    }

    async fn sync_inner(&self) -> Result<()> {
        let start = self.wallet.start_height().await?;
        debug!("start set to: {start}");

        let network = self.wallet.network;
        let mut previous_mutator_set_accumulator = match start {
            0 => MutatorSetAccumulator::default(),
            1 => Block::genesis(network).mutator_set_accumulator_after()?,
            _ => {
                let context = format!(
                    "Prev block does not exist. Could not get block with height {}",
                    start - 1
                );
                let block = self
                    .fake_archival_state
                    .get_block_by_height(start - 1)
                    .await?
                    .context(context)?;
                block.mutator_set_accumulator_after()
            }
        };

        self.update(if start > 1 { start - 1 } else { start });
        self.height.store(start, Ordering::Relaxed);

        if let Err(e) = self
            .fake_archival_state
            .prepare(
                start - (start % SYNC_BLOCK_BATCH_SIZE),
                SYNC_BLOCK_BATCH_SIZE,
            )
            .await
        {
            error!("prepare blocks error: {:?}", e);
        };

        self.syncing.store(1, Ordering::Relaxed);

        loop {
            match self
                .sync_height(&mut previous_mutator_set_accumulator)
                .await
            {
                Ok(duration) => {
                    if let Some(duration) = duration {
                        self.syncing.store(SYNC_PAUSED, Ordering::Relaxed);
                        select! {
                            _ = tokio::time::sleep(duration) => {
                                self.syncing.store(SYNC_SYNCING, Ordering::Relaxed);
                            },
                            _ = self.waker.notified()=>{
                                if self.cancel.load(Ordering::Relaxed) != 0 {
                                    info!("scan canceled");
                                    self.syncing.store(SYNC_STOPPED, Ordering::Relaxed);
                                    return Ok(());
                                }
                                self.syncing.store(SYNC_SYNCING, Ordering::Relaxed);
                            }
                        }
                    } else {
                        if self.cancel.load(Ordering::Relaxed) != 0 {
                            info!("scan canceled");
                            self.syncing.store(SYNC_STOPPED, Ordering::Relaxed);
                            return Ok(());
                        }
                    }
                }
                Err(e) => {
                    error!("sync height error: {:?}", e);
                    select! {
                        _ = tokio::time::sleep(Duration::from_secs(5)) => {
                        },
                        _ = self.waker.notified()=>{
                            if self.cancel.load(Ordering::Relaxed) != 0 {
                                info!("scan canceled");
                                self.syncing.store(SYNC_STOPPED, Ordering::Relaxed);
                                return Ok(());
                            }
                        }
                    }
                }
            }
        }
    }
    async fn sync_height(
        &self,
        previous_mutator_set_accumulator: &mut MutatorSetAccumulator,
    ) -> Result<Option<Duration>> {
        if self.syncing.load(Ordering::Relaxed) != SYNC_SYNCING {
            self.syncing.store(SYNC_PAUSED, Ordering::Relaxed);
            return Ok(Some(Duration::from_secs(1)));
        }

        let current_height = self.height.load(Ordering::Relaxed);
        info!("syncing block {current_height}");

        // Attempt to always have all blocks downloaded, before they need to be
        // processed.
        if current_height > 0 && (current_height - 12).is_multiple_of(SYNC_BLOCK_BATCH_SIZE) {
            debug!("prepare blocks: {}", current_height);
            self.fake_archival_state
                .prepare(current_height, SYNC_BLOCK_BATCH_SIZE)
                .await
                .context("prepare blocks error")?;
            debug!("prepare blocks done: {}", current_height);
        }

        debug!("getting block {current_height}");

        let current_block = match self
            .fake_archival_state
            .get_block_by_height(current_height)
            .await
            .context("get block error")?
        {
            Some(block) => {
                self.syncing_new_tip(block.kernel.header.height.into());
                block
            }
            None => {
                debug!("block {current_height} not found");
                {
                    //update balance after sync
                    let balance = self.wallet.get_balance().await?;
                    let config = crate::service::get_state::<Arc<Config>>();
                    config
                        .update_wallet_balance(self.wallet.id, balance.display_lossless())
                        .await?;
                }
                if self.updated_to_tip.load(Ordering::Relaxed) == 0 {
                    info!("updated to tip, waiting for new block {}", current_height);
                }
                self.updated_to_tip(current_height);
                return Ok(Some(Duration::from_secs(60)));
            }
        };

        debug!("get block done: {}", current_height);

        let current_mutator_set_accumulator = current_block.mutator_set_accumulator_after();

        debug!("update wallet state with new block: {}", current_height);

        let mut should_update = self.updated_to_tip.load(Ordering::Relaxed) == 1;
        if should_update
            && (Timestamp::now() - current_block.kernel.header.timestamp).as_duration()
                > Duration::from_secs(26 * 60)
        {
            should_update = false
        }

        if let Some(fork) = self
            .wallet
            .update_new_tip(
                previous_mutator_set_accumulator,
                &current_block,
                should_update,
            )
            .await
            .context("update wallet state error")?
        {
            info!("fork at height: {}", fork);

            let fork_block = self
                .fake_archival_state
                .get_block_by_height(fork)
                .await
                .context(format!("failed to get block at height: {}", fork))?
                .context("fork block not found")?;
            *previous_mutator_set_accumulator = fork_block.mutator_set_accumulator_after();

            self.update(fork);
            self.fake_archival_state
                .reset_to_height(fork)
                .await
                .context("reset to height error")?;
            self.height.store(fork + 1, Ordering::Relaxed);
            return Ok(None);
        }

        debug!(
            "update wallet state with new block done: {}",
            current_height
        );

        *previous_mutator_set_accumulator = current_mutator_set_accumulator;

        let now = Timestamp::now().to_millis();
        if now - LAST_SYNC_EVENT_TIME.load(Ordering::Relaxed) > 100 {
            self.update(current_height);
            LAST_SYNC_EVENT_TIME.store(now, Ordering::Relaxed);
        }
        self.height.store(current_height + 1, Ordering::Relaxed);

        Ok(None)
    }

    fn update(&self, height: u64) {
        self.updated_to_tip.store(0, Ordering::Relaxed);
        let _ = crate::service::app::emit_event_to("main", "sync_height", height);
    }

    fn updated_to_tip(&self, height: u64) {
        self.updated_to_tip.store(1, Ordering::Relaxed);
        let _ = crate::service::app::emit_event_to("main", "sync_finish", height);
    }

    fn syncing_new_tip(&self, height: u64) {
        let _ = crate::service::app::emit_event_to("main", "syncing_new_block", height);
    }

    pub async fn cancel_sync(&self) {
        self.cancel.store(1, Ordering::Relaxed);
        self.waker.notify_waiters();

        if let Some(mut handler) = self.handler.lock().await.take() {
            match tokio::time::timeout(Duration::from_secs(5), &mut handler).await {
                Ok(_) => {}
                Err(_) => {
                    warn!("cancel timeout after 5s");
                    handler.abort();
                }
            };
        }
    }

    /// Return premine UTXOs, if genesis block hasn't already been checked.
    async fn check_premine(&self) -> Result<Vec<ExpectedUtxoData>> {
        // Do some heuristics to attempt to only do this check once per wallet.
        let start = self.wallet.start_height().await?;
        let utxos = if 0 == start && self.wallet.expected_utxos().await?.is_empty() {
            let premine_keys = self.wallet.get_known_spending_keys();
            Self::check_premine_inner(self.wallet.network, &premine_keys)
        } else {
            vec![]
        };

        Ok(utxos)
    }

    #[cfg(test)]
    pub(crate) fn check_premine_for_tests(
        network: Network,
        premine_keys: &[SpendingKey],
    ) -> Vec<ExpectedUtxoData> {
        Self::check_premine_inner(network, premine_keys)
    }

    fn check_premine_inner(
        network: Network,
        premine_keys: &[SpendingKey],
    ) -> Vec<ExpectedUtxoData> {
        let mut our_premine_utxos = vec![];
        debug!("Populating state with premine UTXOs. This should only happen once");
        let mut id = 0;
        let network_launch = network.launch_date();
        for premine_key in premine_keys {
            let own_receiving_address = premine_key.to_address();
            for utxo in Block::premine_utxos() {
                if utxo.lock_script_hash() == own_receiving_address.lock_script_hash() {
                    let txid = Block::genesis(network)
                        .body()
                        .transaction_kernel()
                        .txid()
                        .to_string();
                    let expected_utxo = ExpectedUtxo::new(
                        utxo,
                        Block::premine_sender_randomness(network),
                        premine_key.privacy_preimage(),
                        UtxoNotifier::Premine,
                    );
                    let expected = ExpectedUtxoData {
                        id,
                        txid,
                        expected_utxo,
                        timestamp: network_launch,
                    };
                    our_premine_utxos.push(expected);
                }

                id += 1;
            }
        }

        our_premine_utxos
    }
}

#[cfg(test)]
mod tests {
    use neptune_cash::api::export::NativeCurrencyAmount;
    use neptune_cash::api::export::WalletEntropy;

    use super::*;

    #[test]
    fn identifies_devnet_premine_utxo() {
        let network = Network::Main;
        let devnet_wallet = WalletEntropy::devnet_wallet();
        let premine_key = devnet_wallet.nth_generation_spending_key(0);
        let utxos = SyncState::check_premine_inner(network, &[premine_key.into()]);
        assert_eq!(
            1,
            utxos.len(),
            "devnet wallet must have exactly one premine UTXO"
        );
        assert_eq!(
            NativeCurrencyAmount::coins(20),
            utxos[0].expected_utxo.utxo.get_native_currency_amount(),
            "devnet's premine UTXO must be 20 NPT"
        );

        assert!(
            Block::genesis(network)
                .body()
                .transaction_kernel()
                .outputs
                .contains(&utxos[0].expected_utxo.addition_record),
            "Wallet's premine addition record must agree with that in genesis block."
        );
    }
}
