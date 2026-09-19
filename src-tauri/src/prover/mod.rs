use std::sync::atomic::AtomicBool;
use std::sync::atomic::Ordering;
use std::sync::Arc;

use neptune_consensus::proof_abstractions::tasm::legacy_stark_verify::claim_uses_legacy_proof_system;
use neptune_consensus::proof_abstractions::tasm::legacy_stark_verify::LegacyProverPipeline;
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

        // Nodes verify a claim under the proof system its version selects, so
        // claims from before hardfork delta need the legacy VM. That pipeline
        // panics on failure.
        let proof = if claim_uses_legacy_proof_system(&claim) {
            LegacyProverPipeline::trace(&program, &claim, non_determinism).prove()
        } else {
            prove(Stark::default(), &claim, program, non_determinism)?
        };
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

    /// Uses input, nondeterminism and output, so the legacy VM conversion has
    /// to carry all three.
    fn prove_for(consensus_rule_set: ConsensusRuleSet) -> (Claim, Proof) {
        let program = Program::from_code("read_io 1 divine 1 add write_io 1 halt").unwrap();
        let claim = Claim::about_program(&program)
            .about_version(claim_version(consensus_rule_set))
            .with_input(vec![BFieldElement::new(41)])
            .with_output(vec![BFieldElement::new(42)]);
        let non_determinism = NonDeterminism::new(vec![BFieldElement::new(1)]);
        let guard = ProvingGuard::new(Arc::new(AtomicBool::new(false)));

        let proof = ProofBuilder::produce(program, claim.clone(), non_determinism, &guard).unwrap();
        (claim, proof)
    }

    #[tokio::test]
    async fn nodes_accept_proofs_for_their_rule_set_only() {
        let network = Network::Main;

        let (gamma_claim, gamma_proof) = prove_for(ConsensusRuleSet::HardforkGamma);
        let (delta_claim, delta_proof) = prove_for(ConsensusRuleSet::HardforkDelta);

        assert!(
            verify_transaction_proof(gamma_claim.clone(), gamma_proof.clone().into(), network)
                .await
        );
        assert!(
            verify_transaction_proof(delta_claim.clone(), delta_proof.clone().into(), network)
                .await
        );

        // A version-5 proof checked as version 8 is the bug this branch fixes.
        assert!(!verify_transaction_proof(delta_claim, gamma_proof.into(), network).await);
        assert!(!verify_transaction_proof(gamma_claim, delta_proof.into(), network).await);
    }
}
