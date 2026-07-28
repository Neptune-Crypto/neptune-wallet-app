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
/// notion of blocks or of how far the wallet has synced.
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

        let default_stark: Stark = Stark::default();

        let proof = prove(default_stark, &claim, program, non_determinism)?;
        info!("triton-vm: completed proof");

        Ok(proof)
    }
}
