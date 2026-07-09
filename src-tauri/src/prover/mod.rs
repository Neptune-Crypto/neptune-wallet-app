use neptune_wallet::triton_vm::prelude::Program;
use neptune_wallet::triton_vm::proof::Claim;
use neptune_wallet::triton_vm::proof::Proof;
use neptune_wallet::triton_vm::prove;
use neptune_wallet::triton_vm::stark::Stark;
use neptune_wallet::triton_vm::vm::NonDeterminism;
use tracing::*;

mod proof_collection;

pub(crate) struct ProofBuilder {}

impl ProofBuilder {
    fn produce(
        program: Program,
        claim: Claim,
        non_determinism: NonDeterminism,
    ) -> anyhow::Result<Proof> {
        let default_stark: Stark = Stark::default();

        let proof = prove(default_stark, &claim, program, non_determinism)?;
        info!("triton-vm: completed proof");

        Ok(proof)
    }
}
