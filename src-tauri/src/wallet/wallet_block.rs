use neptune_consensus::block::block_kernel::BlockKernel;
use neptune_mutator_set::addition_record::AdditionRecord;
use neptune_mutator_set::mutator_set_accumulator::MutatorSetAccumulator;
use neptune_rpc_api::model::wallet::block::RpcWalletBlock;
use neptune_wallet::twenty_first::tip5::Digest;
use neptune_wallet::twenty_first::util_types::mmr::mmr_trait::Mmr;
use serde::Deserialize;
use serde::Serialize;

/// A block tailored for this program
#[derive(Debug, Clone, Serialize, Deserialize)]
pub(crate) struct WalletBlock {
    pub(crate) kernel: BlockKernel,
    pub(crate) hash: Digest,
}

impl From<RpcWalletBlock> for WalletBlock {
    fn from(value: RpcWalletBlock) -> Self {
        let hash = value.hash();
        Self {
            kernel: value.kernel.into(),
            hash,
        }
    }
}

impl WalletBlock {
    pub(crate) fn all_addition_records(&self) -> Vec<AdditionRecord> {
        self.kernel
            .all_addition_records(self.hash)
            .expect("Stored block must have valid guesser fee addition records")
    }

    pub(crate) fn mutator_set_accumulator_after(&self) -> MutatorSetAccumulator {
        let guesser_fees_outputs = self
            .kernel
            .guesser_fee_addition_records(self.hash)
            .expect("Stored block must have valid guesser fee addition records");
        self.kernel
            .body
            .mutator_set_accumulator_after(guesser_fees_outputs)
    }

    /// The number of AOCL leafs prior to the application of this block.
    pub(crate) fn num_aocl_leafs_prior(&self) -> u64 {
        // TODO: Replace this with a call to
        // `BlockBody::num_aocl_leafs_prior` when neptune-core dependency is
        // updated.
        const NUM_GUESSER_OUTPUTS: u64 = 2;
        let num_outputs: u64 = self
            .kernel
            .body
            .transaction_kernel()
            .outputs
            .len()
            .try_into()
            .expect("Can't contain more than u64::MAX outputs");

        let num_guesser_outputs = if self.kernel.header.height.is_genesis() {
            0
        } else {
            NUM_GUESSER_OUTPUTS
        };
        self.mutator_set_accumulator_after().aocl.num_leafs() - num_outputs - num_guesser_outputs
    }
}
