use super::persist::PersisStore;
use super::Memstore;

#[cfg_attr(feature = "gui", tauri::command)]
pub(crate) async fn session_store_get(key: String) -> Option<String> {
    let store = crate::service::get_state::<Memstore>();
    let value = store.get(&key).await;
    value
}

#[cfg_attr(feature = "gui", tauri::command)]
pub(crate) async fn session_store_set(key: String, value: String) {
    let store = crate::service::get_state::<Memstore>();
    store.set(&key, &value).await;
}

#[cfg_attr(feature = "gui", tauri::command)]
pub(crate) async fn session_store_del(key: String) -> Option<String> {
    let store = crate::service::get_state::<Memstore>();
    let value = store.del(&key).await;
    value
}

#[cfg_attr(feature = "gui", tauri::command)]
pub(crate) async fn add_contact_address_execute(
    params: Vec<serde_json::Value>,
) -> Result<Vec<serde_json::Value>, String> {
    const SQL: &str = "
  INSERT INTO contacts (aliasName, address, type, remark, createdTime)
  VALUES (?, ?, ?, ?, ?)
  ";

    let store = crate::service::get_state::<PersisStore>();
    let read_only = false;
    store
        .execute(SQL, params, read_only)
        .await
        .map_err(|e| e.to_string())
}

#[cfg_attr(feature = "gui", tauri::command)]
pub(crate) async fn delete_contact_address_execute(
    params: Vec<serde_json::Value>,
) -> Result<Vec<serde_json::Value>, String> {
    const SQL: &str = "DELETE FROM contacts WHERE address = ?";

    let store = crate::service::get_state::<PersisStore>();
    let read_only = false;
    store
        .execute(SQL, params, read_only)
        .await
        .map_err(|e| e.to_string())
}

#[cfg_attr(feature = "gui", tauri::command)]
pub(crate) async fn get_contact_list_execute() -> Result<Vec<serde_json::Value>, String> {
    const SQL: &str = "SELECT * FROM contacts";

    let store = crate::service::get_state::<PersisStore>();
    let read_only = true;
    store
        .execute(SQL, vec![], read_only)
        .await
        .map_err(|e| e.to_string())
}

#[cfg_attr(feature = "gui", tauri::command)]
pub(crate) async fn get_execution_history_execute(
    params: Vec<serde_json::Value>,
) -> Result<Vec<serde_json::Value>, String> {
    const SQL: &str = "SELECT * FROM execution_history WHERE addressId = ? ORDER BY timestamp DESC";

    let store = crate::service::get_state::<PersisStore>();
    let read_only = true;
    store
        .execute(SQL, params, read_only)
        .await
        .map_err(|e| e.to_string())
}

#[cfg_attr(feature = "gui", tauri::command)]
pub(crate) async fn add_execution_history_execute(
    params: Vec<serde_json::Value>,
) -> Result<Vec<serde_json::Value>, String> {
    const SQL: &str = "INSERT INTO execution_history (
    txid,
    timestamp,
    height,
    addressId,
    address,
    fee,
    priorityFee,
    status,
    batchOutput
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)";

    let store = crate::service::get_state::<PersisStore>();
    let read_only = false;
    store
        .execute(SQL, params, read_only)
        .await
        .map_err(|e| e.to_string())
}

#[cfg_attr(feature = "gui", tauri::command)]
pub(crate) async fn delete_execution_history_execute(
    params: Vec<serde_json::Value>,
) -> Result<Vec<serde_json::Value>, String> {
    const SQL: &str = "DELETE FROM execution_history WHERE txid = ?";

    let store = crate::service::get_state::<PersisStore>();
    let read_only = false;
    store
        .execute(SQL, params, read_only)
        .await
        .map_err(|e| e.to_string())
}
