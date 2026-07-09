use std::collections::HashMap;
use std::collections::HashSet;
use std::range::Range;
use std::sync::atomic::Ordering;

use anyhow::Result;
use itertools::Itertools;
use neptune_mutator_set::removal_record::absolute_index_set::AbsoluteIndexSet;
use neptune_wallet::address::KeyType;
use neptune_wallet::incoming_utxo::IncomingUtxoRecoveryData;
use neptune_wallet::twenty_first::tip5::Digest;
use strum::IntoEnumIterator;
use tracing::debug;
use tracing::trace;
use tracing::warn;

use crate::wallet::UtxoRecoveryData;

impl super::WalletState {
    pub(super) fn deduplicate_recovery_data(
        incoming_utxos: Vec<IncomingUtxoRecoveryData>,
    ) -> Vec<IncomingUtxoRecoveryData> {
        let mut seen_absis = HashSet::new();
        let mut ret = vec![];

        for incoming in incoming_utxos {
            let urd: UtxoRecoveryData = incoming.clone().into();
            if seen_absis.insert(urd.abs_i()) {
                ret.push(incoming);
            }
        }

        ret
    }

    /// Return the highest key index that has received an incoming UTXO for each
    /// key type.
    ///
    /// Will look ahead exactly [`Self::num_future_keys`]. If a gap of more than
    /// this number of keys exist in the incoming UTXOs, those UTXOs will not be
    /// considered. In other words: If the wallet has received UTXOs for keys
    /// with key indices more than [`Self::num_future_keys`] above the key index
    /// where the previous UTXO was received, then all UTXOs received after this
    /// gap will not be counted.
    pub(super) fn max_key_index_used(
        &self,
        incoming_utxos: &[IncomingUtxoRecoveryData],
    ) -> HashMap<KeyType, Option<u64>> {
        let mut ret = HashMap::new();
        let receiver_preimages: HashSet<_> =
            incoming_utxos.iter().map(|x| x.receiver_preimage).collect();
        for key_type in KeyType::iter() {
            let mut max_index = None;

            loop {
                let start = max_index.map(|x| x + 1).unwrap_or(0);
                let end = start + self.num_future_keys();
                let keys = self.keys(Range { start, end }, key_type);

                trace!("Scanning {key_type} in ({start}..{end})");

                let max = keys
                    .iter()
                    .filter(|(_index, key)| receiver_preimages.contains(&key.privacy_preimage()))
                    .map(|(index, _key)| *index)
                    .max();

                if let Some(max) = max {
                    debug!("found match {key_type}, key index: {max}");
                    max_index = Some(max);
                } else {
                    debug!("{key_type}: Ending scan");
                    break;
                }
            }

            ret.insert(key_type, max_index);
        }

        ret
    }

    /// Bump key indices to match the provided values.
    ///
    /// Does not persist. Caller must handle this.
    pub(super) fn bump_key_indices(&self, key_indices: HashMap<KeyType, Option<u64>>) {
        for (key_type, max_index) in key_indices {
            let max_index = max_index.unwrap_or(0);

            // new index is max-used index plus one since the key index
            // represents the *next* address to be derived.
            let new_index = max_index + 1;
            match key_type {
                KeyType::Generation => {
                    self.generation_key_index
                        .fetch_max(new_index, Ordering::SeqCst);
                }
                KeyType::Symmetric => {
                    self.symmetric_key_index
                        .fetch_max(new_index, Ordering::SeqCst);
                }
                KeyType::EcHybrid => {
                    self.ec_hybrid_key_index
                        .fetch_max(new_index, Ordering::SeqCst);
                }
                KeyType::ViewingAddress => {
                    self.viewing_address_key_index
                        .fetch_max(new_index, Ordering::SeqCst);
                }
                _ => todo!(),
            }
        }
    }

    /// Return the incoming UTXOs that are not yet known to this wallet.
    pub(super) async fn not_yet_claimed(
        &self,
        incoming_utxos: Vec<IncomingUtxoRecoveryData>,
    ) -> Result<Vec<UtxoRecoveryData>> {
        let already_claimed: HashSet<_> = self
            .get_utxos()
            .await?
            .into_iter()
            .map(|x| x.recovery_data.abs_i())
            .collect();

        let incoming_utxos: Vec<_> = incoming_utxos
            .into_iter()
            .map(|incoming| {
                let recovery_data: UtxoRecoveryData = incoming.into();
                recovery_data
            })
            .filter(|incoming| {
                let absi = incoming.abs_i();
                !already_claimed.contains(&absi)
            })
            .collect();

        Ok(incoming_utxos)
    }

    /// Return the incoming UTXOs that have keys that are known to this wallet.
    pub(super) fn have_matching_keys(
        &self,
        incoming_utxos: Vec<UtxoRecoveryData>,
    ) -> Vec<UtxoRecoveryData> {
        let all_keys = self.known_and_future_keys();
        let all_privacy_preimages: HashSet<Digest> = all_keys
            .values()
            .flat_map(|keys| keys.values().map(|key| key.privacy_preimage()))
            .collect();

        let num_keys: usize = all_keys.values().map(|x| x.len()).sum();
        debug!("Num keys: {num_keys}");
        debug!("Num privacy preimages: {}", all_privacy_preimages.len());

        let mut ret = vec![];
        for incoming in incoming_utxos {
            if all_privacy_preimages.contains(&incoming.receiver_preimage) {
                ret.push(incoming);
            } else {
                warn!("Does not have a key for entry in incoming randomness. Missing key for AOCL leaf {}", incoming.aocl_index);
            }
        }

        ret

        // incoming_utxos
        //     .into_iter()
        //     .filter(|incoming| all_privacy_preimages.contains(&incoming.receiver_preimage))
        //     .collect()
    }

    /// Only return those UTXOs that are not spent.
    pub(super) async fn filter_unspent_utxos<F, Fut>(
        utxos: Vec<UtxoRecoveryData>,
        rpc_call: F,
    ) -> Result<Vec<UtxoRecoveryData>>
    where
        F: FnOnce(Vec<AbsoluteIndexSet>) -> Fut,
        Fut: std::future::Future<Output = Result<Vec<bool>>>,
    {
        let absis: Vec<_> = utxos.iter().map(|x| x.abs_i()).collect();

        let spent_flags = rpc_call(absis).await?;

        let unspent_utxos: Vec<_> = utxos
            .into_iter()
            .zip_eq(spent_flags)
            .filter(|(_utxo, is_spent)| !*is_spent)
            .map(|(utxo, _is_spent)| utxo)
            .collect();

        Ok(unspent_utxos)
    }
}

#[cfg(test)]
mod tests {
    use neptune_primitives::network::Network;
    use neptune_wallet::address::SpendingKey;
    use neptune_wallet::wallet_entropy::WalletEntropy;
    use tracing_test::traced_test;

    use super::*;
    use crate::config::wallet::ScanConfig;
    use crate::config::wallet::WalletConfig;
    use crate::tests::load_incoming_randomness;
    use crate::tests::test_wallet_db;
    use crate::wallet::WalletState;

    async fn setup_wallet(num_future_keys: u64) -> WalletState {
        let network = Network::Main;
        let config = WalletConfig {
            id: 0,
            key: WalletEntropy::devnet_wallet(),
            scan_config: ScanConfig {
                num_keys: num_future_keys,
                start_height: 0,
                recover_from_sym_digest_keys: false,
            },
            network,
        };

        let db_path = test_wallet_db().await;
        WalletState::new(config.clone(), &db_path).await.unwrap()
    }

    fn incoming_randomness_38343() -> Vec<IncomingUtxoRecoveryData> {
        load_incoming_randomness("devnet_incoming_randomness_block38434.dat")
    }

    fn incoming_randomness_41089() -> Vec<IncomingUtxoRecoveryData> {
        load_incoming_randomness("devnet_incoming_randomness_block41089.dat")
    }

    fn incoming_randomness_41098() -> Vec<IncomingUtxoRecoveryData> {
        load_incoming_randomness("devnet_incoming_randomness_block41098.dat")
    }

    #[tokio::test]
    async fn deduplicate_devnet() {
        let incoming = incoming_randomness_38343();
        let expected = incoming.clone();
        let result = WalletState::deduplicate_recovery_data(incoming);
        assert_eq!(expected, result);
    }

    #[traced_test]
    #[tokio::test]
    async fn max_key_index_devnet_38343_short_lookahead() {
        let wallet = setup_wallet(4).await;
        let incoming = incoming_randomness_38343();
        let result = wallet.max_key_index_used(&incoming);
        assert_eq!(result[&KeyType::Generation], Some(2));
        assert_eq!(result[&KeyType::Symmetric], Some(4));
    }

    #[traced_test]
    #[tokio::test]
    async fn have_matching_keys_devnet_short_lookahead() {
        let wallet = setup_wallet(4).await;
        let incoming = incoming_randomness_38343();
        let result = wallet.max_key_index_used(&incoming);
        wallet.bump_key_indices(result);
        let incoming: Vec<UtxoRecoveryData> = incoming.into_iter().map(|x| x.into()).collect();
        let expected = incoming.clone();
        let result = wallet.have_matching_keys(incoming);
        assert_eq!(expected.len(), result.len());
        assert_eq!(expected, result);
    }

    #[tokio::test]
    async fn max_key_index_devnet_38343() {
        let wallet = setup_wallet(25).await;
        let incoming = incoming_randomness_38343();
        let result = wallet.max_key_index_used(&incoming);
        assert_eq!(result[&KeyType::Generation], Some(2));
        assert_eq!(result[&KeyType::Symmetric], Some(4));
        assert_eq!(result[&KeyType::EcHybrid], None);
        assert_eq!(result[&KeyType::ViewingAddress], None);
    }

    #[tokio::test]
    async fn max_key_index_devnet_41089() {
        let wallet = setup_wallet(25).await;
        let incoming = incoming_randomness_41089();
        let result = wallet.max_key_index_used(&incoming);
        assert_eq!(result[&KeyType::Generation], Some(2));
        assert_eq!(result[&KeyType::Symmetric], Some(4));
        assert_eq!(result[&KeyType::EcHybrid], Some(21));
        assert_eq!(result[&KeyType::ViewingAddress], Some(11));
    }

    #[tokio::test]
    async fn max_key_index_devnet_41098() {
        let wallet = setup_wallet(25).await;
        let incoming = incoming_randomness_41098();
        let result = wallet.max_key_index_used(&incoming);
        assert_eq!(result[&KeyType::Generation], Some(2));
        assert_eq!(result[&KeyType::Symmetric], Some(4));
        assert_eq!(result[&KeyType::EcHybrid], Some(42));
        assert_eq!(result[&KeyType::ViewingAddress], Some(12));
    }

    #[tokio::test]
    async fn bump_key_indices_devnet_38343() {
        let wallet = setup_wallet(25).await;
        let incoming = incoming_randomness_38343();
        let num_keys_before: usize = wallet
            .known_and_future_keys()
            .values()
            .map(|x| x.len())
            .sum();
        let key_indices = wallet.max_key_index_used(&incoming);
        wallet.bump_key_indices(key_indices);
        let num_keys_after: usize = wallet
            .known_and_future_keys()
            .values()
            .map(|x| x.len())
            .sum();

        assert_eq!(6 + num_keys_before, num_keys_after);

        // Verify that wallet's index represents *next* derived key
        assert_eq!(3, wallet.ephemeral_key_index(KeyType::Generation));
        assert_eq!(5, wallet.ephemeral_key_index(KeyType::Symmetric));
        assert_eq!(1, wallet.ephemeral_key_index(KeyType::EcHybrid));
        assert_eq!(1, wallet.ephemeral_key_index(KeyType::ViewingAddress));

        // Verify known (not future) keys after
        let known_keys = wallet.all_known_keys();
        assert_eq!(
            3,
            known_keys
                .iter()
                .filter(|x| matches!(x, SpendingKey::Generation(_)))
                .count()
        );
        assert_eq!(
            5,
            known_keys
                .iter()
                .filter(|x| matches!(x, SpendingKey::Symmetric(_)))
                .count()
        );
        assert_eq!(
            1,
            known_keys
                .iter()
                .filter(|x| matches!(x, SpendingKey::EcHybrid(_)))
                .count()
        );
        assert_eq!(
            1,
            known_keys
                .iter()
                .filter(|x| matches!(x, SpendingKey::ViewingAddressKey(_)))
                .count()
        );
    }

    #[tokio::test]
    async fn not_yet_claimed_devnet() {
        let wallet = setup_wallet(25).await;
        let incoming = incoming_randomness_38343();
        let expected: Vec<UtxoRecoveryData> =
            incoming.clone().into_iter().map(|x| x.into()).collect();
        let result = wallet.not_yet_claimed(incoming).await.unwrap();
        assert_eq!(expected, result);
    }

    #[traced_test]
    #[tokio::test]
    async fn have_matching_keys_devnet() {
        for incoming in [
            incoming_randomness_38343(),
            incoming_randomness_41089(),
            incoming_randomness_41098(),
        ] {
            let wallet = setup_wallet(25).await;
            let key_indices = wallet.max_key_index_used(&incoming);
            wallet.bump_key_indices(key_indices);
            let incoming: Vec<UtxoRecoveryData> = incoming.into_iter().map(|x| x.into()).collect();
            let expected = incoming.clone();
            let result = wallet.have_matching_keys(incoming);
            assert_eq!(expected.len(), result.len());
            assert_eq!(expected, result);
        }
    }

    #[tokio::test]
    async fn filter_unspents() {
        let incoming = incoming_randomness_38343();
        let incoming: Vec<UtxoRecoveryData> = incoming.into_iter().map(|x| x.into()).collect();

        // Mock spent status to what it was at block height 38,434
        let mut mock_spent_status = vec![true; 30];
        mock_spent_status[26] = false;
        mock_spent_status[28] = false;
        mock_spent_status[29] = false;

        let result = WalletState::filter_unspent_utxos(incoming.clone(), |_absis| async move {
            Ok(mock_spent_status)
        })
        .await
        .expect("Filtering failed");

        assert_eq!(
            vec![
                incoming[26].clone(),
                incoming[28].clone(),
                incoming[29].clone()
            ],
            result
        );
    }
}
