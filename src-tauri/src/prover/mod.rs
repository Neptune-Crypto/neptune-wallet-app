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

        let proof = ProofBuilder::produce(program, delta_claim.clone(), non_determinism).unwrap();

        assert!(verify_transaction_proof(delta_claim, proof.clone().into(), network).await);
        assert!(!verify_transaction_proof(gamma_claim, proof.into(), network).await);
    }
}
