use axum_extra::response::ErasedJson;

use super::error::RestError;
use crate::rpc::WalletRpcImpl;
use crate::rpc_client;

pub async fn get_tip_height() -> Result<ErasedJson, RestError> {
    Ok(ErasedJson::pretty(WalletRpcImpl::get_tip_height().await?))
}

pub trait BlockInfoRpc {
    async fn get_tip_height() -> Result<u64, RestError> {
        let tip = rpc_client::node_rpc_client().get_tip_header().await?;

        let height: u64 = tip.height.into();

        Ok(height)
    }
}

impl BlockInfoRpc for WalletRpcImpl {}
