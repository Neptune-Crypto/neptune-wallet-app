use anyhow::anyhow;
use anyhow::Context;
use anyhow::Result;
use neptune_cash::api::export::BlockHeight;
use neptune_cash::prelude::tasm_lib::prelude::Digest;
use neptune_cash::protocol::consensus::block::block_selector::BlockSelector;
use tracing::debug;
use tracing::trace;

use crate::rpc_client;
use crate::wallet::wallet_block::WalletBlock;

impl super::WalletState {
    /// Return (height, digest) of the block that this wallet's state must be
    /// rolled back to.
    ///
    /// Assume this wallet's tip is a block of height 12, and a reorganization
    /// of depth 2 has just happened, making the known blocks with height 12
    /// and 11 orphans. Then this function will return
    /// `Some((10, block_10.hash()))`.
    ///
    /// # Returns
    ///
    /// - Ok(None) if no roll back is required
    /// - Ok(Some(target_height, target_hash)) if a roll back is required.
    /// - Err(_) if server fails to respond, or if server does not know the
    ///   fork that this wallet is on.
    pub(crate) async fn find_rollback_luca(
        &self,
        new_block: &WalletBlock,
    ) -> Result<Option<(u64, Digest)>> {
        debug!(
            "Checking fork for block {} {:x} {:x}",
            new_block.kernel.header.height,
            new_block.hash,
            new_block.kernel.header.prev_block_digest
        );

        let Some((old_tip_height, old_tip_hash)) = self.get_tip().await.context("get tip")? else {
            // If no tip is known, no rollback needed
            return Ok(None);
        };

        trace!("old_tip_height = {old_tip_height}; old_tip_hash: {old_tip_hash:x}");

        if new_block.kernel.header.prev_block_digest == old_tip_hash {
            // If new block is direct descendant to previos tip, no rollback
            // needed.
            return Ok(None);
        }

        // A tip is known and the new tip is not the direct descendant of the
        // previous tip. So Last (Universal) Common Ancestor (LUCA) must be
        // found.
        let (mut candidate_hash, mut candidate_height): (Digest, BlockHeight) =
            (old_tip_hash, old_tip_height.into());
        loop {
            let is_canonical = rpc_client::node_rpc_client()
                .is_block_canonical(candidate_hash)
                .await
                .context("try is_block_canonical")?;
            if is_canonical || candidate_height.is_genesis() {
                return Ok(Some((candidate_height.value(), candidate_hash)));
            }

            let header = rpc_client::node_rpc_client()
                .get_block_header(BlockSelector::Digest(candidate_hash))
                .await
                .context("try get_block_header")?;

            let Some(header) = header else {
                // This indicates that we're on an abandoned fork that the
                // server does not know.
                // TOOD: Maybe we have to rollback to genesis here? Or, better
                // yet, do a binary/exponential search until a block known both
                // by this wallet and by the server is found?
                return Err(anyhow!("Block not found during LUCA / check_fork search"));
            };

            candidate_hash = header.prev_block_digest;
            candidate_height = candidate_height
                .previous()
                .expect("Already checked if candidate height was genesis");
        }
    }
}
