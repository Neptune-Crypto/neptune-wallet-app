use std::ops::Shr;
use std::sync::atomic::AtomicPtr;
use std::sync::atomic::Ordering;

use anyhow::ensure;
use anyhow::Result;
use neptune_consensus::block::block_header::BlockHeader;
use neptune_consensus::transaction::Transaction;
use neptune_mempool::transaction_kernel_id::Txid;
use neptune_mutator_set::addition_record::AdditionRecord;
use neptune_mutator_set::removal_record::absolute_index_set::AbsoluteIndexSet;
use neptune_primitives::block_height::BlockHeight;
use neptune_primitives::block_selector::BlockSelector;
use neptune_rpc_api::api::rpc::RpcApi;
use neptune_rpc_api::api::rpc::RpcError;
use neptune_rpc_api::model::wallet::mutator_set::RpcMsMembershipSnapshot;
use neptune_rpc_api::model::wallet::transaction::RpcTransaction;
use neptune_rpc_client::http::HttpClient;
use neptune_wallet::twenty_first::tip5::Digest;
use once_cell::sync::Lazy;
use thiserror::Error;
use tracing::debug;
use tracing::error;
use tracing::trace;

use crate::wallet::wallet_block::WalletBlock;

static NODE_RPC_CLIENT: Lazy<NodeRpcClient> = Lazy::new(|| NodeRpcClient::new(""));

pub(crate) fn node_rpc_client() -> &'static NodeRpcClient {
    &NODE_RPC_CLIENT
}

pub(crate) struct NodeRpcClient {
    rest_server: AtomicPtr<HttpClient>,
}

impl NodeRpcClient {
    pub(crate) fn new(rest_server: &str) -> Self {
        let client = HttpClient::new(rest_server);
        Self {
            rest_server: AtomicPtr::new(Box::into_raw(Box::new(client))),
        }
    }

    fn rest_server(&self) -> &HttpClient {
        (unsafe { &*self.rest_server.load(Ordering::Relaxed) }) as _
    }

    pub(crate) fn set_rest_server(&self, rest: String) {
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
        let block: Option<WalletBlock> = block.blocks.first().map(|x| x.clone().into());

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

    pub(crate) async fn get_tip_header(&self) -> Result<BlockHeader> {
        debug!("request: get_tip_header");
        let client = self.rest_server();

        let header = client.tip_header().await?;
        let header = header.header.into();

        Ok(header)
    }

    pub(crate) async fn get_block_header(
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

    pub(crate) async fn is_block_canonical(&self, digest: Digest) -> Result<bool> {
        debug!("request: is_block_canonical, {digest:x}");
        let client = self.rest_server();

        let is_canonical = client.is_block_canonical(digest).await?;
        let is_canonical = is_canonical.canonical;

        Ok(is_canonical)
    }

    pub(crate) async fn find_utxo_origin(
        &self,
        addition_records: AdditionRecord,
    ) -> Result<Option<(Digest, BlockHeader)>> {
        debug!(
            "request: find_utxo_origin, {}",
            addition_records.canonical_commitment.to_hex()
        );
        let client = self.rest_server();

        // Assume server manages a UTXO index, such that all block heights can be found
        let block_digest = client
            .find_utxo_origin(addition_records.into(), None)
            .await?
            .block;

        let Some(block_digest) = block_digest else {
            return Ok(None);
        };

        let block_header = client
            .get_block_header(BlockSelector::Digest(block_digest))
            .await?
            .header;

        let Some(block_header) = block_header else {
            return Ok(None);
        };

        Ok(Some((block_digest, block_header.into())))
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
        debug!(
            "request: request_block_by_height_range, from_height: {from_height}; batch_size: {batch_size}"
        );
        let client = self.rest_server();
        let from_height: BlockHeight = from_height.into();
        let to_height: BlockHeight = (from_height + batch_size.try_into().unwrap())
            .previous()
            .expect("Cannot request genesis block from server");

        let blocks = client.get_blocks(from_height, to_height).await?;
        let blocks = blocks.blocks.into_iter().map(|x| x.into()).collect();

        Ok(blocks)
    }

    pub(crate) async fn broadcast_transaction(
        &self,
        tx: Transaction,
    ) -> Result<String, BroadcastError> {
        debug!("request: broadcast_transaction, with txid: {}", tx.txid());

        let client = self.rest_server();

        let txid = tx.txid();
        let transaction: RpcTransaction = tx
            .try_into()
            .expect("Transaction must be transferable, i.e. not leak secrets.");

        let resp = client.submit_transaction(transaction).await;

        let resp = match resp {
            Ok(resp) => resp,
            Err(e) => {
                error!("Failed to broadcast transaction: {e}");

                return Err(BroadcastError::Server(e.into()));
            }
        };

        if !resp.success {
            return Err(BroadcastError::UnspecifiedServerError);
        }

        Ok(txid.to_string())
    }

    /// Get mutator set witness data required to restore the wallet's mutator
    /// set membership proofs, without leaking more privacy than what the
    /// publication of a transaction would.
    pub(crate) async fn restore_msmps(
        &self,
        request: Vec<AbsoluteIndexSet>,
    ) -> Result<RpcMsMembershipSnapshot> {
        debug!(
            "request: restore_msmps, of {} membership proofs",
            request.len()
        );
        let client = self.rest_server();

        let resp = client.restore_membership_proof(request).await?;

        Ok(resp.snapshot)
    }

    pub(crate) async fn are_bloom_indices_set(
        &self,
        index_sets: Vec<AbsoluteIndexSet>,
    ) -> Result<Vec<bool>> {
        debug!(
            "request: are_bloom_indices_set of {} index sets",
            index_sets.len()
        );
        let client = self.rest_server();

        // TODO: Use batch-version of endpoint instead!
        let mut are_set = vec![];
        for index_set in index_sets {
            let resp = client.are_bloom_indices_set(index_set).await?;

            trace!("are set: {}", resp.are_set);
            are_set.push(resp.are_set);
        }

        Ok(are_set)
    }
}

#[derive(Error, Debug)]
pub(crate) enum BroadcastError {
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
