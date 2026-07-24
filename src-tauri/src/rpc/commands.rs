use std::ops::Deref;
use std::sync::Arc;

use neptune_wallet::address::KeyType;
use neptune_wallet::incoming_utxo::IncomingUtxoRecoveryData;
use tracing::*;

use super::tls;
use crate::command::Result;
use crate::command::TauriCommandResultExt;
use crate::config::Config;
use crate::rpc::block::BlockInfoRpc;
use crate::rpc::error::RestError;
use crate::rpc::transaction_status::TransactionStatus;
use crate::rpc::transaction_status::TransactionStatusRpc;
use crate::rpc::SendResponse;
use crate::rpc::SendToAddressParams;
use crate::rpc::Utxo;
use crate::rpc::WalletBalance;
use crate::rpc::WalletRpc;
use crate::rpc::WalletRpcImpl;
use crate::wallet::balance::WalletHistory;
use crate::wallet::keys::AddressRecord;
use crate::wallet::sync::SyncState;
use crate::wallet::sync::SyncStatus;
use crate::wallet::watch_only::WatchOnlyAddressRecord;
use crate::wallet::watch_only_payout_policy::PayoutPolicy;
use crate::wallet::watch_only_payout_policy::PayoutPolicyDraft;
use crate::wallet::watch_only_payout_policy::PayoutPreview;
use crate::wallet::watch_only_payout_policy::PayoutRun;

#[cfg_attr(feature = "gui", tauri::command)]
#[cfg_attr(not(feature = "gui"), allow(unused))]
pub(crate) async fn get_server_url() -> Result<String> {
    let token = get_token().await?;

    let url = format!(
        "http://{}@{}:{}",
        token,
        "127.0.0.1",
        crate::config::consts::RPC_PORT
    );

    Ok(url)
}

pub(crate) async fn get_token() -> Result<String> {
    let config = crate::service::get_state::<Arc<Config>>();
    let sk = config.get_secret_key().await.into_tauri_result()?;
    let public = tls::get_p256_pubkey(&sk);
    Ok(hex::encode(public))
}

/// Command to start the RPC server, after the central secret key material,
/// including password, has been set.
///
/// Initializes a new SyncState.
///
/// # Panics
/// - If no secret material or password has set yet.
#[cfg_attr(feature = "gui", tauri::command)]
pub(crate) async fn run_rpc_server() -> Result<()> {
    start_rpc_server_inner().await.map_err(|e| {
        let err = e.to_string();
        error!("error start rpc: {}", err);
        err
    })
}

async fn start_rpc_server_inner() -> Result<()> {
    trace!("Starting RPC server");

    let mut rpc_handler = super::RPC_CLOSER.lock().await;
    trace!("Got handler");

    if let Some(handler) = rpc_handler.deref() {
        if !handler.is_finished() {
            // Don't change error message, as it's seen by frontend.
            return Err("rpc server is already running".to_string());
        };
        rpc_handler
            .take()
            .unwrap()
            .stop()
            .await
            .into_tauri_result()?;
    }
    drop(rpc_handler);
    trace!("Dropped handler");

    if let Some(old) = crate::service::try_get_state::<Arc<SyncState>>() {
        trace!("Got existing sync state");
        old.cancel_sync().await;
    }

    let config = crate::service::get_state::<Arc<Config>>();
    trace!("Got config state");

    let sync_state = Arc::new(SyncState::new(&config).await.into_tauri_result()?);
    trace!("Created sync state");

    crate::service::manage_or_replace(sync_state.clone());
    trace!("Called manage_or_replace to set sync state");

    sync_state.sync().await;
    trace!("sync() completed");

    super::start_rpc_server().await.into_tauri_result()?;
    trace!("Called start_rpc_server");

    Ok(())
}

#[cfg_attr(feature = "gui", tauri::command)]
pub(crate) async fn stop_rpc_server() -> Result<()> {
    if let Some(sync_state) = crate::service::try_get_state::<Arc<SyncState>>() {
        super::stop_rpc_server().await.into_tauri_result()?;
        sync_state.cancel_sync().await;
    };

    Ok(())
}

impl<T> TauriCommandResultExt for std::result::Result<T, RestError> {
    type Output = T;

    fn into_tauri_result(self) -> std::result::Result<T, String> {
        self.map_err(|e| e.0)
    }
}

#[cfg_attr(feature = "gui", tauri::command)]
pub(crate) async fn sync_state() -> SyncStatus {
    WalletRpcImpl::sync_state().await
}

#[cfg_attr(feature = "gui", tauri::command)]
pub(crate) async fn wallet_balance() -> Result<WalletBalance> {
    WalletRpcImpl::wallet_balance().await.into_tauri_result()
}

#[cfg_attr(feature = "gui", tauri::command)]
pub(crate) async fn current_wallet_address(index: u64) -> Result<String> {
    WalletRpcImpl::current_wallet_address(index)
        .await
        .into_tauri_result()
}

#[cfg_attr(feature = "gui", tauri::command)]
pub(crate) async fn history() -> Result<Vec<WalletHistory>> {
    WalletRpcImpl::history().await.into_tauri_result()
}

#[cfg_attr(feature = "gui", tauri::command)]
pub(crate) async fn avaliable_utxos() -> Result<Vec<Utxo>> {
    WalletRpcImpl::avaliable_utxos().await.into_tauri_result()
}

#[cfg_attr(feature = "gui", tauri::command)]
pub(crate) async fn send_to_address(params: SendToAddressParams) -> Result<SendResponse> {
    WalletRpcImpl::send_to_address(params)
        .await
        .into_tauri_result()
}

#[cfg_attr(feature = "gui", tauri::command)]
pub(crate) async fn pending_transactions() -> Result<Vec<TransactionStatus>> {
    WalletRpcImpl::pending_transactions()
        .await
        .into_tauri_result()
}

#[cfg_attr(feature = "gui", tauri::command)]
pub(crate) async fn forget_tx(txid: String) -> Result<()> {
    WalletRpcImpl::forget_tx(txid).await.into_tauri_result()
}

#[cfg_attr(feature = "gui", tauri::command)]
pub(crate) async fn get_tip_height() -> Result<u64> {
    WalletRpcImpl::get_tip_height().await.into_tauri_result()
}

#[cfg_attr(feature = "gui", tauri::command)]
pub(crate) async fn import_incoming_randomness(
    payload: Vec<IncomingUtxoRecoveryData>,
) -> Result<String> {
    info!("Received {} incoming UTXOs for processing.", payload.len());

    WalletRpcImpl::import_incoming_randomness(payload)
        .await
        .into_tauri_result()
}

#[cfg_attr(feature = "gui", tauri::command)]
pub(crate) async fn known_addresses(key_type: KeyType) -> Result<Vec<AddressRecord>> {
    WalletRpcImpl::known_addresses(key_type)
        .await
        .into_tauri_result()
}

#[cfg_attr(feature = "gui", tauri::command)]
pub(crate) async fn generate_new_address(key_type: KeyType) -> Result<AddressRecord> {
    WalletRpcImpl::generate_new_address(key_type)
        .await
        .into_tauri_result()
}

#[cfg_attr(feature = "gui", tauri::command)]
pub(crate) async fn add_watch_only_address(
    key_type: String,
    address: String,
    preimage: Option<String>,
    name: String,
) -> Result<WatchOnlyAddressRecord> {
    WalletRpcImpl::add_watch_only_address(key_type, address, preimage, name)
        .await
        .into_tauri_result()
}

#[cfg_attr(feature = "gui", tauri::command)]
pub(crate) async fn known_watch_only_addresses() -> Result<Vec<WatchOnlyAddressRecord>> {
    WalletRpcImpl::known_watch_only_addresses()
        .await
        .into_tauri_result()
}

#[cfg_attr(feature = "gui", tauri::command)]
pub(crate) async fn remove_watch_only_address(id: i64) -> Result<()> {
    WalletRpcImpl::remove_watch_only_address(id)
        .await
        .into_tauri_result()
}

#[cfg_attr(feature = "gui", tauri::command)]
pub(crate) async fn save_payout_policy(
    watch_only_id: i64,
    draft: PayoutPolicyDraft,
) -> Result<PayoutPolicy> {
    WalletRpcImpl::save_payout_policy(watch_only_id, draft)
        .await
        .into_tauri_result()
}

#[cfg_attr(feature = "gui", tauri::command)]
pub(crate) async fn get_payout_policy(watch_only_id: i64) -> Result<Option<PayoutPolicy>> {
    WalletRpcImpl::get_payout_policy(watch_only_id)
        .await
        .into_tauri_result()
}

#[cfg_attr(feature = "gui", tauri::command)]
pub(crate) async fn list_payout_policies() -> Result<Vec<PayoutPolicy>> {
    WalletRpcImpl::list_payout_policies()
        .await
        .into_tauri_result()
}

#[cfg_attr(feature = "gui", tauri::command)]
pub(crate) async fn remove_payout_policy(watch_only_id: i64) -> Result<()> {
    WalletRpcImpl::remove_payout_policy(watch_only_id)
        .await
        .into_tauri_result()
}

#[cfg_attr(feature = "gui", tauri::command)]
pub(crate) async fn get_payout_runs(watch_only_id: i64) -> Result<Vec<PayoutRun>> {
    WalletRpcImpl::get_payout_runs(watch_only_id)
        .await
        .into_tauri_result()
}

#[cfg_attr(feature = "gui", tauri::command)]
pub(crate) async fn preview_payout(watch_only_id: i64) -> Result<PayoutPreview> {
    WalletRpcImpl::preview_payout(watch_only_id)
        .await
        .into_tauri_result()
}
