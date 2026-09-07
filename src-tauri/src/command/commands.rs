use std::path::PathBuf;
use std::str::FromStr;
use std::sync::Arc;
use std::time::Duration;

use anyhow::Context;
use neptune_primitives::network::Network;
use neptune_wallet::address::KeyType;
use neptune_wallet::address::ReceivingAddress;
use tracing::warn;

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

/// The current network's target block interval in milliseconds.
///
/// Exposed so the frontend never hardcodes this consensus parameter — it
/// differs per network, so any baked-in constant would be wrong on all but
/// one of them.
///
/// Milliseconds because it is the coarsest unit that keeps every network's
/// interval a non-zero integer (some test networks have sub-second blocks),
/// and it is the internal unit of [`neptune_primitives::timestamp::Timestamp`],
/// so the value is reported without any conversion or rounding. Callers
/// convert at display time only.
#[cfg_attr(feature = "gui", tauri::command)]
#[cfg_attr(not(feature = "gui"), allow(unused))]
pub(crate) async fn get_block_interval() -> Result<u64> {
    let config = crate::service::get_state::<Arc<Config>>();
    let network = config.get_network().await.into_tauri_result()?;
    Ok(network.target_block_interval().to_millis())
}

/// Result of checking whether a string is a valid recipient address.
/// Forms use it to show validation errors as the user types. The send
/// path re-parses every address itself, so a wrong verdict here can
/// never move funds.
#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct AddressValidation {
    pub(crate) valid: bool,
    /// Human-readable key type of a valid address.
    pub(crate) key_type: Option<String>,
    /// Parser error for an invalid one.
    pub(crate) error: Option<String>,
}

fn classify_address(address: &str, network: Network) -> AddressValidation {
    match ReceivingAddress::from_bech32m(address.trim(), network) {
        Ok(parsed) => AddressValidation {
            valid: true,
            key_type: Some(
                // The compiler requires the wildcard: the enum is
                // non_exhaustive upstream. If it ever matches, the parser
                // has already accepted the address, so it is valid; this
                // build just has no name for its type.
                match parsed {
                    ReceivingAddress::Generation(_) => "Generation",
                    ReceivingAddress::Symmetric(_) => "Symmetric",
                    ReceivingAddress::EcHybrid(_) => "EC hybrid",
                    ReceivingAddress::ViewingAddress(_) => "Viewing",
                    _ => "Unknown",
                }
                .to_string(),
            ),
            error: None,
        },
        Err(e) => AddressValidation {
            valid: false,
            key_type: None,
            error: Some(e.to_string()),
        },
    }
}

#[cfg_attr(feature = "gui", tauri::command)]
#[cfg_attr(not(feature = "gui"), allow(unused))]
pub(crate) async fn validate_address(address: String) -> Result<AddressValidation> {
    let config = crate::service::get_state::<Arc<Config>>();
    let network = config.get_network().await.into_tauri_result()?;
    Ok(classify_address(&address, network))
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

/// Minutes of inactivity before the wallet locks itself, 0 meaning never.
///
/// The idle timer itself lives in the frontend, which is where user activity
/// shows up; this pair only persists the choice.
#[cfg_attr(feature = "gui", tauri::command)]
#[cfg_attr(not(feature = "gui"), allow(unused))]
pub(crate) async fn set_auto_lock_minutes(minutes: u64) -> Result<()> {
    let config = crate::service::get_state::<Arc<Config>>();
    config
        .set_auto_lock_minutes(minutes)
        .await
        .into_tauri_result()?;
    Ok(())
}

#[cfg_attr(feature = "gui", tauri::command)]
#[cfg_attr(not(feature = "gui"), allow(unused))]
pub(crate) async fn get_auto_lock_minutes() -> Result<u64> {
    let config = crate::service::get_state::<Arc<Config>>();
    config.get_auto_lock_minutes().await.into_tauri_result()
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

    // The tip pins a new account's start height. For an import it only bounds
    // the typed height, so an unreachable node does not block restoring offline.
    let tip = rpc_client::node_rpc_client().get_tip_header().await;
    if is_new {
        start_height = tip.into_tauri_result()?.height.into();
    } else if let Ok(tip) = tip {
        let tip: u64 = tip.height.into();
        if start_height > tip {
            return Err(format!(
                "Start block height {start_height} is above the current chain tip ({tip}). Use a height at or below the tip."
            ));
        }
    }

    let wallet_config = ScanConfig {
        num_keys,
        start_height,
        recover_from_sym_digest_keys: false,
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
pub(crate) async fn rename_wallet(id: i64, name: String) -> Result<()> {
    let name = name.trim();
    if name.is_empty() {
        return Err("Account name cannot be empty".to_string());
    }
    let config = crate::service::get_state::<Arc<Config>>();
    config
        .update_wallet_name(id, name)
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
    state
        .wallet
        .get_address(KeyType::Generation, index)
        .await
        .into_tauri_result()
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
    config.unlock();

    // Unlocking after a manual lock: the sync state was left running, so only
    // the RPC server needs bringing back. At first startup there is no sync
    // state yet and the frontend's `run_rpc_server` does the full
    // initialization instead, so there is nothing to restart here.
    if crate::service::try_get_state::<Arc<SyncState>>().is_some() {
        if let Err(e) = crate::rpc::start_rpc_server().await {
            warn!("Could not restart RPC server after unlock: {}", e);
        }
    }

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
    // Checked first so a manual lock answers on its own terms, rather than
    // relying on the empty-password branch below happening to reject a wallet
    // whose password was cleared.
    if config.is_locked() {
        return Ok(false);
    }
    if config.password.lock().await.is_some() {
        return Ok(true);
    }
    Ok(config.decrypt_config("").await.is_ok())
}

/// Lock the wallet without quitting the app.
///
/// Guards against someone reaching the running app: the UI returns to the lock
/// screen and the local RPC server is shut down. The sync state is deliberately
/// left running, so block sync and any in-flight proving survive the lock, and
/// key material is not scrubbed from memory.
#[cfg_attr(feature = "gui", tauri::command)]
#[cfg_attr(not(feature = "gui"), allow(unused))]
pub(crate) async fn lock_wallet() -> Result<()> {
    let config = crate::service::get_state::<Arc<Config>>();
    config.lock().await;
    crate::rpc::stop_rpc_server()
        .await
        .context("failed to stop RPC server")
        .into_tauri_result()?;
    Ok(())
}

#[cfg_attr(feature = "gui", tauri::command)]
#[cfg_attr(not(feature = "gui"), allow(unused))]
pub(crate) async fn reset_to_height(height: u64) -> Result<()> {
    let tip: u64 = rpc_client::node_rpc_client()
        .get_tip_header()
        .await
        .into_tauri_result()?
        .height
        .into();
    if height > tip {
        return Err(format!(
            "Resync height {height} is above the current chain tip ({tip}). Use a height at or below the tip."
        ));
    }
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
        !(file.network == network.to_string() && file.range.1 > sync_state.height as i64)
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

#[cfg(test)]
mod tests {
    use neptune_wallet::address::SpendingKey;
    use neptune_wallet::wallet_entropy::WalletEntropy;

    use super::*;

    #[test]
    fn classify_address_verdicts() {
        let key = WalletEntropy::devnet_wallet().nth_generation_spending_key(0);
        let address = SpendingKey::from(key)
            .to_address()
            .to_bech32m(Network::Main)
            .unwrap();

        let verdict = classify_address(&address, Network::Main);
        assert!(verdict.valid);
        assert_eq!(verdict.key_type.as_deref(), Some("Generation"));
        assert!(verdict.error.is_none());

        // Copy-paste whitespace is tolerated.
        assert!(classify_address(&format!("  {address}\n"), Network::Main).valid);

        // A single corrupted character fails the checksum.
        let mut tampered = address.clone();
        let last = tampered.pop().unwrap();
        tampered.push(if last == 'q' { 'p' } else { 'q' });
        let verdict = classify_address(&tampered, Network::Main);
        assert!(!verdict.valid);
        assert!(verdict.key_type.is_none());
        assert!(verdict.error.is_some());

        // An address for another network is rejected.
        assert!(!classify_address(&address, Network::TestnetMock).valid);

        assert!(!classify_address("not an address", Network::Main).valid);
        assert!(!classify_address("", Network::Main).valid);
    }
}
