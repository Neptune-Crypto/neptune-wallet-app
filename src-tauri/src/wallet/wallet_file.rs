use std::path::Path;
use std::path::PathBuf;

use anyhow::Result;
use neptune_cash::api::export::Network;
use tracing::*;

use super::WalletState;
use crate::config::Config;

pub(crate) fn wallet_dir_by_id(data_dir: &Path, network: Network, wallet_id: i64) -> PathBuf {
    data_dir
        .join(network.to_string())
        .join(format!("wallet_{}", wallet_id))
}

pub(crate) async fn delete_wallet(config: &Config, wallet_id: i64) -> Result<()> {
    let wallet_dir = WalletState::wallet_path(config, wallet_id).await?;

    if wallet_dir.exists() {
        info!("Deleting wallet {}", wallet_dir.display());
        tokio::fs::remove_dir_all(&wallet_dir).await?;
    }

    Ok(())
}
