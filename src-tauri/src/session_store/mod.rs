use std::collections::BTreeMap;
use std::sync::Arc;

use serde::de::DeserializeOwned;
use serde::Serialize;
use tokio::sync::RwLock;

pub(crate) mod command;
pub(crate) mod persist;

#[derive(Debug, Clone)]
pub(crate) struct Memstore {
    sessions: Arc<RwLock<BTreeMap<Vec<u8>, Vec<u8>>>>,
}

impl Memstore {
    pub(crate) fn new() -> Self {
        Self {
            sessions: Arc::new(RwLock::new(BTreeMap::new())),
        }
    }

    pub(crate) async fn get<K: Serialize, V: DeserializeOwned>(&self, key: &K) -> Option<V> {
        let key = serde_json::to_vec(key).unwrap();
        let sessions = self.sessions.read().await;
        let value = sessions.get(&key).cloned();
        match value {
            Some(value) => {
                let value: V = serde_json::from_slice(&value).unwrap();
                Some(value)
            }
            None => None,
        }
    }

    pub(crate) async fn set<K: Serialize, V: Serialize>(&self, key: &K, value: &V) {
        let key = serde_json::to_vec(key).unwrap();
        let value = serde_json::to_vec(value).unwrap();
        let mut sessions = self.sessions.write().await;
        sessions.insert(key.to_vec(), value.to_vec());
    }

    pub(crate) async fn del<K: Serialize, V: DeserializeOwned>(&self, key: &K) -> Option<V> {
        let key = serde_json::to_vec(key).unwrap();
        let mut sessions = self.sessions.write().await;
        let value = sessions.remove(&key);
        match value {
            Some(value) => {
                let value: V = serde_json::from_slice(&value).unwrap();
                Some(value)
            }
            None => None,
        }
    }
}
