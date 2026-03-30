use std::path::PathBuf;
use std::str::FromStr;
use std::sync::Arc;
use std::time::Duration;

use anyhow::Context;
use neptune_cash::api::export::Network;

use crate::config::wallet::ScanConfig;
use crate::config::wallet::WalletData;
use crate::config::Config;
use crate::rpc_client;
use crate::wallet::block_cache::BlockCacheFile;
use crate::wallet::block_cache::PersistBlockCache;
use crate::wallet::fake_archival_state::generate_snapshot;
use crate::wallet::sync::SyncState;
use crate::wallet::wallet_file;

type Result<T> = std::result::Result<T, String>;

pub(crate) trait TauriCommandResultExt {
    type Output;

    /// Converts any error into a string automatically for Tauri commands
    fn into_tauri_result(self) -> std::result::Result<Self::Output, String>;
}

impl<T> TauriCommandResultExt for std::result::Result<T, anyhow::Error> {
    type Output = T;

    fn into_tauri_result(self) -> std::result::Result<T, String> {
        self.map_err(|e| format!("{:#?}", e))
    }
}

#[cfg_attr(feature = "gui", tauri::command)]
#[cfg_attr(not(feature = "gui"), allow(unused))]
pub(crate) async fn set_remote_rest(rest: String) -> Result<()> {
    let config = crate::service::get_state::<Arc<Config>>();
    config.set_remote_rest(&rest).await.into_tauri_result()?;

    rpc_client::node_rpc_client().set_rest_server(rest);
    Ok(())
}

#[cfg_attr(feature = "gui", tauri::command)]
#[cfg_attr(not(feature = "gui"), allow(unused))]
pub(crate) async fn get_remote_rest() -> Result<String> {
    let config = crate::service::get_state::<Arc<Config>>();
    config.get_remote_rest().await.into_tauri_result()
}

#[cfg_attr(feature = "gui", tauri::command)]
#[cfg_attr(not(feature = "gui"), allow(unused))]
pub(crate) async fn set_network(network: String) -> Result<()> {
    let network = Network::from_str(&network).map_err(|e| e.to_string())?;
    let config = crate::service::get_state::<Arc<Config>>();
    config.set_network(network).await.into_tauri_result()?;
    set_wallet_id(-1).await?;
    crate::rpc_client::node_rpc_client()
        .set_rest_server(config.get_remote_rest().await.into_tauri_result()?);

    Ok(())
}

#[cfg_attr(feature = "gui", tauri::command)]
#[cfg_attr(not(feature = "gui"), allow(unused))]
pub(crate) async fn get_network() -> Result<String> {
    let config = crate::service::get_state::<Arc<Config>>();
    Ok(config.get_network().await.into_tauri_result()?.to_string())
}

#[cfg_attr(feature = "gui", tauri::command)]
#[cfg_attr(not(feature = "gui"), allow(unused))]
pub(crate) async fn set_disk_cache(enabled: bool) -> Result<()> {
    let config = crate::service::get_state::<Arc<Config>>();
    config.set_disk_cache(enabled).await.into_tauri_result()?;
    Ok(())
}

#[cfg_attr(feature = "gui", tauri::command)]
#[cfg_attr(not(feature = "gui"), allow(unused))]
pub(crate) async fn get_disk_cache() -> Result<bool> {
    let config = crate::service::get_state::<Arc<Config>>();
    config.get_disk_cache().await.into_tauri_result()
}

#[cfg_attr(feature = "gui", tauri::command)]
pub(crate) async fn add_wallet(
    name: String,
    mnemonic: String,
    num_keys: u64,
    mut start_height: u64,
    is_new: bool,
) -> Result<i64> {
    let phrase = mnemonic.split_whitespace().map(|s| s.to_string()).collect();

    //wallet is new, set start height to tip
    if is_new {
        let tip = rpc_client::node_rpc_client()
            .get_tip_header()
            .await
            .into_tauri_result()?;
        start_height = tip.height.into();
    }

    let wallet_config = ScanConfig {
        num_keys,
        start_height,
    };

    let config = crate::service::get_state::<Arc<Config>>();

    let id = config
        .add_wallet(&name, phrase, wallet_config)
        .await
        .into_tauri_result()?;

    Ok(id)
}

#[cfg_attr(feature = "gui", tauri::command)]
#[cfg_attr(not(feature = "gui"), allow(unused))]
pub(crate) async fn remove_wallet(id: i64) -> Result<()> {
    let config = crate::service::get_state::<Arc<Config>>();
    config.remove_wallet(id).await.into_tauri_result()?;
    wallet_file::delete_wallet(config.as_ref(), id)
        .await
        .into_tauri_result()?;
    Ok(())
}

#[cfg_attr(feature = "gui", tauri::command)]
#[cfg_attr(not(feature = "gui"), allow(unused))]
pub(crate) async fn export_wallet(password: String, id: i64) -> Result<Vec<String>> {
    let config = crate::service::get_state::<Arc<Config>>();
    let config_password = config.password.lock().await.clone();
    if config_password.is_none() {
        return Err("password is not set".to_string());
    }
    if password != config_password.unwrap() {
        return Err("wrong password".to_string());
    }
    let mnemonic: Vec<String> = config
        .get_wallet_mnemonic(id)
        .await
        .context("failed to get wallet mnemonic")
        .into_tauri_result()?;
    Ok(mnemonic)
}

#[cfg_attr(feature = "gui", tauri::command)]
pub(crate) async fn get_wallets() -> Result<Vec<WalletData>> {
    let config = crate::service::get_state::<Arc<Config>>();
    config.get_wallets().await.into_tauri_result()
}

#[cfg_attr(feature = "gui", tauri::command)]
#[cfg_attr(not(feature = "gui"), allow(unused))]
pub(crate) async fn get_wallet_id() -> Result<i64> {
    let config = crate::service::get_state::<Arc<Config>>();
    config.get_wallet_id().await.into_tauri_result()
}

#[cfg_attr(feature = "gui", tauri::command)]
pub(crate) async fn set_wallet_id(id: i64) -> Result<()> {
    let config = crate::service::get_state::<Arc<Config>>();
    if id >= 0 {
        config.set_wallet_id(id).await.into_tauri_result()?;
    }

    if let Some(sync_state) = crate::service::try_get_state::<Arc<SyncState>>() {
        sync_state.cancel_sync().await;
    };

    let sync_state = Arc::new(SyncState::new(&config).await.into_tauri_result()?);
    crate::service::manage_or_replace(sync_state.clone());
    sync_state.sync().await;

    Ok(())
}

#[cfg_attr(feature = "gui", tauri::command)]
#[cfg_attr(not(feature = "gui"), allow(unused))]
pub(crate) async fn wallet_address(index: u64) -> Result<String> {
    let state = crate::service::try_get_state_repeated::<Arc<SyncState>>(
        10,
        Duration::from_millis(300),
        "wallet_address",
    )
    .await;
    let state = state.expect("State fetch of 'Arc<SyncState>' for wallet_address must work.");
    state.wallet.get_address(index).await.into_tauri_result()
}

#[cfg_attr(feature = "gui", tauri::command)]
#[cfg_attr(not(feature = "gui"), allow(unused))]
pub(crate) async fn input_password(password: String) -> Result<()> {
    let config = crate::service::get_state::<Arc<Config>>();
    config
        .decrypt_config(password.as_str())
        .await
        .context("wrong password")
        .into_tauri_result()?;
    Ok(())
}

#[cfg_attr(feature = "gui", tauri::command)]
pub(crate) async fn set_password(old_password: String, password: String) -> Result<()> {
    let config = crate::service::get_state::<Arc<Config>>();
    config
        .set_password(&old_password, password.as_str())
        .await
        .context("failed to set password")
        .into_tauri_result()?;
    Ok(())
}

#[cfg_attr(feature = "gui", tauri::command)]
pub(crate) async fn has_password() -> Result<bool> {
    let config = crate::service::get_state::<Arc<Config>>();
    config.has_password().await.map_err(|e| e.to_string())
}

#[cfg_attr(feature = "gui", tauri::command)]
pub(crate) async fn try_password() -> Result<bool> {
    let config = crate::service::get_state::<Arc<Config>>();
    if config.password.lock().await.is_some() {
        return Ok(true);
    }
    Ok(config.decrypt_config("").await.is_ok())
}

#[cfg_attr(feature = "gui", tauri::command)]
#[cfg_attr(not(feature = "gui"), allow(unused))]
pub(crate) async fn reset_to_height(height: u64) -> Result<()> {
    let state = crate::service::try_get_state_repeated::<Arc<SyncState>>(
        10,
        Duration::from_millis(300),
        "reset_to_height",
    )
    .await;
    let state = state.expect("State fetch of 'Arc<SyncState>' for reset_to_height must work.");
    state.reset_to_height(height).await.into_tauri_result()?;
    Ok(())
}

#[cfg_attr(feature = "gui", tauri::command)]
#[cfg_attr(not(feature = "gui"), allow(unused))]
pub(crate) async fn snapshot_dir() -> Result<String> {
    let config = crate::service::get_state::<Arc<Config>>();
    let data_dir = config.get_data_dir().await.into_tauri_result()?;

    Ok(data_dir.to_string_lossy().to_string())
}

#[cfg_attr(feature = "gui", tauri::command)]
#[cfg_attr(not(feature = "gui"), allow(unused))]
pub(crate) async fn generate_snapshot_file(
    path: String,
    start_height: u64,
    end_height: u64,
) -> Result<()> {
    let config = crate::service::get_state::<Arc<Config>>();
    let network = config.get_network().await.into_tauri_result()?;

    let path = &PathBuf::from(path);

    generate_snapshot(path, network, (start_height..end_height).into())
        .await
        .into_tauri_result()?;

    Ok(())
}

#[cfg_attr(feature = "gui", tauri::command)]
#[cfg_attr(not(feature = "gui"), allow(unused))]
pub(crate) async fn list_cache() -> Result<Vec<BlockCacheFile>> {
    let config = crate::service::get_state::<Arc<Config>>();
    let network = config.get_network().await.into_tauri_result()?;
    let data_dir = config.get_data_dir().await.into_tauri_result()?;
    let mut files = PersistBlockCache::list_cache_files(&data_dir).into_tauri_result()?;
    let sync_state = crate::service::try_get_state_repeated::<Arc<SyncState>>(
        10,
        Duration::from_millis(300),
        "list_cache",
    )
    .await;
    let sync_state = sync_state.expect("State fetch of 'Arc<SyncState>' for list_cache must work.");
    let sync_state = sync_state.status().await;

    files.retain(|file| {
        if file.network == network.to_string() && file.range.1 > sync_state.height as i64 {
            return false;
        }
        true
    });

    Ok(files)
}

#[cfg_attr(feature = "gui", tauri::command)]
#[cfg_attr(not(feature = "gui"), allow(unused))]
pub(crate) async fn delete_cache(path: String) -> Result<()> {
    let path = PathBuf::from(path);
    PersistBlockCache::delete_block_file(path)
        .await
        .into_tauri_result()?;
    Ok(())
}
