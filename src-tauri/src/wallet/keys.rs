use core::sync;
use std::collections::HashMap;
use std::ops::Deref;
use std::range::Range;
use std::sync::atomic::Ordering;
use std::sync::Arc;

use anyhow::ensure;
use anyhow::Result;
use neptune_primitives::network::Network;
use neptune_wallet::address::symmetric_key::SymmetricKey;
use neptune_wallet::address::KeyType;
use neptune_wallet::address::ReceivingAddress;
use neptune_wallet::address::SpendingKey;
use rayon::prelude::*;
use serde::Serialize;
use strum::IntoEnumIterator;

/// Display information about an address
#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
pub(crate) struct AddressRecord {
    pub key_index: i32,
    pub address: String,
    pub address_short_form: String,
    pub label: Option<String>,
}

impl AddressRecord {
    fn new(
        receiving_address: ReceivingAddress,
        key_index: i32,
        network: Network,
        label: Option<String>,
    ) -> Self {
        let address_short_form = receiving_address.to_bech32m_abbreviated(network).unwrap();
        Self {
            key_index,
            address: receiving_address.to_bech32m(network).unwrap(),
            address_short_form,
            label,
        }
    }
}

impl super::WalletState {
    pub(crate) async fn get_address(&self, key_type: KeyType, index: u64) -> Result<String> {
        let address = self.key.nth_receiving_address(index, key_type);

        address.to_bech32m(self.network)
    }

    /// Return all addresses of the specified type, except for symmetric
    /// addresses.
    ///
    /// Returns an error if called with the key type of symmetric addresses
    /// since these cannot be presented in a secure manner, at the time of
    /// writing.
    pub(crate) fn known_addresses(&self, key_type: KeyType) -> Result<Vec<AddressRecord>> {
        ensure!(
            key_type != KeyType::Symmetric,
            "Symmetric keys cannot be shown in a secure manner"
        );

        // Key index represents the *next* address to be derived.
        let key_index = self.ephemeral_key_index(key_type);
        ensure!(
            key_index <= i32::MAX as u64,
            "Key index cannot exceed i32::MAX"
        );
        let range = Range {
            start: 0,
            end: key_index,
        };
        let keys = self.keys(range, key_type);
        let addresses = keys.into_iter().map(|(idx, x)| (idx, x.to_address()));

        // Above cap on key index guarantees that this unwrap can never panic.
        let addresses = addresses
            .map(|(idx, addr)| {
                AddressRecord::new(addr, idx.try_into().unwrap(), self.network, None)
            })
            .collect();

        Ok(addresses)
    }

    /// Add a new address of the specified type to the wallet, and return the
    /// newly added address.
    ///
    /// All incoming UTXOs to the newly added address will be tracked by the
    /// wallet. Returns an error if called with the key type of symmetric
    /// addresses since these cannot be presented in a secure manner and they
    /// really shouldn't be used at all. This wallet does not condone, or
    /// support the generation of new symmetric addresses.
    pub(crate) async fn generate_new_address(&self, key_type: KeyType) -> Result<AddressRecord> {
        ensure!(
            key_type != KeyType::Symmetric,
            "Symmetric keys should not be used"
        );

        // Key index represents the *next* address to be derived.
        let key_index = self.ephemeral_key_index(key_type);
        ensure!(
            key_index <= i32::MAX as u64,
            "Key index cannot exceed i32::MAX"
        );

        let new_address = self.key.nth_receiving_address(key_index, key_type);
        self.set_key_index(key_type, key_index.saturating_add(1))
            .await?;

        Ok(AddressRecord::new(
            new_address,
            key_index.try_into().unwrap(),
            self.network,
            None,
        ))
    }

    /// Return all known spending keys.
    ///
    /// Will always return at least one key per type.
    pub(crate) fn all_known_keys(&self) -> Vec<SpendingKey> {
        let mut all_keys = vec![];
        for key_type in KeyType::iter() {
            all_keys.extend(self.known_keys(key_type));
        }

        all_keys.iter().map(|v| v.1.deref().clone()).collect()
    }

    /// Return all known keys of that type.
    ///
    /// Will always return at least one key.
    fn known_keys(&self, key_type: KeyType) -> Vec<(u64, Arc<SpendingKey>)> {
        let end = self.ephemeral_key_index(key_type);
        let range = Range { start: 0, end };
        self.keys(range, key_type)
    }

    /// Return all tracked keys, and all future keys up the specified
    /// look-ahead index.
    pub(crate) fn known_and_future_keys(&self) -> HashMap<KeyType, HashMap<u64, Arc<SpendingKey>>> {
        let num_future_keys = self.num_future_keys();
        let mut all_keys = HashMap::new();
        for key_type in KeyType::iter() {
            let start = 0;
            let end = match key_type {
                KeyType::Generation => self.generation_key_index(),
                KeyType::Symmetric => self.symmetric_key_index(),
                KeyType::EcHybrid => self.ec_hybrid_key_index(),
                KeyType::ViewingAddress => self.viewing_address_key_index(),
                _ => todo!(),
            };
            let end = end + num_future_keys;
            let range = Range { start, end };
            let keys: HashMap<u64, Arc<SpendingKey>> =
                self.keys(range, key_type).into_iter().collect();

            all_keys.insert(key_type, keys);
        }

        all_keys
    }

    pub(crate) fn set_ephemeral_key_index(
        &self,
        key_type: KeyType,
        val: u64,
        order: sync::atomic::Ordering,
    ) {
        match key_type {
            KeyType::Generation => self.generation_key_index.store(val, order),
            KeyType::Symmetric => self.symmetric_key_index.store(val, order),
            KeyType::EcHybrid => self.ec_hybrid_key_index.store(val, order),
            KeyType::ViewingAddress => self.viewing_address_key_index.store(val, order),
            _ => todo!(),
        }
    }

    pub(crate) fn ephemeral_key_index(&self, key_type: KeyType) -> u64 {
        match key_type {
            KeyType::Generation => self.generation_key_index(),
            KeyType::Symmetric => self.symmetric_key_index(),
            KeyType::EcHybrid => self.ec_hybrid_key_index(),
            KeyType::ViewingAddress => self.viewing_address_key_index(),
            _ => todo!(),
        }
    }

    fn symmetric_key_index(&self) -> u64 {
        self.symmetric_key_index.load(Ordering::Relaxed)
    }

    fn generation_key_index(&self) -> u64 {
        self.generation_key_index.load(Ordering::Relaxed)
    }

    fn ec_hybrid_key_index(&self) -> u64 {
        self.ec_hybrid_key_index.load(Ordering::Relaxed)
    }

    fn viewing_address_key_index(&self) -> u64 {
        self.viewing_address_key_index.load(Ordering::Relaxed)
    }

    pub(crate) fn num_future_keys(&self) -> u64 {
        self.num_future_keys.load(Ordering::Relaxed)
    }

    /// Return a list of (key index, key) for the requested key type, in the
    /// specified range.
    pub(crate) fn keys(
        &self,
        range: Range<u64>,
        key_type: KeyType,
    ) -> Vec<(u64, Arc<SpendingKey>)> {
        let entropy = &self.key;

        let mut keys: Vec<_> = (range.start..range.end)
            .into_par_iter()
            .map(|i| {
                if let Some(key) = self.key_cache.get_key(key_type, i) {
                    return (i, key);
                }
                let new_key = Arc::new(self.key.nth_spending_key(key_type, i));
                self.key_cache.add_key(i, new_key.clone());
                (i, new_key)
            })
            .collect();

        if key_type == KeyType::Symmetric && self.scan_config.recover_from_sym_digest_keys {
            let malformed: Vec<_> = (range.start..range.end)
                .into_par_iter()
                .map(|i| {
                    let key = Arc::new(SpendingKey::from(entropy.nth_symmetric_key(i)));
                    let key = SymmetricKey::from_seed(key.privacy_preimage());
                    let key: SpendingKey = key.into();
                    (i, Arc::new(key))
                })
                .collect();
            keys.extend(malformed);
        };

        keys
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::tests::test_devnet_wallet;

    #[tokio::test]
    async fn looks_ahead_right_number_of_addresses() {
        let wallet_state = test_devnet_wallet().await;
        let num_known_keys = wallet_state.all_known_keys().len();
        let num_known_and_future: usize = wallet_state
            .known_and_future_keys()
            .values()
            .map(|x| x.len())
            .sum();

        // Looks ahead for *each* key type. So must multiply by number of key
        // types to get total number of future keys.
        let total_num_future = KeyType::iter().count() * wallet_state.num_future_keys() as usize;

        assert_eq!(num_known_keys + total_num_future, num_known_and_future);
    }

    #[tokio::test]
    async fn knows_one_key_per_key_type_at_init() {
        let wallet_state = test_devnet_wallet().await;
        assert_eq!(KeyType::iter().count(), wallet_state.all_known_keys().len());
    }

    #[tokio::test]
    async fn generate_new_address_consistency() {
        let wallet_state = test_devnet_wallet().await;

        for key_type in KeyType::iter() {
            if key_type == KeyType::Symmetric {
                continue;
            }

            let addresses_before = wallet_state.known_addresses(key_type).unwrap();

            let mut generated_addresses = vec![];
            for _ in 0..6 {
                generated_addresses
                    .push(wallet_state.generate_new_address(key_type).await.unwrap());
            }

            let addresses_after = wallet_state.known_addresses(key_type).unwrap();

            assert_eq!(
                addresses_after,
                [addresses_before, generated_addresses].concat()
            )
        }
    }
}
