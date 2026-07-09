use std::sync::Arc;

use dashmap::DashMap;
use neptune_wallet::address::KeyType;
use neptune_wallet::address::SpendingKey;

pub(super) struct KeyCache {
    symmetric_keys: DashMap<u64, Arc<SpendingKey>>,
    generation_spending_keys: DashMap<u64, Arc<SpendingKey>>,
    ec_hybrid_keys: DashMap<u64, Arc<SpendingKey>>,
    viewing_address: DashMap<u64, Arc<SpendingKey>>,
}

impl KeyCache {
    pub(crate) fn new() -> Self {
        Self {
            symmetric_keys: DashMap::new(),
            generation_spending_keys: DashMap::new(),
            ec_hybrid_keys: DashMap::new(),
            viewing_address: DashMap::new(),
        }
    }

    pub(crate) fn add_key(&self, index: u64, key: Arc<SpendingKey>) {
        match key.as_ref() {
            SpendingKey::Generation(_) => self.generation_spending_keys.insert(index, key),
            SpendingKey::Symmetric(_) => self.symmetric_keys.insert(index, key),
            SpendingKey::EcHybrid(_) => self.ec_hybrid_keys.insert(index, key),
            SpendingKey::ViewingAddressKey(_) => self.viewing_address.insert(index, key),
            _ => todo!("Only known key types are supported"),
        };
    }

    pub(crate) fn get_key(&self, key_type: KeyType, index: u64) -> Option<Arc<SpendingKey>> {
        let key = match key_type {
            KeyType::Generation => self.generation_spending_keys.get(&index),
            KeyType::Symmetric => self.symmetric_keys.get(&index),
            KeyType::EcHybrid => self.ec_hybrid_keys.get(&index),
            KeyType::ViewingAddress => self.viewing_address.get(&index),
            _ => todo!("Only known key types are supported"),
        };

        key.map(|d| d.value().clone())
    }
}
