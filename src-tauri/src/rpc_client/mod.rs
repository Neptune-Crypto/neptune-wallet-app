use std::ops::Shr;
use std::sync::atomic::AtomicPtr;
use std::sync::atomic::Ordering;

use anyhow::ensure;
use anyhow::Result;
use neptune_cash::api::export::BlockHeight;
use neptune_cash::api::export::Digest;
use neptune_cash::api::export::Transaction;
use neptune_cash::application::json_rpc::core::api::rpc::RpcApi;
use neptune_cash::application::json_rpc::core::api::rpc::RpcError;
use neptune_cash::application::json_rpc::core::model::wallet::block::RpcWalletBlock;
use neptune_cash::application::json_rpc::core::model::wallet::transaction::RpcTransaction;
use neptune_cash::protocol::consensus::block::block_header::BlockHeader;
use neptune_cash::protocol::consensus::block::block_selector::BlockSelector;
use neptune_cash::protocol::consensus::block::Block;
use neptune_cash::util_types::mutator_set::archival_mutator_set::MsMembershipProofPrivacyPreserving;
use neptune_cash::util_types::mutator_set::archival_mutator_set::ResponseMsMembershipProofPrivacyPreserving;
use neptune_cash::util_types::mutator_set::removal_record::absolute_index_set::AbsoluteIndexSet;
use neptune_rpc_client::http::HttpClient;
use once_cell::sync::Lazy;
use reqwest;
use serde::Serialize;
use thiserror::Error;
use tracing::debug;

use crate::wallet::wallet_block::WalletBlock;

static NODE_RPC_CLIENT: Lazy<NodeRpcClient> = Lazy::new(|| NodeRpcClient::new(""));

pub fn node_rpc_client() -> &'static NodeRpcClient {
    &NODE_RPC_CLIENT
}

pub struct NodeRpcClient {
    rest_server: AtomicPtr<HttpClient>,
}

#[derive(Debug, Serialize, Clone)]
pub struct BroadcastTx<'a> {
    pub transaction: &'a Transaction,
}

impl NodeRpcClient {
    pub fn new(rest_server: &str) -> Self {
        let client = HttpClient::new(rest_server);
        Self {
            rest_server: AtomicPtr::new(Box::into_raw(Box::new(client))),
        }
    }

    fn rest_server(&self) -> &HttpClient {
        (unsafe { &*self.rest_server.load(Ordering::Relaxed) }) as _
    }

    pub fn set_rest_server(&self, rest: String) {
        let client = HttpClient::new(rest);
        self.rest_server.store(
            Box::into_raw(Box::new(client)),
            std::sync::atomic::Ordering::Relaxed,
        );
    }

    pub(crate) async fn request_block(&self, height: u64) -> Result<Option<WalletBlock>> {
        debug!("request: request_block: height: {height}");
        let client = self.rest_server();

        let height = height.into();
        let block = client.get_blocks(height, height).await?;
        let block: Option<WalletBlock> = block.blocks.get(0).map(|x| x.clone().into());

        // Sanity check: block hash must be less than threshold dictated by
        // parent difficulty. But since we don't have parent, we just compare
        // to half of own difficulty. Never accept any blocks where this is not
        // satisfied, since difficulty cannot adjust more than ~25 % per block.
        // If needed, this can be ignored on the RegTest network. Feel free to
        // do that.
        if let Some(block) = &block {
            let meets_threshold = block.hash < block.kernel.header.difficulty.shr(1).target();
            ensure!(meets_threshold);
        }

        Ok(block)
    }

    pub async fn get_tip_header(&self) -> Result<BlockHeader> {
        debug!("request: get_tip_header");
        let client = self.rest_server();

        let header = client.tip_header().await?;
        let header = header.header.into();

        Ok(header)
    }

    pub async fn get_block_header(
        &self,
        block_selector: BlockSelector,
    ) -> Result<Option<BlockHeader>> {
        debug!(
            "request: get_block_header {}",
            match block_selector {
                BlockSelector::Digest(digest) => digest.to_hex(),
                other => other.to_string(),
            }
        );
        let client = self.rest_server();

        let header = client.get_block_header(block_selector).await?;
        let header = header.header.map(|x| x.into());

        Ok(header)
    }

    pub async fn is_block_canonical(&self, digest: Digest) -> Result<bool> {
        debug!("request: is_block_canonical, {digest:x}");
        let client = self.rest_server();

        let is_canonical = client.is_block_canonical(digest).await?;
        let is_canonical = is_canonical.canonical;

        Ok(is_canonical)
    }

    pub(crate) async fn request_block_by_digest(
        &self,
        digest: Digest,
    ) -> Result<Option<WalletBlock>> {
        debug!("request: request_block_by_digest, {digest:x}");
        let client = self.rest_server();

        let block = client.get_block(BlockSelector::Digest(digest)).await?;
        let block: Option<Block> = block.block.map(|x| x.into());
        let block: Option<RpcWalletBlock> = block.map(|x| (&x).into());
        let block: Option<WalletBlock> = block.map(|x| x.into());

        Ok(block)
    }

    /// Get a batch of blocks, up to the specified batch size, where the first
    /// returned block is the canonical block of the specified height.
    pub(crate) async fn request_block_by_height_range(
        &self,
        from_height: u64,
        batch_size: u64,
    ) -> Result<Vec<WalletBlock>> {
        ensure!(
            from_height != 0,
            "Cannot request genesis block from server. It must be produced locally."
        );
        debug!("request: request_block_by_height_range, from_height: {from_height}; batch_size: {batch_size}");
        let client = self.rest_server();
        let from_height: BlockHeight = from_height.into();
        let to_height: BlockHeight = (from_height + batch_size.try_into().unwrap())
            .previous()
            .expect("Cannot request genesis block from server");

        let blocks = client.get_blocks(from_height, to_height).await?;
        let blocks = blocks.blocks.into_iter().map(|x| x.into()).collect();

        Ok(blocks)
    }

    pub async fn broadcast_transaction(&self, tx: Transaction) -> Result<String, BroadcastError> {
        debug!("request: broadcast_transaction, with txid: {}", tx.txid());

        let client = self.rest_server();

        let txid = tx.txid();
        let transaction: RpcTransaction = tx
            .try_into()
            .expect("Transaction must be transferable, i.e. not leak secrets.");

        let resp = client.submit_transaction(transaction).await?;

        if !resp.success {
            return Err(BroadcastError::UnspecifiedServerError);
        }

        Ok(txid.to_string())
    }

    /// Get mutator set witness data required to restore the wallet's mutator
    /// set membership proofs, without leaking more privacy than what the
    /// publication of a transaction would.
    pub async fn restore_msmps(
        &self,
        request: Vec<AbsoluteIndexSet>,
    ) -> Result<ResponseMsMembershipProofPrivacyPreserving> {
        debug!(
            "request: restore_msmps, of {} membership proofs",
            request.len()
        );
        let client = self.rest_server();

        let resp = client.restore_membership_proof(request).await?;
        let resp = resp.snapshot;
        let tip_height = resp.synced_height;
        let tip_hash = resp.synced_hash;
        let tip_mutator_set = resp.synced_mutator_set;
        let membership_proofs: Vec<MsMembershipProofPrivacyPreserving> = resp
            .membership_proofs
            .into_iter()
            .map(|x| x.into())
            .collect();

        let res = ResponseMsMembershipProofPrivacyPreserving {
            tip_hash,
            membership_proofs,
            tip_height: tip_height.into(),
            tip_mutator_set: tip_mutator_set.into(),
        };

        Ok(res)
    }
}

#[derive(Error, Debug)]
pub enum BroadcastError {
    #[error("proof machine is busy")]
    Busy,
    #[error("Connection timeout")]
    Timeout,
    #[error("Connection error: {0}")]
    Connection(reqwest::Error),
    #[error("Server error: {0}")]
    Server(anyhow::Error),
    #[error("Internal error: {0}")]
    Internal(anyhow::Error),
    #[error("Transaction rejected by server.")]
    UnspecifiedServerError,
}

impl From<RpcError> for BroadcastError {
    fn from(value: RpcError) -> Self {
        Self::Server(anyhow::Error::msg(value.to_string()))
    }
}

impl From<reqwest::Error> for BroadcastError {
    fn from(e: reqwest::Error) -> Self {
        if e.is_timeout() {
            BroadcastError::Timeout
        } else if e.is_connect() {
            BroadcastError::Connection(e)
        } else {
            BroadcastError::Server(e.into())
        }
    }
}

impl From<anyhow::Error> for BroadcastError {
    fn from(e: anyhow::Error) -> Self {
        BroadcastError::Internal(e)
    }
}
