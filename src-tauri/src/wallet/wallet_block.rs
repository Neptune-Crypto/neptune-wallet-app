use neptune_cash::api::export::AdditionRecord;
use neptune_cash::api::export::Digest;
use neptune_cash::application::json_rpc::core::model::wallet::block::RpcWalletBlock;
use neptune_cash::protocol::consensus::block::block_kernel::BlockKernel;
use neptune_cash::util_types::mutator_set::mutator_set_accumulator::MutatorSetAccumulator;
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
}
