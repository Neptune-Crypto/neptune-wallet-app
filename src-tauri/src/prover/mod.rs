use std::sync::atomic::AtomicBool;
use std::sync::atomic::Ordering;
use std::sync::Arc;

use neptune_wallet::triton_vm::prelude::Program;
use neptune_wallet::triton_vm::proof::Claim;
use neptune_wallet::triton_vm::proof::Proof;
use neptune_wallet::triton_vm::prove;
use neptune_wallet::triton_vm::stark::Stark;
use neptune_wallet::triton_vm::vm::NonDeterminism;
use thiserror::Error;
use tracing::*;

mod proof_collection;

/// Proving was abandoned rather than failed. The caller rebuilds against the new
/// tip and retries.
#[derive(Debug, Error)]
#[error("Proving abandoned: a new block made this transaction stale")]
pub(crate) struct StaleProof;

/// Lets a proving run notice that its result is already worthless.
///
/// A transaction is only confirmable against the mutator set it was built on, so
/// any proof still running when the node accepts a block is dead. A single proof
/// cannot be interrupted, but a proof collection is a sequence of them, so it can
/// be abandoned at a boundary.
///
/// The flag is raised by whoever watches the node's tip, so the prover needs no
/// notion of blocks or chains.
#[derive(Clone)]
pub(crate) struct ProvingGuard {
    stale: Arc<AtomicBool>,
}

impl ProvingGuard {
    pub(crate) fn new(stale: Arc<AtomicBool>) -> Self {
        Self { stale }
    }

    fn is_stale(&self) -> bool {
        self.stale.load(Ordering::Relaxed)
    }
}

pub(crate) struct ProofBuilder {}

impl ProofBuilder {
    fn produce(
        program: Program,
        claim: Claim,
        non_determinism: NonDeterminism,
        guard: &ProvingGuard,
    ) -> anyhow::Result<Proof> {
        // The finest granularity available. The first sub proof is much the
        // longest, so a block landing early in it is still waited out.
        if guard.is_stale() {
            info!("Abandoning proof: a new block arrived while proving.");
            anyhow::bail!(StaleProof);
        }

        let proof = prove(Stark::default(), &claim, program, non_determinism)?;
        info!("triton-vm: completed proof");

        Ok(proof)
    }
}

#[cfg(test)]
mod tests {
    use neptune_consensus::consensus_rule_set::ConsensusRuleSet;
    use neptune_consensus::proof_abstractions::verifier::verify_transaction_proof;
    use neptune_primitives::network::Network;
    use neptune_wallet::triton_vm::prelude::BFieldElement;

    use super::proof_collection::claim_version;
    use super::*;

    fn claim_for(program: &Program, consensus_rule_set: ConsensusRuleSet) -> Claim {
        Claim::about_program(program)
            .about_version(claim_version(consensus_rule_set))
            .with_input(vec![BFieldElement::new(41)])
            .with_output(vec![BFieldElement::new(42)])
    }

    #[tokio::test]
    async fn nodes_accept_proofs_for_their_rule_set_only() {
        let network = Network::Main;
        let program = Program::from_code("read_io 1 divine 1 add write_io 1 halt").unwrap();
        let delta_claim = claim_for(&program, ConsensusRuleSet::HardforkDelta);
        let gamma_claim = claim_for(&program, ConsensusRuleSet::HardforkGamma);
        let non_determinism = NonDeterminism::new(vec![BFieldElement::new(1)]);
        let guard = ProvingGuard::new(Arc::new(AtomicBool::new(false)));

        let proof =
            ProofBuilder::produce(program, delta_claim.clone(), non_determinism, &guard).unwrap();

        assert!(verify_transaction_proof(delta_claim, proof.clone().into(), network).await);
        assert!(!verify_transaction_proof(gamma_claim, proof.into(), network).await);
    }
}
