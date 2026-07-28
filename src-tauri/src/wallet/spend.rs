use std::sync::atomic::AtomicBool;
use std::sync::atomic::Ordering;
use std::sync::Arc;
use std::time::Duration;

use itertools::Itertools;
use neptune_consensus::block::block_header::BlockHeader;
use neptune_consensus::proof_abstractions::tx_proving_capability::TxProvingCapability;
use neptune_consensus::transaction::announcement::Announcement;
use neptune_consensus::transaction::transparent_input::TransparentInput;
use neptune_consensus::transaction::utxo::Utxo;
use neptune_consensus::transaction::Transaction;
use neptune_consensus::transaction::TransactionProof;
use neptune_consensus::type_scripts::native_currency_amount::NativeCurrencyAmount;
use neptune_mempool::transaction_kernel_id::Txid;
use neptune_mutator_set::mutator_set_accumulator::MutatorSetAccumulator;
use neptune_primitives::block_height::BlockHeight;
use neptune_primitives::timestamp::Timestamp;
use neptune_wallet::address::ReceivingAddress;
use neptune_wallet::address::SpendingKey;
use neptune_wallet::expected_utxo::ExpectedUtxo;
use neptune_wallet::expected_utxo::UtxoNotifier;
use neptune_wallet::transaction_details::TransactionDetails;
use neptune_wallet::transaction_output::TxOutput;
use neptune_wallet::transaction_output::TxOutputList;
use neptune_wallet::twenty_first::tip5::Digest;
use neptune_wallet::unlocked_utxo::UnlockedUtxo;
use neptune_wallet::utxo_notification::UtxoNotificationMedium;
use neptune_wallet::utxo_notification::UtxoNotificationMethod;
use num_traits::CheckedSub;
use thiserror::Error;
use tracing::*;

use super::input::tip_moved_since;
use super::input::InputSelectionRule;
use crate::config::Config;
use crate::prover::ProofBuilder;
use crate::prover::ProvingGuard;
use crate::prover::StaleProof;
use crate::rpc::OutputInfo;
use crate::rpc_client;
use crate::rpc_client::BroadcastError;
use crate::wallet::wallet_state_table::ExpectedUtxoData;

/// How many times a send builds and proves before giving up and telling the user.
///
/// A block landing during proving makes the proof unconfirmable, and a rebuild is
/// another full proving run that can lose the same race. Losing three in a row is
/// rare enough to surface: an unbroadcast transaction is in no mempool, so no
/// node knows it exists and nothing else can rescue it.
const MAX_SEND_ATTEMPTS: usize = 3;

/// How often to ask the node whether the tip moved while a proof is running.
///
/// Only bounds how late an abandonment can be, so it trades a cheap request
/// against wasted proving. Sub proofs are seconds to minutes long, so polling
/// faster than this would not abandon any sooner.
const TIP_POLL_INTERVAL: Duration = Duration::from_secs(10);

/// A transaction proven against one particular tip.
struct ProvenSend {
    transaction: Transaction,
    transaction_details: TransactionDetails,
    /// Database ids of the UTXOs spent as inputs.
    db_ids: Vec<i64>,
    /// All outputs, including change.
    full_outputs: TxOutputList,
    change_commitment: Option<String>,
}

impl super::WalletState {
    pub(crate) async fn send_to_address(
        &self,
        outputs: Vec<(ReceivingAddress, NativeCurrencyAmount)>,
        utxo_notification_media: (UtxoNotificationMedium, UtxoNotificationMedium),
        fee: NativeCurrencyAmount,
        rule: InputSelectionRule,
        must_include_utxos: Vec<i64>,
        accept_lustration: bool,
    ) -> anyhow::Result<(Transaction, Vec<OutputInfo>), SendError> {
        // Held for the whole send: until this transaction is recorded as pending,
        // its chosen inputs are invisible to input selection, so a second send
        // would happily pick them again.
        let _send_guard = self.send_lock.lock().await;
        let tx_proving_capability = TxProvingCapability::ProofCollection;

        let (owned_utxo_notification_medium, unowned_utxo_notification_medium) =
            utxo_notification_media;

        let _ = crate::service::app::emit_event_to(
            "main",
            "send_state",
            "stmi: step 1. get change key.",
        );

        let change_key = {
            // TODO: Improve privacy by avoiding the reuse of symmetric keys.
            let symmetric_key = self.key.nth_symmetric_key(0);
            let spending_key = SpendingKey::Symmetric(symmetric_key);
            // self.set_num_symmetric_keys(self.num_symmetric_keys() + 1)
            //     .await?;
            spending_key
        };

        // Pinning the first attempt's selection keeps the input set stable across
        // rebuilds, and with it the lustration decision the user approved.
        let mut pinned_inputs = must_include_utxos;
        let mut attempt = 1;

        let proven = loop {
            let _ = crate::service::app::emit_event_to(
                "main",
                "send_state",
                "stmi: step 2. generate outputs.",
            );

            // Fresh per attempt: the node rejects transactions that are too old.
            let now = Timestamp::now();

            // Everything that reads wallet state happens here, under the spend
            // lock. NOTE: a change output will be added to tx_outputs if needed.
            let (transaction_details, maybe_change_output, db_ids, tx_outputs, tip_header) = {
                let _spend_guard = self.spend_lock.lock().await;

                let (tx_inputs, db_ids, tip_msa, tip_header) = self
                    .create_input(&outputs, fee, rule, pinned_inputs.clone())
                    .await?;

                let tx_outputs = self
                    .generate_tx_outputs(
                        outputs.clone(),
                        owned_utxo_notification_medium,
                        unowned_utxo_notification_medium,
                        tip_header.height,
                    )
                    .await;

                let (details, change) = match self
                    .build_transaction_details(
                        tx_outputs.clone(),
                        tx_inputs,
                        change_key.clone(),
                        owned_utxo_notification_medium,
                        fee,
                        now,
                        tip_msa,
                        tip_header,
                    )
                    .await
                {
                    Ok(built) => built,
                    Err(e) => {
                        tracing::error!("Could not create transaction: {}", e);
                        return Err(e.into());
                    }
                };

                (details, change, db_ids, tx_outputs, tip_header)
            };

            // Checked before proving so a rejected transaction costs no proof.
            if transaction_details.contains_lustrations() && !accept_lustration {
                let lustration_status = tip_header
                    .pow
                    .lustration_status()
                    .expect("If transaction requires lustration, lustration status must be set.");
                return Err(SendError::RequiresLustration(LustrationError(format!(
                    "All inputs with AOCL ranges at or below {} must lustrate. \
                     You must accept lustrations before making this transaction.",
                    lustration_status.max_lustrating_aocl_leaf_index
                ))));
            }

            // Shown for minutes while proving; on a rebuild it says why.
            let _ = crate::service::app::emit_event_to(
                "main",
                "send_state",
                if attempt == 1 {
                    "stmi: step 3. create tx."
                } else {
                    "stmi: step 3. create tx, rebuild after new block."
                },
            );

            // No spend lock here. Proving takes minutes and touches no wallet
            // state, so blocks keep being applied while it runs.
            let proving = self
                .create_raw_transaction(&transaction_details, tx_proving_capability, tip_header)
                .await;

            let transaction = match proving {
                Ok(tx) => tx,
                // Abandoned, not failed: a block landed, so the tip check below
                // would have rejected this proof anyway. Fall through to it.
                Err(e) if e.downcast_ref::<StaleProof>().is_some() => {
                    if attempt == MAX_SEND_ATTEMPTS {
                        warn!(
                            "Abandoned proving on the final attempt. Recording the \
                             transaction as pending for the updater to rebuild."
                        );
                        // Nothing proven to enqueue, so this attempt ends the send.
                        return Err(SendError::Proof(e));
                    }
                    attempt += 1;
                    info!(
                        "Rebuilding the transaction against the node's new tip \
                         (attempt {attempt} of {MAX_SEND_ATTEMPTS})."
                    );
                    pinned_inputs = db_ids;
                    continue;
                }
                Err(e) => {
                    tracing::error!("Could not prove transaction: {}", e);
                    return Err(e.into());
                }
            };

            let _ = crate::service::app::emit_event_to(
                "main",
                "send_state",
                "stmi: step 4. extract expected utxos.",
            );

            // The change output (funds returning to us) is created explicitly.
            // Capture its commitment now, before maybe_change_output is consumed
            // below, so the per-output summary can flag it. Note
            // create_change_output builds it with onchain/offchain_native_currency
            // (NOT the *_as_change variant), so TxOutput::is_change() is always
            // false here and cannot be relied on.
            let change_commitment = maybe_change_output
                .as_ref()
                .map(|txo| txo.addition_record().canonical_commitment.to_hex());

            let mut full_outputs = tx_outputs;
            if let Some(change_output) = maybe_change_output {
                full_outputs.push(change_output);
            }

            let proven = ProvenSend {
                transaction,
                transaction_details,
                db_ids,
                full_outputs,
                change_commitment,
            };

            // If the node moved on while we proved, this can never confirm.
            let stale = if tip_moved_since(&tip_header).await {
                info!(
                    "A block arrived while proving; the transaction is no longer \
                     confirmable relative to the node's mutator set."
                );
                true
            } else {
                let _ = crate::service::app::emit_event_to(
                    "main",
                    "send_state",
                    "stmi: step 5. broadcast transaction.",
                );

                match rpc_client::node_rpc_client()
                    .broadcast_transaction(proven.transaction.clone())
                    .await
                {
                    Ok(_txid) => false,
                    // Lost the race between the check and the submission.
                    Err(BroadcastError::NotConfirmable) => {
                        info!("Node rejected the transaction as not confirmable.");
                        true
                    }
                    Err(e) => return Err(e.into()),
                }
            };

            if !stale {
                break proven;
            }

            if attempt == MAX_SEND_ATTEMPTS {
                warn!("Could not broadcast the transaction within {MAX_SEND_ATTEMPTS} attempts.");
                // An unbroadcast transaction is in no mempool, so nothing would
                // ever advance it. Recording it as pending would strand it.
                return Err(SendError::NotConfirmable(NotConfirmableError(format!(
                    "A new block arrived during each of {MAX_SEND_ATTEMPTS} attempts to \
                     prove this transaction, so none of them could be submitted. \
                     Please try again."
                ))));
            }

            attempt += 1;
            info!(
                "Rebuilding the transaction against the node's new tip \
                 (attempt {attempt} of {MAX_SEND_ATTEMPTS})."
            );
            pinned_inputs = proven.db_ids;
        };

        // Back under the spend lock: everything below writes wallet state.
        let _spend_guard = self.spend_lock.lock().await;

        // Derived from the transaction, not assigned by the node.
        let txid = proven.transaction.txid().to_string();
        let now = Timestamp::now();

        let utxos_sent_to_self =
            self.extract_expected_utxos(&proven.full_outputs, UtxoNotifier::Myself);

        let _ = crate::service::app::emit_event_to(
            "main",
            "send_state",
            "stmi: step 6. store locally.",
        );

        let expected_utxo_data = utxos_sent_to_self
            .into_iter()
            .map(|expected_utxo| ExpectedUtxoData {
                id: 0,
                txid: txid.clone(),
                expected_utxo,
                timestamp: now,
            })
            .collect();
        self.add_expected_utxo(expected_utxo_data).await?;

        // Each recipient address keyed by its privacy digest, so an output can be
        // matched back to the address it pays. Robust regardless of output order,
        // since the digest uniquely identifies a receiving address.
        let recipient_addresses: Vec<(Digest, String)> = outputs
            .iter()
            .filter_map(|(addr, _)| {
                addr.to_bech32m(self.network)
                    .ok()
                    .map(|bech32m| (addr.privacy_digest(), bech32m))
            })
            .collect();

        // Per-output summary. tx_outputs is what the kernel's outputs
        // are derived from (TransactionDetails::transaction_kernel), so these
        // commitments match the on-chain outputs exactly. The change output is
        // identified by its commitment (see change_commitment above).
        let output_infos = proven
            .transaction_details
            .tx_outputs
            .iter()
            .map(|txo| {
                let commitment = txo.addition_record().canonical_commitment.to_hex();
                let is_change = proven.change_commitment.as_deref() == Some(commitment.as_str());
                let address = if is_change {
                    None
                } else {
                    recipient_addresses
                        .iter()
                        .find(|(digest, _)| *digest == txo.receiver_digest())
                        .map(|(_, bech32m)| bech32m.clone())
                };
                OutputInfo {
                    commitment,
                    amount: txo.native_currency_amount().display_lossless(),
                    is_change,
                    address,
                }
            })
            .collect();

        // Recorded as pending so the balance reflects it and the UI can show it
        // awaiting confirmation. The node maintains the transaction from here.
        self.updater
            .add_transaction(txid.clone(), proven.transaction_details, proven.db_ids)
            .await?;

        // Refresh the accounts list's cached total (otherwise only rewritten on
        // block sync): the send just moved coins into pending, so the cached
        // figure would overstate this account's balance until the next block.
        // Best effort. The transaction is already recorded, so a cache miss must
        // not fail the send.
        match self.get_all_balance().await {
            Ok((_available, _pending, total)) => {
                let config = crate::service::get_state::<Arc<Config>>();
                if let Err(e) = config
                    .update_wallet_balance(self.id, total.display_lossless())
                    .await
                {
                    warn!("Could not update cached account balance after send: {}", e);
                }
            }
            Err(e) => warn!("Could not compute balance after send: {}", e),
        }

        Ok((proven.transaction, output_infos))
    }

    /// Cheap pre-check: would a transaction built from these parameters require
    /// lustration, and which inputs would it spend?
    ///
    /// Runs the same input selection as [`Self::send_to_address`] and applies the
    /// same consensus rule that decides whether an input must lustrate (its AOCL
    /// range starts at or below the tip's `max_lustrating_aocl_leaf_index`), but
    /// stops *before* the minutes-long proving step. This lets the UI prompt the
    /// user up front instead of proving, failing with [`SendError::RequiresLustration`],
    /// prompting, and then proving a second time.
    ///
    /// Because selection happens here (server-side), this works for auto-selected
    /// inputs as well as an explicit `must_include_utxos` set. Returns the db ids of
    /// the selected inputs so the caller can pin them: passing them back as the
    /// send's inputs keeps the selection — and thus this lustration decision — stable
    /// even if a new block arrives before the send re-selects.
    pub(crate) async fn requires_lustration(
        &self,
        outputs: Vec<(ReceivingAddress, NativeCurrencyAmount)>,
        fee: NativeCurrencyAmount,
        rule: InputSelectionRule,
        must_include_utxos: Vec<i64>,
    ) -> anyhow::Result<(bool, Vec<i64>)> {
        let (tx_inputs, db_ids, _tip_msa, tip_header) = self
            .create_input(&outputs, fee, rule, must_include_utxos)
            .await?;

        // No threshold set (e.g. before the relevant hard fork) => never required.
        let Ok(lustration_status) = tip_header.pow.lustration_status() else {
            return Ok((false, db_ids));
        };

        // Reuse the exact logic the real send uses to decide which inputs lustrate.
        let tx_inputs: Vec<TransparentInput> = tx_inputs.into_iter().map(|x| x.into()).collect();
        let lustrations = Announcement::lustration_announcements(lustration_status, &tx_inputs);
        Ok((!lustrations.is_empty(), db_ids))
    }

    async fn generate_tx_outputs(
        &self,
        outputs: impl IntoIterator<Item = (ReceivingAddress, NativeCurrencyAmount)>,
        owned_utxo_notify_medium: UtxoNotificationMedium,
        unowned_utxo_notify_medium: UtxoNotificationMedium,
        block_height: BlockHeight,
    ) -> TxOutputList {
        // Convert outputs.  [address:amount] --> TxOutputList
        let tx_outputs: Vec<_> = outputs
            .into_iter()
            .map(|(address, amount)| {
                let sender_randomness = self
                    .key
                    .generate_sender_randomness(block_height, address.privacy_digest());

                // The UtxoNotifyMethod (Onchain or Offchain) is auto-detected
                // based on whether the address belongs to our wallet or not
                self.auto_outputs(
                    address,
                    amount,
                    sender_randomness,
                    owned_utxo_notify_medium,
                    unowned_utxo_notify_medium,
                )
            })
            .collect();

        tx_outputs.into()
    }

    fn can_unlock(&self, utxo: &Utxo) -> bool {
        self.all_known_keys()
            .iter()
            .find(|k| k.lock_script_hash() == utxo.lock_script_hash())
            .is_some()
    }

    fn auto_outputs(
        &self,
        address: ReceivingAddress,
        amount: NativeCurrencyAmount,
        sender_randomness: Digest,
        owned_utxo_notify_medium: UtxoNotificationMedium,
        unowned_utxo_notify_medium: UtxoNotificationMedium,
    ) -> TxOutput {
        let utxo = Utxo::new_native_currency(address.lock_script_hash(), amount);

        let has_matching_spending_key = self.can_unlock(&utxo);

        let receiver_digest = address.privacy_digest();
        let notification_method = if has_matching_spending_key {
            match owned_utxo_notify_medium {
                UtxoNotificationMedium::OnChain => UtxoNotificationMethod::OnChain(address),
                UtxoNotificationMedium::OffChain => UtxoNotificationMethod::OffChain(address),
            }
        } else {
            match unowned_utxo_notify_medium {
                UtxoNotificationMedium::OnChain => UtxoNotificationMethod::OnChain(address),
                UtxoNotificationMedium::OffChain => UtxoNotificationMethod::OffChain(address),
            }
        };

        TxOutput::new(
            utxo,
            sender_randomness,
            receiver_digest,
            notification_method,
            has_matching_spending_key,
            false,
        )
    }

    /// Assemble everything a transaction needs *except* its proof.
    ///
    /// Split from the proving step so the caller can drop the spend lock before
    /// paying for a proof: this part reads wallet state, that part does not.
    #[expect(clippy::too_many_arguments)]
    async fn build_transaction_details(
        &self,
        mut tx_outputs: TxOutputList,
        tx_inputs: Vec<UnlockedUtxo>,
        change_key: SpendingKey,
        change_utxo_notify_medium: UtxoNotificationMedium,
        fee: NativeCurrencyAmount,
        timestamp: Timestamp,
        tip_msa: MutatorSetAccumulator,
        tip_header: BlockHeader,
    ) -> anyhow::Result<(TransactionDetails, Option<TxOutput>)> {
        // 1. create/add change output if necessary.
        let total_spend = tx_outputs.total_native_coins() + fee;

        let total_spendable = tx_inputs
            .iter()
            .map(|x| x.utxo.get_native_currency_amount())
            .sum();

        // Add change, if required to balance tx.
        let mut maybe_change_output = None;
        if total_spend < total_spendable {
            let amount = total_spendable.checked_sub(&total_spend).ok_or_else(|| {
                anyhow::anyhow!("overflow subtracting total_spend from input_amount")
            })?;

            let change_utxo = self
                .create_change_output(
                    amount,
                    change_key,
                    change_utxo_notify_medium,
                    tip_header.height,
                )
                .await?;
            tx_outputs.push(change_utxo.clone());
            maybe_change_output = Some(change_utxo);
        }

        let mut transaction_details = TransactionDetails::new_without_coinbase(
            tx_inputs.clone(),
            tx_outputs.to_owned(),
            fee,
            timestamp,
            tip_msa,
            self.network,
        );

        // if lustration is required create those here
        let tx_inputs: Vec<TransparentInput> = tx_inputs.into_iter().map(|x| x.into()).collect();
        if let Ok(lustration_status) = tip_header.pow.lustration_status() {
            let lustrations = Announcement::lustration_announcements(lustration_status, &tx_inputs);

            transaction_details = transaction_details.with_announcements(lustrations);
        }

        Ok((transaction_details, maybe_change_output))
    }

    /// Generate a change UTXO to ensure that the difference in input amount
    /// and output amount goes back to us. Return the UTXO in a format compatible
    /// with claiming it later on.
    //
    // "Later on" meaning: as an [ExpectedUtxo].
    async fn create_change_output(
        &self,
        change_amount: NativeCurrencyAmount,
        change_key: SpendingKey,
        change_utxo_notify_method: UtxoNotificationMedium,
        tip_height: BlockHeight,
    ) -> anyhow::Result<TxOutput> {
        let own_receiving_address = change_key.to_address();

        let receiver_digest = own_receiving_address.privacy_digest();
        let change_sender_randomness = {
            self.key
                .generate_sender_randomness(tip_height, receiver_digest)
        };

        let owned = true;
        let change_output = match change_utxo_notify_method {
            UtxoNotificationMedium::OnChain => TxOutput::onchain_native_currency(
                change_amount,
                change_sender_randomness,
                own_receiving_address,
                owned,
            ),
            UtxoNotificationMedium::OffChain => TxOutput::offchain_native_currency(
                change_amount,
                change_sender_randomness,
                own_receiving_address,
                owned,
            ),
        };

        Ok(change_output)
    }

    /// creates a Transaction.
    ///
    /// This API provides the caller complete control over selection of inputs
    /// and outputs.
    ///
    /// It is the caller's responsibility to provide inputs and outputs such
    /// that sum(inputs) == sum(outputs) + fee.  Else an error will result.
    ///
    /// Note that this means the caller must calculate the `change` amount if any
    /// and provide an output for the change.
    ///
    /// The `tx_outputs` parameter should normally be generated with
    /// [Self::generate_tx_outputs()] which determines which outputs should be
    /// notified `OnChain` or `OffChain`.
    ///
    /// After this call returns, it is the caller's responsibility to inform the
    /// wallet of any returned [ExpectedUtxo] for utxos that match wallet keys.
    /// Failure to do so can result in loss of funds!
    ///
    /// Note that `create_raw_transaction()` does not modify any state and does
    /// not require acquiring write lock.  This is important because internally
    /// it calls prove() which is a very lengthy operation.
    pub(crate) async fn create_raw_transaction(
        &self,
        transaction_details: &TransactionDetails,
        proving_power: TxProvingCapability,
        built_against: BlockHeader,
    ) -> anyhow::Result<Transaction> {
        // note: this executes the prover which can take a very
        //       long time, perhaps minutes.  The `await` here, should avoid
        //       block the tokio executor and other async tasks.
        Self::create_transaction_from_data_worker(transaction_details, proving_power, built_against)
            .await
    }

    async fn create_transaction_from_data_worker(
        transaction_details: &TransactionDetails,
        proving_power: TxProvingCapability,
        built_against: BlockHeader,
    ) -> anyhow::Result<Transaction> {
        let primitive_witness = transaction_details.primitive_witness();

        debug!("primitive witness for transaction: {}", primitive_witness);

        info!(
            "Start: generate proof for {}-in {}-out transaction",
            primitive_witness.input_utxos.utxos.len(),
            primitive_witness.output_utxos.utxos.len()
        );
        let kernel = primitive_witness.kernel.clone();
        let proof = match proving_power {
            TxProvingCapability::PrimitiveWitness => TransactionProof::Witness(primitive_witness),
            TxProvingCapability::LockScript => todo!(),
            TxProvingCapability::ProofCollection => {
                // Ask the node whether the tip still matches the one this
                // transaction was built against. Comparing whole headers catches
                // a reorg that keeps the same height, and asking the node keeps
                // this independent of how far the wallet itself has synced.
                let stale = Arc::new(AtomicBool::new(false));
                let watcher = {
                    let stale = stale.clone();
                    tokio::spawn(async move {
                        loop {
                            tokio::time::sleep(TIP_POLL_INTERVAL).await;
                            if tip_moved_since(&built_against).await {
                                stale.store(true, Ordering::Relaxed);
                                return;
                            }
                        }
                    })
                };

                let guard = ProvingGuard::new(stale);
                let collection = tokio::task::spawn_blocking(move || {
                    ProofBuilder::produce_proof_collection(&primitive_witness, &guard)
                })
                .await;
                watcher.abort();

                TransactionProof::ProofCollection(collection??)
            }
            TxProvingCapability::SingleProof => todo!(),
        };

        Ok(Transaction { kernel, proof })
    }

    /// Extract `ExpectedUtxo`s from the `TxOutputList` that require off-chain
    /// notifications and that are destined for this wallet.
    pub(crate) fn extract_expected_utxos(
        &self,
        tx_outputs: &TxOutputList,
        notifier: UtxoNotifier,
    ) -> Vec<ExpectedUtxo> {
        tx_outputs
            .iter()
            .filter(|txo| txo.is_offchain())
            .filter_map(|txo| {
                self.find_spending_key_for_utxo(&txo.utxo())
                    .map(|sk| (txo, sk))
            })
            .map(|(tx_output, spending_key)| {
                ExpectedUtxo::new(
                    tx_output.utxo(),
                    tx_output.sender_randomness(),
                    spending_key.privacy_preimage(),
                    notifier,
                )
            })
            .collect_vec()
    }
}

#[derive(Debug, Error)]
#[error("Lustration is required for this transaction: {0}")]
pub struct LustrationError(pub String);

/// Every attempt lost its race against a new block, so none could be submitted.
/// Nothing was broadcast, so nothing is left behind to retry: the user has to
/// start the send again.
#[derive(Debug, Error)]
#[error("{0}")]
pub struct NotConfirmableError(pub String);

#[derive(Debug, Error)]
pub(crate) enum SendError {
    #[error(transparent)]
    Proof(#[from] anyhow::Error),
    #[error(transparent)]
    Broadcast(#[from] BroadcastError),
    #[error(transparent)]
    RequiresLustration(#[from] LustrationError),
    #[error(transparent)]
    NotConfirmable(#[from] NotConfirmableError),
}
