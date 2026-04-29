use std::str::FromStr;

use anyhow::bail;
use anyhow::ensure;
use anyhow::Context;
use anyhow::Result;
use neptune_cash::api::export::BlockHeight;
use neptune_cash::api::export::NativeCurrencyAmount;
use neptune_cash::api::export::ReceivingAddress;
use neptune_cash::api::export::SpendingKey;
use neptune_cash::api::export::Timestamp;
use neptune_cash::api::export::Tip5;
use neptune_cash::api::export::Utxo;
use neptune_cash::protocol::consensus::block::block_header::BlockHeader;
use neptune_cash::protocol::consensus::block::pow::LustrationStatus;
use neptune_cash::state::wallet::unlocked_utxo::UnlockedUtxo;
use neptune_cash::util_types::mutator_set::mutator_set_accumulator::MutatorSetAccumulator;
use neptune_cash::util_types::mutator_set::removal_record::absolute_index_set::AbsoluteIndexSet;
use rand::seq::SliceRandom;
use tracing::trace;

use super::wallet_state_table::UtxoDbData;
use super::UtxoRecoveryData;
use crate::rpc_client;

#[derive(Default)]
pub(crate) enum InputSelectionRule {
    Minimum,
    Maximum,
    #[default]
    Oldest,
    Newest,
    Random,
}

impl FromStr for InputSelectionRule {
    type Err = ();

    fn from_str(s: &str) -> std::result::Result<Self, Self::Err> {
        match s {
            "minimum" => Ok(InputSelectionRule::Minimum),
            "maximum" => Ok(InputSelectionRule::Maximum),
            "oldest" => Ok(InputSelectionRule::Oldest),
            "newest" => Ok(InputSelectionRule::Newest),
            "random" => Ok(InputSelectionRule::Random),
            _ => Err(()),
        }
    }
}

impl InputSelectionRule {
    pub(crate) fn apply(&self, mut utxos: Vec<UtxoDbData>) -> Vec<UtxoDbData> {
        match self {
            InputSelectionRule::Minimum => utxos.sort_by(|a, b| {
                a.recovery_data
                    .utxo
                    .get_native_currency_amount()
                    .cmp(&b.recovery_data.utxo.get_native_currency_amount())
            }),
            InputSelectionRule::Maximum => utxos.sort_by(|a, b| {
                b.recovery_data
                    .utxo
                    .get_native_currency_amount()
                    .cmp(&a.recovery_data.utxo.get_native_currency_amount())
            }),
            InputSelectionRule::Oldest => utxos.sort_by_key(|a| a.confirm_height),
            InputSelectionRule::Newest => {
                utxos.sort_by_key(|x| std::cmp::Reverse(x.confirm_height))
            }
            InputSelectionRule::Random => utxos.shuffle(&mut rand::rng()),
        };
        utxos
    }
}

impl super::WalletState {
    pub(crate) async fn create_input(
        &self,
        outputs: &[(ReceivingAddress, NativeCurrencyAmount)],
        fee: NativeCurrencyAmount,
        rule: InputSelectionRule,
        must_include_inputs: Vec<i64>,
    ) -> anyhow::Result<(
        Vec<UnlockedUtxo>,
        Vec<i64>,
        MutatorSetAccumulator,
        BlockHeader,
    )> {
        let mut utxos = {
            let mut tx = self.pool.begin().await?;
            self.get_unspent_utxos(&mut tx).await?
        };
        trace!("Num unspent utxos (not mined): {}", utxos.len());

        let pending_utxos = self.updater.get_pending_spent_utxos().await?;
        utxos.retain(|utxo| !pending_utxos.contains(&utxo.id));
        trace!(
            "Num unspent utxos (not mined and not in mempool): {}",
            utxos.len()
        );

        let utxos = rule.apply(utxos);
        let unspent: Vec<_> = utxos
            .into_iter()
            .filter(|utxo| !must_include_inputs.contains(&utxo.id))
            .collect();
        trace!("Choosing inputs from {} UTXOs", unspent.len());

        let total_amount = outputs
            .iter()
            .map(|(_, amount)| amount.to_nau())
            .sum::<i128>()
            + fee.to_nau();
        trace!(
            "Total amount required: {}",
            NativeCurrencyAmount::from_nau(total_amount)
        );

        let inputs = self
            .get_unspent_inputs_with_ids(&must_include_inputs)
            .await?;
        trace!("Number of preselected inputs: {}", inputs.len());

        let mut inputs = inputs
            .into_iter()
            .map(|input| input.recovery_data)
            .collect::<Vec<_>>();

        let mut total_input_amount = inputs
            .iter()
            .map(|input| input.utxo.get_native_currency_amount().to_nau())
            .sum::<i128>();

        let now = Timestamp::now();
        let mut db_idxs = must_include_inputs.clone();
        for utxo in unspent {
            let recovery_data = utxo.recovery_data;
            if total_input_amount >= total_amount {
                break;
            }

            if let Some(release) = recovery_data.utxo.release_date() {
                if release > now {
                    continue;
                }
            }

            total_input_amount += recovery_data.utxo.get_native_currency_amount().to_nau();
            inputs.push(recovery_data);
            db_idxs.push(utxo.id);
        }

        trace!("Selected a total of {} inputs", inputs.len());
        let (inputs, tip_msa, tip_header) = self.unlock_utxos(inputs).await?;
        trace!("Managed to unlock {} inputs", inputs.len());

        trace!("Inputs length is: {}", inputs.len());
        trace!("db_idxs.len() = {}", db_idxs.len());
        ensure!(
            inputs.len() == db_idxs.len(),
            "Inputs and db_idxs must have the same length"
        );

        Ok((inputs, db_idxs, tip_msa, tip_header))
    }

    /// Returns triple  (list of unlocked UTXOs, tip mutator set, tip header)
    pub(crate) async fn unlock_utxos(
        &self,
        utxos: Vec<UtxoRecoveryData>,
    ) -> anyhow::Result<(Vec<UnlockedUtxo>, MutatorSetAccumulator, BlockHeader)> {
        let mut index_sets = Vec::with_capacity(utxos.len());

        for utxo in &utxos {
            let item = Tip5::hash(&utxo.utxo);
            let index_set = AbsoluteIndexSet::compute(
                item,
                utxo.sender_randomness,
                utxo.receiver_preimage,
                utxo.aocl_index,
            );

            index_sets.push(index_set);
        }

        let (msmps_recovery_data, tip_header) = loop {
            trace!("Requesting {} ms membership proofs", index_sets.len());
            let msmps_recovery_data = rpc_client::node_rpc_client()
                .restore_msmps(index_sets.clone())
                .await?;
            trace!(
                "Received {} ms membership proofs",
                msmps_recovery_data.membership_proofs.len()
            );

            let tip_header = rpc_client::node_rpc_client().get_tip_header().await?;

            if tip_header.height == msmps_recovery_data.tip_height {
                break (msmps_recovery_data, tip_header);
            }
        };

        let mut unlocked = Vec::with_capacity(utxos.len());
        for (recovery_data, utxo) in msmps_recovery_data.membership_proofs.into_iter().zip(utxos) {
            let spending_key = self
                .find_spending_key_for_utxo(&utxo.utxo)
                .context("No spending key found for utxo")?;

            let membership_proof = match recovery_data.extract_ms_membership_proof(
                utxo.aocl_index,
                utxo.sender_randomness,
                utxo.receiver_preimage,
            ) {
                Ok(msmp) => msmp,
                Err(err) => bail!(
                    "Server returned bad mutator set membership proof recovery data: {}",
                    err
                ),
            };

            unlocked.push(UnlockedUtxo::unlock(
                utxo.utxo,
                spending_key.lock_script_and_witness(),
                membership_proof,
            ));
        }

        Ok((unlocked, msmps_recovery_data.tip_mutator_set, tip_header))
    }

    // returns Some(SpendingKey) if the utxo can be unlocked by one of the known
    // wallet keys.
    pub(crate) fn find_spending_key_for_utxo(&self, utxo: &Utxo) -> Option<SpendingKey> {
        self.get_known_spending_keys()
            .into_iter()
            .find(|k| k.lock_script_hash() == utxo.lock_script_hash())
    }

    pub(crate) async fn get_recovery_data_from_utxo(
        &self,
        utxo: &Utxo,
    ) -> Result<UtxoRecoveryData> {
        let digest = Tip5::hash(utxo);
        let db_data = self.get_utxo_db_data(&digest).await?;
        match db_data {
            Some(db_data) => Ok(db_data.recovery_data),
            None => Err(anyhow::anyhow!("UTXO not found")),
        }
    }
}
