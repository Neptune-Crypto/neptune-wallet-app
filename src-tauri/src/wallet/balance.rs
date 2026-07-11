use anyhow::Result;
use neptune_consensus::type_scripts::native_currency_amount::NativeCurrencyAmount;
use neptune_primitives::timestamp::Timestamp;
use serde::Deserialize;
use serde::Serialize;

impl super::WalletState {
    pub(crate) async fn get_balance_history(&self) -> Result<Vec<WalletHistory>> {
        let utxos = self.get_utxos().await?;
        let mut history = Vec::new();
        for utxo in utxos {
            history.push(WalletHistory {
                amount: utxo
                    .recovery_data
                    .utxo
                    .get_native_currency_amount()
                    .display_lossless(),
                timestamp: utxo.confirmed_in_block.timestamp,
                height: utxo.confirmed_in_block.block_height,
                index: utxo.recovery_data.aocl_index,
                release_date: utxo.recovery_data.utxo.release_date(),
                txid: utxo.confirmed_txid,
            });
            if let Some(spent_in_block) = utxo.spent_in_block {
                history.push(WalletHistory {
                    amount: "-".to_string()
                        + &utxo
                            .recovery_data
                            .utxo
                            .get_native_currency_amount()
                            .display_lossless(),
                    timestamp: spent_in_block.timestamp,
                    height: spent_in_block.block_height,
                    index: utxo.recovery_data.aocl_index,
                    release_date: utxo.recovery_data.utxo.release_date(),
                    txid: utxo.spent_txid,
                })
            }
        }

        Ok(history)
    }

    /// Sum of this wallet's own outputs (change and self-sends) across all
    /// unfinished pending transactions: the amount that will be credited back
    /// once those transactions are mined.
    ///
    /// Deliberately NOT the pending transactions' input sum — most of an input's
    /// value leaves the wallet (recipient amount + fee); only these outputs
    /// return, so only they may be reported as "awaiting confirmation".
    pub(crate) async fn get_expected_incoming(&self) -> Result<NativeCurrencyAmount> {
        let mut conn = self.pool.acquire().await?;
        let pending = self.updater.get_pending_transactions(&mut conn).await?;

        let mut incoming = 0i128;
        for (_txid, detail, _input_ids) in pending {
            for txo in detail.tx_outputs.iter() {
                let utxo = txo.utxo();
                if self.find_spending_key_for_utxo(&utxo).is_some() {
                    incoming += utxo.get_native_currency_amount().to_nau();
                }
            }
        }

        Ok(NativeCurrencyAmount::from_nau(incoming))
    }

    /// Returns (available, pending, total).
    ///
    /// `available` is what a new send can spend right now: inputs of unconfirmed
    /// transactions are excluded — spending them again would double-spend
    /// (issue #50). `pending` is the expected incoming amount (change and
    /// self-sends) that returns once those transactions confirm. `total` is
    /// available + time-locked + pending — so it drops by the sent amount at
    /// broadcast, not at confirmation.
    pub(crate) async fn get_all_balance(
        &self,
    ) -> Result<(
        NativeCurrencyAmount,
        NativeCurrencyAmount,
        NativeCurrencyAmount,
    )> {
        let utxos = self.get_utxos().await?;
        let pending_ids = self.updater.get_pending_spent_utxos().await?;
        let now = Timestamp::now();

        let mut balance = 0i128;
        let mut locked = 0i128;
        for utxo in utxos {
            // Skip inputs of pending transactions entirely: their value is
            // leaving the wallet, and the part that returns is counted below
            // via get_expected_incoming.
            if utxo.spent_in_block.is_none() && !pending_ids.contains(&utxo.id) {
                let value = utxo.recovery_data.utxo.get_native_currency_amount();
                if utxo.recovery_data.utxo.can_spend_at(now) {
                    balance += value.to_nau();
                } else {
                    locked += value.to_nau();
                }
            }
        }

        let pending = self.get_expected_incoming().await?;

        Ok((
            NativeCurrencyAmount::from_nau(balance),
            pending,
            NativeCurrencyAmount::from_nau(balance + locked + pending.to_nau()),
        ))
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub(crate) struct WalletHistory {
    pub(crate) amount: String,
    pub(crate) timestamp: Timestamp,
    pub(crate) height: u64,
    pub(crate) index: u64,
    pub(crate) release_date: Option<Timestamp>,
    pub(crate) txid: Option<String>,
}
