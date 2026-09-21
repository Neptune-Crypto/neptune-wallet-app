use anyhow::Result;
use itertools::Itertools;
use neptune_consensus::consensus_rule_set::ConsensusRuleSet;
use neptune_consensus::consensus_rule_set::TritonProofVersion;
use neptune_consensus::proof_abstractions::SecretWitness;
use neptune_consensus::transaction::primitive_witness::PrimitiveWitness;
use neptune_consensus::transaction::transaction_kernel::TransactionKernelField;
use neptune_consensus::transaction::validity::collect_lock_scripts::CollectLockScriptsWitness;
use neptune_consensus::transaction::validity::collect_type_scripts::CollectTypeScriptsWitness;
use neptune_consensus::transaction::validity::kernel_to_outputs::KernelToOutputsWitness;
use neptune_consensus::transaction::validity::proof_collection::ProofCollection;
use neptune_consensus::transaction::validity::removal_records_integrity::RemovalRecordsIntegrityWitness;
use neptune_primitives::mast_hash::MastHash;
use neptune_wallet::tasm_lib::prelude::Tip5;
use neptune_wallet::triton_vm::proof::Claim;
use neptune_wallet::triton_vm::vm::PublicInput;
use tracing::debug;
use tracing::info;

/// Mirrors `TritonProofVersion::version`, which neptune-consensus does not
/// export. Nodes reject a proof whose claim carries any other version.
pub(crate) fn claim_version(consensus_rule_set: ConsensusRuleSet) -> u32 {
    match consensus_rule_set.triton_proof_version() {
        TritonProofVersion::V0 => 0,
        TritonProofVersion::V1 => 1,
        TritonProofVersion::V5 => 5,
        TritonProofVersion::V8 => 8,
    }
}

impl super::ProofBuilder {
    /// Prove a transaction for the rule set of the block it is built against.
    pub(crate) fn produce_proof_collection(
        primitive_witness: &PrimitiveWitness,
        consensus_rule_set: ConsensusRuleSet,
        guard: &super::ProvingGuard,
    ) -> Result<ProofCollection> {
        let proof_version = claim_version(consensus_rule_set);
        let (
            removal_records_integrity_witness,
            collect_lock_scripts_witness,
            kernel_to_outputs_witness,
            collect_type_scripts_witness,
        ) = Self::extract_specific_witnesses(primitive_witness);

        let txk_mast_hash = primitive_witness.kernel.mast_hash();
        let txk_mast_hash_as_input = PublicInput::new(txk_mast_hash.reversed().values().to_vec());
        let salted_inputs_hash = Tip5::hash(&primitive_witness.input_utxos);
        let salted_outputs_hash = Tip5::hash(&primitive_witness.output_utxos);
        debug!("proving, txk hash: {}", txk_mast_hash);
        debug!("proving, salted inputs hash: {}", salted_inputs_hash);
        debug!("proving, salted outputs hash: {}", salted_outputs_hash);
        debug!("proving for {consensus_rule_set}, claim version {proof_version}");

        // prove
        debug!("proving RemovalRecordsIntegrity");
        let removal_records_integrity = Self::produce(
            removal_records_integrity_witness.program(),
            removal_records_integrity_witness
                .claim()
                .about_version(proof_version),
            removal_records_integrity_witness.nondeterminism(),
            guard,
        )?
        .into();

        debug!("proving CollectLockScripts");
        let collect_lock_scripts = Self::produce(
            collect_lock_scripts_witness.program(),
            collect_lock_scripts_witness
                .claim()
                .about_version(proof_version),
            collect_lock_scripts_witness.nondeterminism(),
            guard,
        )?
        .into();

        debug!("proving KernelToOutputs");
        let kernel_to_outputs = Self::produce(
            kernel_to_outputs_witness.program(),
            kernel_to_outputs_witness
                .claim()
                .about_version(proof_version),
            kernel_to_outputs_witness.nondeterminism(),
            guard,
        )?
        .into();

        debug!("proving CollectTypeScripts");
        let collect_type_scripts = Self::produce(
            collect_type_scripts_witness.program(),
            collect_type_scripts_witness
                .claim()
                .about_version(proof_version),
            collect_type_scripts_witness.nondeterminism(),
            guard,
        )?
        .into();

        debug!("proving lock scripts");
        let mut lock_scripts_halt = vec![];
        for lock_script_and_witness in &primitive_witness.lock_scripts_and_witnesses {
            let claim = Claim::new(lock_script_and_witness.program.hash())
                .about_version(proof_version)
                .with_input(txk_mast_hash_as_input.clone().individual_tokens);
            let lock_script_and_witness = Self::produce(
                lock_script_and_witness.program.clone(),
                claim,
                lock_script_and_witness.nondeterminism(),
                guard,
            )?
            .into();
            lock_scripts_halt.push(lock_script_and_witness);
        }

        debug!("proving type scripts");
        let mut type_scripts_halt = vec![];
        for (i, tsaw) in primitive_witness
            .type_scripts_and_witnesses
            .iter()
            .enumerate()
        {
            debug!("proving type script number {i}: {}", tsaw.program.hash());
            let input: Vec<_> = [txk_mast_hash, salted_inputs_hash, salted_outputs_hash]
                .into_iter()
                .flat_map(|d| d.reversed().values())
                .collect();
            let claim = Claim::new(tsaw.program.hash())
                .about_version(proof_version)
                .with_input(input);

            let type_script_halt =
                Self::produce(tsaw.program.clone(), claim, tsaw.nondeterminism(), guard)?.into();

            type_scripts_halt.push(type_script_halt);
        }
        info!("done proving proof collection");

        // collect hashes
        let lock_script_hashes = primitive_witness
            .lock_scripts_and_witnesses
            .iter()
            .map(|lsaw| lsaw.program.hash())
            .collect_vec();
        let type_script_hashes = primitive_witness
            .type_scripts_and_witnesses
            .iter()
            .map(|tsaw| tsaw.program.hash())
            .collect_vec();

        let merge_bit_mast_path = primitive_witness
            .kernel
            .mast_path(TransactionKernelField::MergeBit);

        Ok(ProofCollection {
            removal_records_integrity,
            collect_lock_scripts,
            lock_scripts_halt,
            kernel_to_outputs,
            collect_type_scripts,
            type_scripts_halt,
            lock_script_hashes,
            type_script_hashes,
            kernel_mast_hash: txk_mast_hash,
            salted_inputs_hash,
            salted_outputs_hash,
            merge_bit_mast_path,
        })
    }

    fn extract_specific_witnesses(
        primitive_witness: &PrimitiveWitness,
    ) -> (
        RemovalRecordsIntegrityWitness,
        CollectLockScriptsWitness,
        KernelToOutputsWitness,
        CollectTypeScriptsWitness,
    ) {
        // collect witnesses
        let removal_records_integrity_witness =
            RemovalRecordsIntegrityWitness::from(primitive_witness);
        let collect_lock_scripts_witness = CollectLockScriptsWitness::from(primitive_witness);
        let kernel_to_outputs_witness = KernelToOutputsWitness::from(primitive_witness);
        let collect_type_scripts_witness = CollectTypeScriptsWitness::from(primitive_witness);

        (
            removal_records_integrity_witness,
            collect_lock_scripts_witness,
            kernel_to_outputs_witness,
            collect_type_scripts_witness,
        )
    }
}

#[cfg(test)]
mod tests {
    use neptune_consensus::consensus_rule_set::BLOCK_HEIGHT_HARDFORK_DELTA_MAIN_NET;
    use neptune_consensus::proof_abstractions::tasm::legacy_stark_verify::claim_uses_legacy_proof_system;
    use neptune_primitives::network::Network;
    use neptune_wallet::triton_vm::prelude::BFieldElement;
    use neptune_wallet::twenty_first::tip5::Digest;
    use strum::IntoEnumIterator;

    use super::*;

    /// Only the claims are inspected here, so the proofs are empty.
    fn unproven_collection() -> ProofCollection {
        let no_proof = || Vec::<BFieldElement>::new().into();
        ProofCollection {
            removal_records_integrity: no_proof(),
            collect_lock_scripts: no_proof(),
            lock_scripts_halt: vec![no_proof()],
            kernel_to_outputs: no_proof(),
            collect_type_scripts: no_proof(),
            type_scripts_halt: vec![no_proof()],
            lock_script_hashes: vec![Digest::default()],
            type_script_hashes: vec![Digest::default()],
            kernel_mast_hash: Digest::default(),
            salted_inputs_hash: Digest::default(),
            salted_outputs_hash: Digest::default(),
            merge_bit_mast_path: vec![],
        }
    }

    /// A mismatch here means every transaction is rejected as invalid.
    #[test]
    fn claim_version_matches_the_claims_nodes_verify() {
        let collection = unproven_collection();
        for rule_set in ConsensusRuleSet::iter() {
            let expected = claim_version(rule_set);
            let claims = [
                collection.removal_records_integrity_claim(rule_set),
                collection.kernel_to_outputs_claim(rule_set),
                collection.collect_lock_scripts_claim(rule_set),
                collection.collect_type_scripts_claim(rule_set),
            ]
            .into_iter()
            .chain(collection.lock_script_claims(rule_set))
            .chain(collection.type_script_claims(rule_set));

            for claim in claims {
                assert_eq!(expected, claim.version, "under {rule_set}");
            }
        }
    }

    #[test]
    fn delta_switches_proving_to_the_new_proof_system() {
        let network = Network::Main;
        let last_gamma = BLOCK_HEIGHT_HARDFORK_DELTA_MAIN_NET.previous().unwrap();
        let claim_at = |height| {
            Claim::new(Digest::default())
                .about_version(claim_version(ConsensusRuleSet::infer_from(network, height)))
        };

        assert!(claim_uses_legacy_proof_system(&claim_at(last_gamma)));
        assert!(!claim_uses_legacy_proof_system(&claim_at(
            BLOCK_HEIGHT_HARDFORK_DELTA_MAIN_NET
        )));
        assert_eq!(
            neptune_wallet::triton_vm::proof::CURRENT_VERSION,
            claim_at(BLOCK_HEIGHT_HARDFORK_DELTA_MAIN_NET).version,
        );
        // Gamma is settled history, so its claims stay at version 5.
        assert_eq!(5, claim_at(last_gamma).version);
    }
}
