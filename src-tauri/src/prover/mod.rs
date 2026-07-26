use std::sync::atomic::AtomicU64;
use std::sync::atomic::Ordering;

use neptune_wallet::triton_vm::prelude::Program;
use neptune_wallet::triton_vm::proof::Claim;
use neptune_wallet::triton_vm::proof::Proof;
use neptune_wallet::triton_vm::prove;
use neptune_wallet::triton_vm::stark::Stark;
use neptune_wallet::triton_vm::vm::NonDeterminism;
use thiserror::Error;
use tracing::*;

mod proof_collection;

/// Highest block height the node is known to have reached.
static OBSERVED_TIP_HEIGHT: AtomicU64 = AtomicU64::new(0);

/// Record a height the node is known to have.
///
/// Only moves forward, so a wallet catching up on old blocks cannot drag it below
/// what a transaction in progress was built against.
pub(crate) fn observe_tip_height(height: u64) {
    OBSERVED_TIP_HEIGHT.fetch_max(height, Ordering::Relaxed);
}

/// Move the observed height back after a reorg, where the chain is shorter than
/// the record above.
pub(crate) fn reset_observed_tip_height(height: u64) {
    OBSERVED_TIP_HEIGHT.store(height, Ordering::Relaxed);
}

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
pub(crate) struct ProvingGuard {
    built_against: u64,
}

impl ProvingGuard {
    pub(crate) fn new(built_against: u64) -> Self {
        Self { built_against }
    }

    fn is_stale(&self) -> bool {
        OBSERVED_TIP_HEIGHT.load(Ordering::Relaxed) > self.built_against
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

#[cfg(test)]
mod tests {
    use super::*;

    /// A proof is stale only once the chain has moved *past* the height it was
    /// built against. A wallet applying blocks it had not yet processed is not
    /// the chain moving forward, and abandoning on that throws away good proofs.
    ///
    /// Single test because the record is process wide: separate tests would race.
    #[test]
    fn stale_only_once_the_chain_moves_past_the_build_height() {
        reset_observed_tip_height(100);
        let guard = ProvingGuard::new(100);
        assert!(!guard.is_stale(), "nothing observed above the build height");

        observe_tip_height(99);
        assert!(!guard.is_stale(), "a lower block is a wallet catching up");

        observe_tip_height(100);
        assert!(!guard.is_stale(), "the build height itself is confirmable");

        observe_tip_height(101);
        assert!(guard.is_stale(), "a higher tip makes the proof stale");

        observe_tip_height(50);
        assert!(guard.is_stale(), "the record only ever moves forward");

        reset_observed_tip_height(100);
        assert!(!guard.is_stale(), "a reorg moves it back");
    }
}
