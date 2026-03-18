use std::sync::Arc;

use dashmap::DashMap;
use neptune_cash::api::export::SpendingKey;

pub(super) struct KeyCache {
    symmetric_keys: DashMap<u64, Arc<SpendingKey>>,
    generation_spending_keys: DashMap<u64, Arc<SpendingKey>>,
}

impl KeyCache {
    pub(crate) fn new() -> Self {
        Self {
            symmetric_keys: DashMap::new(),
            generation_spending_keys: DashMap::new(),
        }
    }
    pub(crate) fn get_symmetric_key(&self, index: u64) -> Option<Arc<SpendingKey>> {
        self.symmetric_keys.get(&index).map(|d| d.value().clone())
    }
    pub(crate) fn get_generation_spending_key(&self, index: u64) -> Option<Arc<SpendingKey>> {
        self.generation_spending_keys
            .get(&index)
            .map(|d| d.value().clone())
    }

    pub(crate) fn add_symmetric_key(&self, index: u64, key: Arc<SpendingKey>) {
        self.symmetric_keys.insert(index, key);
    }

    pub(crate) fn add_generation_spending_key(&self, index: u64, key: Arc<SpendingKey>) {
        self.generation_spending_keys.insert(index, key);
    }
}
