//! Watch-only addresses.
//!
//! A watch-only address is an externally-supplied *viewing key* that this
//! wallet monitors for incoming UTXOs but can never spend. Each entry is
//! associated with an account (the per-account `wallet_state.db` it lives in).
//!
//! There is a single watch-only concept with an optional capability:
//!
//! - **Viewing key only** — enough to see the *total amount received*.
//!   Confirming an incoming UTXO uses the public `receiver_digest`, reachable
//!   from the viewing key alone.
//! - **Viewing key + receiver preimage** (imported as a hex `Digest`) — also
//!   lets us detect *spends* and therefore show a real *balance* (received −
//!   spent). The preimage is what computes a UTXO's absolute index set, which
//!   is matched against blocks' removal records.
//!
//! The preimage is optional: its presence upgrades an entry from
//! total-received to balance-tracking. It never grants spend ability.
//!
//! Both announced UTXOs and guesser (mining) rewards are detected. Guesser
//! rewards are not announced — they are committed in the block header — so they
//! are picked up whenever a watched address is the block's guesser, exactly as
//! the derived-key wallet does in `par_scan_for_incoming_utxo`.
//!
//! Because watch-only UTXOs are stored in their own table (never in
//! `wallet_state_utxos`), they can never be selected as spend inputs
//! (`can_unlock` only matches derived keys) and never enter the account
//! balance (`get_all_balance`).

use std::collections::HashMap;
use std::collections::HashSet;

use anyhow::anyhow;
use anyhow::bail;
use anyhow::ensure;
use anyhow::Result;
use neptune_consensus::block::guesser_receiver_data::GuesserReceiverData;
use neptune_consensus::transaction::announcement::Announcement;
use neptune_consensus::transaction::utxo::Utxo;
use neptune_consensus::transaction::utxo_triple::UtxoTriple;
use neptune_consensus::type_scripts::native_currency_amount::NativeCurrencyAmount;
use neptune_mutator_set::addition_record::AdditionRecord;
use neptune_mutator_set::removal_record::absolute_index_set::AbsoluteIndexSet;
use neptune_primitives::network::Network;
use neptune_primitives::timestamp::Timestamp;
use neptune_wallet::address::viewing_address::ViewingAddress;
use neptune_wallet::address::ReceivingAddress;
use neptune_wallet::twenty_first::math::b_field_element::BFieldElement;
use neptune_wallet::twenty_first::tip5::Digest;
use serde::Serialize;
use sqlx::Row;
use sqlx::SqliteConnection;
use tracing::debug;
use tracing::warn;

use crate::wallet::wallet_block::WalletBlock;
use crate::wallet::UtxoRecoveryData;

/// Display info for a watch-only address, returned to the frontend.
#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
pub(crate) struct WatchOnlyAddressRecord {
    pub id: i64,
    /// Matches the `NeptuneKeyType` variant name, e.g. "ViewingAddress".
    pub key_type: String,
    pub address: String,
    pub address_short_form: String,
    pub label: Option<String>,
    /// True when a receiver preimage was imported, so spends are tracked and
    /// the balance fields are meaningful.
    pub tracks_balance: bool,
    /// Total received so far, formatted for display.
    pub total_received: String,
    /// Spend-adjusted balance (received − spent), only when `tracks_balance`.
    pub balance: Option<String>,
    /// Portion of `balance` that is spendable now (timelock, if any, elapsed).
    pub available: Option<String>,
    /// Portion of `balance` still time-locked.
    pub locked: Option<String>,
    /// Earliest upcoming unlock among the locked coins, if any are locked.
    pub next_release_date: Option<Timestamp>,
}

/// Aggregate balance breakdown for one balance-tracking watch-only address.
struct WatchOnlyBalance {
    balance: NativeCurrencyAmount,
    available: NativeCurrencyAmount,
    locked: NativeCurrencyAmount,
    next_release_date: Option<Timestamp>,
}

/// A confirmed incoming UTXO for a watch-only address.
struct WatchOnlyReceipt {
    aocl_index: u64,
    amount: NativeCurrencyAmount,
    utxo: Utxo,
    sender_randomness: Digest,
}

/// The parsed viewing key backing a watch-only address.
///
/// Only [`ViewingAddress`] is supported today. EC-hybrid support is gated on
/// `EcHybridViewingKey` gaining a serializable (bech32m) form in
/// `neptune-wallet`; when it does, add an `EcHybrid` arm here and to the match
/// in [`WatchOnlyKey::parse`].
enum WatchOnlyKey {
    Viewing(ViewingAddress),
}

impl WatchOnlyKey {
    /// Parse an imported viewing key of the given type for `network`. A parse
    /// failure means the text is not a valid key for this type/network.
    fn parse(key_type: &str, text: &str, network: Network) -> Result<Self> {
        match key_type {
            "ViewingAddress" => Ok(Self::Viewing(ViewingAddress::from_bech32m(
                text.trim(),
                network,
            )?)),
            "EcHybrid" => {
                bail!("EC hybrid watch-only addresses are not supported yet")
            }
            other => bail!("Unsupported watch-only address type: {other}"),
        }
    }

    fn key_type_str(&self) -> &'static str {
        match self {
            Self::Viewing(_) => "ViewingAddress",
        }
    }

    fn to_bech32m(&self, network: Network) -> String {
        match self {
            Self::Viewing(a) => a.to_bech32m(network),
        }
    }

    /// Public fingerprint carried in announcement field `message[1]`.
    fn receiver_id(&self) -> BFieldElement {
        match self {
            Self::Viewing(a) => a.receiver_id(),
        }
    }

    /// Public `receiver_digest` (= `receiver_preimage.hash()`), used to rebuild
    /// the addition record of an incoming UTXO.
    fn receiver_digest(&self) -> Digest {
        match self {
            Self::Viewing(a) => a.receiver_postimage(),
        }
    }

    fn decrypt(&self, ciphertext: &[BFieldElement]) -> Result<(Utxo, Digest)> {
        match self {
            Self::Viewing(a) => a.decrypt(ciphertext),
        }
    }

    /// The block-header data that marks this address as a block's guesser
    /// (miner). Built exactly as the block sees a guesser — the receiver digest
    /// and lock-script hash — so it can be compared against
    /// `BlockHeader::guesser_receiver_data`.
    fn guesser_receiver_data(&self) -> GuesserReceiverData {
        match self {
            Self::Viewing(a) => ReceivingAddress::from(*a).into(),
        }
    }

    /// Find confirmed incoming UTXOs for this viewing key in a block, including
    /// guesser (mining) rewards.
    ///
    /// For announced UTXOs this mirrors `SpendingKey::scan_for_announced_utxos`:
    /// filter announcements by our receiver id, decrypt, and rebuild the
    /// addition record from the public receiver digest. Guesser rewards are not
    /// announced — they are committed in the block header and derived from the
    /// block structure — so when this address is the block's guesser we take its
    /// `guesser_fee_utxos` directly (sender randomness = block hash).
    ///
    /// Either way, candidates are keyed by addition record and kept only if that
    /// record is actually an output of the block. `addition_records` /
    /// `num_prior` (which already include guesser outputs) are passed in so the
    /// mutator-set computation is done once per block.
    fn scan_block(
        &self,
        announcements: &[Announcement],
        addition_records: &[AdditionRecord],
        num_prior: u64,
        block_guesser_data: &GuesserReceiverData,
        guesser_fee_utxos: &[Utxo],
        block_hash: Digest,
    ) -> Vec<WatchOnlyReceipt> {
        let receiver_id = self.receiver_id();
        let receiver_digest = self.receiver_digest();

        let mut found: HashMap<AdditionRecord, (Utxo, Digest)> = HashMap::new();
        for announcement in announcements {
            // message[1] is the receiver-id fingerprint; message[2..] the ciphertext.
            let Some(candidate_id) = announcement.message.get(1) else {
                continue;
            };
            if *candidate_id != receiver_id {
                continue;
            }
            if announcement.message.len() <= 2 {
                continue;
            }
            let ciphertext = &announcement.message[2..];
            let Ok((utxo, sender_randomness)) = self.decrypt(ciphertext) else {
                continue;
            };
            let triple = UtxoTriple {
                utxo: utxo.clone(),
                sender_randomness,
                receiver_digest,
            };
            found.insert(triple.addition_record(), (utxo, sender_randomness));
        }

        // Guesser rewards: if this block was guessed to our address, its
        // guesser-fee UTXOs are ours (sender randomness = block hash). Same as
        // the derived-key path in `par_scan_for_incoming_utxo`.
        if self.guesser_receiver_data() == *block_guesser_data {
            for utxo in guesser_fee_utxos {
                let triple = UtxoTriple {
                    utxo: utxo.clone(),
                    sender_randomness: block_hash,
                    receiver_digest,
                };
                found.insert(triple.addition_record(), (utxo.clone(), block_hash));
            }
        }

        if found.is_empty() {
            return vec![];
        }

        // Confirm each decrypted UTXO is really an output of this block, and
        // recover its AOCL index (same enumeration the main UTXO scan uses).
        let mut receipts = vec![];
        for (aocl_index, addition_record) in (num_prior..).zip(addition_records.iter()) {
            if let Some((utxo, sender_randomness)) = found.get(addition_record) {
                receipts.push(WatchOnlyReceipt {
                    aocl_index,
                    amount: utxo.get_native_currency_amount(),
                    utxo: utxo.clone(),
                    sender_randomness: *sender_randomness,
                });
            }
        }
        receipts
    }
}

/// Short display form for a viewing-key string.
fn abbreviate(address: &str) -> String {
    const HEAD: usize = 12;
    const TAIL: usize = 6;
    if address.len() <= HEAD + TAIL + 1 {
        return address.to_string();
    }
    format!("{}…{}", &address[..HEAD], &address[address.len() - TAIL..])
}

impl super::WalletState {
    /// Register a new watch-only address for the current account.
    ///
    /// `preimage_hex` is optional: when supplied it must be the hex-encoded
    /// receiver preimage of this address (checked via `preimage.hash() ==
    /// receiver_digest`), and it upgrades the entry to balance tracking.
    pub(crate) async fn add_watch_only(
        &self,
        key_type: &str,
        text: &str,
        preimage_hex: Option<String>,
        label: Option<String>,
    ) -> Result<WatchOnlyAddressRecord> {
        let key = WatchOnlyKey::parse(key_type, text, self.network)?;
        let canonical = key.to_bech32m(self.network);

        // Validate the preimage (if any) and store it in canonical hex.
        let preimage_hex = preimage_hex
            .map(|h| h.trim().to_string())
            .filter(|h| !h.is_empty());
        let preimage_stored: Option<String> = match &preimage_hex {
            Some(hex) => {
                let preimage = Digest::try_from_hex(hex)
                    .map_err(|_| anyhow!("Receiver preimage must be a hex-encoded digest"))?;
                ensure!(
                    preimage.hash() == key.receiver_digest(),
                    "Receiver preimage does not match this address"
                );
                Some(preimage.to_hex())
            }
            None => None,
        };

        // Reject duplicates up front for a friendly message (the UNIQUE
        // constraint on `viewing_key` is a backstop).
        let existing = sqlx::query("SELECT id FROM watch_only_addresses WHERE viewing_key = ?")
            .bind(&canonical)
            .fetch_optional(&self.pool)
            .await?;
        if existing.is_some() {
            bail!("This watch-only address has already been added");
        }

        let label = label.filter(|l| !l.trim().is_empty());
        let created_at = Timestamp::now().to_millis() as i64;
        let id = sqlx::query(
            "INSERT INTO watch_only_addresses (key_type, viewing_key, receiver_preimage, label, created_at) VALUES (?, ?, ?, ?, ?)",
        )
        .bind(key.key_type_str())
        .bind(&canonical)
        .bind(&preimage_stored)
        .bind(&label)
        .bind(created_at)
        .execute(&self.pool)
        .await?
        .last_insert_rowid();

        let tracks_balance = preimage_stored.is_some();
        let zero = NativeCurrencyAmount::from_nau(0).display_lossless();
        debug!(
            "Added watch-only address {id} ({}), tracks_balance={tracks_balance}",
            key.key_type_str()
        );

        // A freshly added address has no receipts yet, so every balance is zero.
        Ok(WatchOnlyAddressRecord {
            id,
            key_type: key.key_type_str().to_string(),
            address_short_form: abbreviate(&canonical),
            address: canonical,
            label,
            tracks_balance,
            total_received: zero.clone(),
            balance: tracks_balance.then(|| zero.clone()),
            available: tracks_balance.then(|| zero.clone()),
            locked: tracks_balance.then_some(zero),
            next_release_date: None,
        })
    }

    /// List all watch-only addresses for the current account, each with its
    /// total received and (when the preimage is known) its balance.
    pub(crate) async fn known_watch_only(&self) -> Result<Vec<WatchOnlyAddressRecord>> {
        let rows = sqlx::query(
            "SELECT id, key_type, viewing_key, label, receiver_preimage FROM watch_only_addresses ORDER BY created_at ASC",
        )
        .fetch_all(&self.pool)
        .await?;

        let mut records = Vec::with_capacity(rows.len());
        for row in rows {
            let id: i64 = row.get("id");
            let viewing_key: String = row.get("viewing_key");
            let tracks_balance = row.get::<Option<String>, _>("receiver_preimage").is_some();
            let total = self.watch_only_total(id).await?;
            let breakdown = if tracks_balance {
                Some(self.watch_only_balance_breakdown(id).await?)
            } else {
                None
            };
            records.push(WatchOnlyAddressRecord {
                id,
                key_type: row.get("key_type"),
                address_short_form: abbreviate(&viewing_key),
                address: viewing_key,
                label: row.get("label"),
                tracks_balance,
                total_received: total.display_lossless(),
                balance: breakdown.as_ref().map(|b| b.balance.display_lossless()),
                available: breakdown.as_ref().map(|b| b.available.display_lossless()),
                locked: breakdown.as_ref().map(|b| b.locked.display_lossless()),
                next_release_date: breakdown.and_then(|b| b.next_release_date),
            });
        }
        Ok(records)
    }

    /// Delete a watch-only address and all its recorded receipts.
    pub(crate) async fn remove_watch_only(&self, id: i64) -> Result<()> {
        let mut tx = self.pool.begin().await?;
        sqlx::query("DELETE FROM watch_only_utxos WHERE watch_only_id = ?")
            .bind(id)
            .execute(&mut *tx)
            .await?;
        sqlx::query("DELETE FROM watch_only_addresses WHERE id = ?")
            .bind(id)
            .execute(&mut *tx)
            .await?;
        tx.commit().await?;
        Ok(())
    }

    /// Sum of all received amounts for one watch-only address (ignores spends).
    async fn watch_only_total(&self, watch_only_id: i64) -> Result<NativeCurrencyAmount> {
        let rows = sqlx::query("SELECT amount FROM watch_only_utxos WHERE watch_only_id = ?")
            .bind(watch_only_id)
            .fetch_all(&self.pool)
            .await?;

        let mut sum: i128 = 0;
        for row in rows {
            let amount: String = row.get("amount");
            sum += amount.parse::<i128>().unwrap_or(0);
        }
        Ok(NativeCurrencyAmount::from_nau(sum))
    }

    /// Balance breakdown for one address: unspent total split into spendable-now
    /// (`available`) and still-time-locked (`locked`), plus the earliest upcoming
    /// unlock. Only meaningful for entries whose preimage is known (spends are
    /// tracked). Mirrors the main wallet's available/locked split in
    /// [`get_all_balance`](super::WalletState::get_all_balance) via
    /// `Utxo::can_spend_at`.
    async fn watch_only_balance_breakdown(&self, watch_only_id: i64) -> Result<WatchOnlyBalance> {
        let rows = sqlx::query(
            "SELECT amount, utxo FROM watch_only_utxos WHERE watch_only_id = ? AND spent_height IS NULL",
        )
        .bind(watch_only_id)
        .fetch_all(&self.pool)
        .await?;

        let now = Timestamp::now();
        let mut total: i128 = 0;
        let mut available: i128 = 0;
        let mut next_release_date: Option<Timestamp> = None;

        for row in rows {
            let amount: i128 = row.get::<String, _>("amount").parse().unwrap_or(0);
            total += amount;

            // A receipt without a stored utxo (only possible for rows predating
            // the spend-tracking columns) is treated as spendable.
            let (spendable, release) = match row.get::<Option<Vec<u8>>, _>("utxo") {
                Some(blob) => match bincode::deserialize::<Utxo>(&blob) {
                    Ok(utxo) => (utxo.can_spend_at(now), utxo.release_date()),
                    Err(_) => (true, None),
                },
                None => (true, None),
            };

            if spendable {
                available += amount;
            } else if let Some(release) = release {
                // Track the soonest upcoming unlock.
                next_release_date = Some(match next_release_date {
                    Some(current) if current <= release => current,
                    _ => release,
                });
            }
        }

        Ok(WatchOnlyBalance {
            balance: NativeCurrencyAmount::from_nau(total),
            available: NativeCurrencyAmount::from_nau(available),
            locked: NativeCurrencyAmount::from_nau(total - available),
            next_release_date,
        })
    }

    /// Load and parse all watch-only entries for the current account, each with
    /// its optional receiver preimage.
    async fn watch_only_keys(
        &self,
        tx: &mut SqliteConnection,
    ) -> Result<Vec<(i64, WatchOnlyKey, Option<Digest>)>> {
        let rows = sqlx::query(
            "SELECT id, key_type, viewing_key, receiver_preimage FROM watch_only_addresses",
        )
        .fetch_all(&mut *tx)
        .await?;

        let mut keys = Vec::with_capacity(rows.len());
        for row in rows {
            let id: i64 = row.get("id");
            let key_type: String = row.get("key_type");
            let viewing_key: String = row.get("viewing_key");
            match WatchOnlyKey::parse(&key_type, &viewing_key, self.network) {
                Ok(key) => {
                    let preimage = row
                        .get::<Option<String>, _>("receiver_preimage")
                        .and_then(|h| Digest::try_from_hex(h).ok());
                    keys.push((id, key, preimage));
                }
                Err(e) => warn!("Skipping unparseable watch-only address {id}: {e}"),
            }
        }
        Ok(keys)
    }

    /// Scan a block for incoming UTXOs to any watch-only address, persist the
    /// receipts, and (for entries whose preimage is known) mark receipts spent
    /// in this block. Runs inside `update_new_tip`'s transaction so it commits
    /// (or rolls back) atomically with the rest of the block's state.
    pub(crate) async fn scan_watch_only(
        &self,
        tx: &mut SqliteConnection,
        block: &WalletBlock,
    ) -> Result<()> {
        let entries = self.watch_only_keys(&mut *tx).await?;
        if entries.is_empty() {
            return Ok(());
        }

        let tx_kernel = block.kernel.body.transaction_kernel();
        let announcements = &tx_kernel.announcements;
        let addition_records = block.all_addition_records();
        let num_prior = block.num_aocl_leafs_prior();
        let block_height: u64 = block.kernel.header.height.into();
        let height: i64 = i64::try_from(block_height)?;
        let block_digest = block.hash.to_hex();

        // Absolute index sets removed (spent) by this block.
        let spent_index_sets: HashSet<AbsoluteIndexSet> = tx_kernel
            .inputs
            .iter()
            .map(|rr| rr.absolute_indices)
            .collect();

        // Guesser (mining) rewards. The two guesser-fee UTXOs are only computed
        // when one of our addresses actually guessed this block (cheap check
        // first), mirroring `par_scan_for_incoming_utxo`.
        let block_guesser_data = block.kernel.header.guesser_receiver_data;
        let guesser_fee_utxos = if entries
            .iter()
            .any(|(_, key, _)| key.guesser_receiver_data() == block_guesser_data)
        {
            match block.kernel.guesser_fee_utxos() {
                Ok(utxos) => utxos,
                Err(e) => {
                    warn!("Could not compute guesser-fee UTXOs for block {block_digest}: {e}");
                    vec![]
                }
            }
        } else {
            vec![]
        };

        for (watch_only_id, key, preimage) in entries {
            // Record new incoming receipts (announced UTXOs and guesser rewards).
            for receipt in key.scan_block(
                announcements,
                &addition_records,
                num_prior,
                &block_guesser_data,
                &guesser_fee_utxos,
                block.hash,
            ) {
                let amount = receipt.amount.to_nau().to_string();
                let utxo_blob = bincode::serialize(&receipt.utxo)?;
                let sender_randomness = receipt.sender_randomness.to_hex();
                // Unique (watch_only_id, aocl_index) makes re-scanning idempotent.
                sqlx::query(
                    "INSERT OR IGNORE INTO watch_only_utxos (watch_only_id, aocl_index, amount, confirm_height, block_digest, utxo, sender_randomness) VALUES (?, ?, ?, ?, ?, ?, ?)",
                )
                .bind(watch_only_id)
                .bind(i64::try_from(receipt.aocl_index)?)
                .bind(&amount)
                .bind(height)
                .bind(&block_digest)
                .bind(&utxo_blob)
                .bind(&sender_randomness)
                .execute(&mut *tx)
                .await?;
            }

            // Detect spends only when we hold the preimage.
            if let Some(preimage) = preimage {
                if !spent_index_sets.is_empty() {
                    self.mark_watch_only_spends(
                        &mut *tx,
                        watch_only_id,
                        preimage,
                        &spent_index_sets,
                        height,
                    )
                    .await?;
                }
            }
        }
        Ok(())
    }

    /// Mark this address's unspent receipts whose absolute index set appears in
    /// `spent_index_sets` as spent at `height`.
    async fn mark_watch_only_spends(
        &self,
        tx: &mut SqliteConnection,
        watch_only_id: i64,
        preimage: Digest,
        spent_index_sets: &HashSet<AbsoluteIndexSet>,
        height: i64,
    ) -> Result<()> {
        let rows = sqlx::query(
            "SELECT id, aocl_index, utxo, sender_randomness FROM watch_only_utxos WHERE watch_only_id = ? AND spent_height IS NULL",
        )
        .bind(watch_only_id)
        .fetch_all(&mut *tx)
        .await?;

        for row in rows {
            // Receipts recorded before spend-tracking columns existed lack the
            // data needed to compute the index set; skip them.
            let (Some(utxo_blob), Some(sr_hex)) = (
                row.get::<Option<Vec<u8>>, _>("utxo"),
                row.get::<Option<String>, _>("sender_randomness"),
            ) else {
                continue;
            };
            let Ok(sender_randomness) = Digest::try_from_hex(&sr_hex) else {
                continue;
            };
            let utxo: Utxo = bincode::deserialize(&utxo_blob)?;
            let aocl_index: i64 = row.get("aocl_index");
            let recovery = UtxoRecoveryData {
                utxo,
                sender_randomness,
                receiver_preimage: preimage,
                aocl_index: aocl_index as u64,
            };

            if spent_index_sets.contains(&recovery.abs_i()) {
                let id: i64 = row.get("id");
                sqlx::query("UPDATE watch_only_utxos SET spent_height = ? WHERE id = ?")
                    .bind(height)
                    .bind(id)
                    .execute(&mut *tx)
                    .await?;
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use std::collections::HashSet;

    use neptune_consensus::block::guesser_receiver_data::GuesserReceiverData;
    use neptune_consensus::transaction::utxo::Utxo;
    use neptune_consensus::type_scripts::native_currency_amount::NativeCurrencyAmount;
    use neptune_primitives::network::Network;
    use neptune_primitives::timestamp::Timestamp;
    use neptune_wallet::twenty_first::tip5::Digest;
    use neptune_wallet::utxo_notification::UtxoNotificationPayload;
    use neptune_wallet::wallet_entropy::WalletEntropy;

    use super::*;
    use crate::tests::test_devnet_wallet;
    use crate::wallet::UtxoRecoveryData;

    /// Insert a receipt for `watch_only_id` exactly as the scanner would.
    async fn insert_receipt(
        wallet: &crate::wallet::WalletState,
        watch_only_id: i64,
        aocl_index: i64,
        utxo: &Utxo,
    ) {
        sqlx::query(
            "INSERT INTO watch_only_utxos (watch_only_id, aocl_index, amount, confirm_height, block_digest, utxo, sender_randomness) VALUES (?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(watch_only_id)
        .bind(aocl_index)
        .bind(utxo.get_native_currency_amount().to_nau().to_string())
        .bind(1i64)
        .bind(Digest::default().to_hex())
        .bind(bincode::serialize(utxo).unwrap())
        .bind(Digest::default().to_hex())
        .execute(&wallet.pool)
        .await
        .unwrap();
    }

    fn devnet_viewing_address(index: u64) -> ViewingAddress {
        WalletEntropy::devnet_wallet()
            .nth_viewing_address_key(index)
            .to_address()
    }

    #[test]
    fn parse_accepts_valid_and_rejects_invalid() {
        let encoded = devnet_viewing_address(0).to_bech32m(Network::Main);

        assert!(WatchOnlyKey::parse("ViewingAddress", &encoded, Network::Main).is_ok());
        // Same string, wrong network => wrong prefix => rejected.
        assert!(WatchOnlyKey::parse("ViewingAddress", &encoded, Network::Testnet(0)).is_err());
        // Garbage input.
        assert!(WatchOnlyKey::parse("ViewingAddress", "not-an-address", Network::Main).is_err());
        // EC hybrid not supported yet.
        assert!(WatchOnlyKey::parse("EcHybrid", &encoded, Network::Main).is_err());
        // Unknown type.
        assert!(WatchOnlyKey::parse("Nonsense", &encoded, Network::Main).is_err());
    }

    #[tokio::test]
    async fn add_list_remove_roundtrip() {
        let wallet = test_devnet_wallet().await;
        let encoded = devnet_viewing_address(0).to_bech32m(wallet.network);

        let record = wallet
            .add_watch_only(
                "ViewingAddress",
                &encoded,
                None,
                Some("savings".to_string()),
            )
            .await
            .unwrap();
        assert_eq!(record.key_type, "ViewingAddress");
        assert_eq!(record.label.as_deref(), Some("savings"));
        assert_eq!(record.address, encoded);
        // No preimage => total-received only, no balance.
        assert!(!record.tracks_balance);
        assert!(record.balance.is_none());

        let listed = wallet.known_watch_only().await.unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].id, record.id);
        assert_eq!(listed[0].address, encoded);

        // Adding the same viewing key again is rejected.
        assert!(wallet
            .add_watch_only("ViewingAddress", &encoded, None, None)
            .await
            .is_err());

        wallet.remove_watch_only(record.id).await.unwrap();
        assert!(wallet.known_watch_only().await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn preimage_import_validates_and_enables_balance() {
        let wallet = test_devnet_wallet().await;
        let vkey = WalletEntropy::devnet_wallet().nth_viewing_address_key(0);
        let encoded = vkey.to_address().to_bech32m(wallet.network);

        // A preimage that doesn't hash to this address's receiver digest is rejected.
        let wrong = WalletEntropy::devnet_wallet()
            .nth_viewing_address_key(1)
            .receiver_preimage()
            .to_hex();
        assert!(wallet
            .add_watch_only("ViewingAddress", &encoded, Some(wrong), None)
            .await
            .is_err());
        // Non-hex preimage is rejected.
        assert!(wallet
            .add_watch_only("ViewingAddress", &encoded, Some("nothex".to_string()), None)
            .await
            .is_err());

        // The correct preimage is accepted and enables balance tracking.
        let record = wallet
            .add_watch_only(
                "ViewingAddress",
                &encoded,
                Some(vkey.receiver_preimage().to_hex()),
                None,
            )
            .await
            .unwrap();
        assert!(record.tracks_balance);
        assert_eq!(
            record.balance.as_deref(),
            Some(
                NativeCurrencyAmount::from_nau(0)
                    .display_lossless()
                    .as_str()
            )
        );
    }

    #[tokio::test]
    async fn spend_detection_reduces_balance_but_not_total_received() {
        let wallet = test_devnet_wallet().await;
        let vkey = WalletEntropy::devnet_wallet().nth_viewing_address_key(0);
        let preimage = vkey.receiver_preimage();
        let encoded = vkey.to_address().to_bech32m(wallet.network);

        let record = wallet
            .add_watch_only("ViewingAddress", &encoded, Some(preimage.to_hex()), None)
            .await
            .unwrap();

        // Insert a receipt exactly as the scanner would.
        let amount = NativeCurrencyAmount::from_nau(5000);
        let utxo = Utxo::new_native_currency(Digest::default(), amount);
        let sender_randomness = Digest::default();
        let aocl_index: i64 = 42;
        insert_receipt(&wallet, record.id, aocl_index, &utxo).await;

        // Before the spend, balance == total received == amount.
        let before = wallet.known_watch_only().await.unwrap();
        assert_eq!(before[0].total_received, amount.display_lossless());
        assert_eq!(
            before[0].balance.as_deref(),
            Some(amount.display_lossless().as_str())
        );

        // Mark it spent via its computed absolute index set.
        let recovery = UtxoRecoveryData {
            utxo,
            sender_randomness,
            receiver_preimage: preimage,
            aocl_index: aocl_index as u64,
        };
        let spent: HashSet<AbsoluteIndexSet> = HashSet::from([recovery.abs_i()]);
        let mut tx = wallet.pool.begin().await.unwrap();
        wallet
            .mark_watch_only_spends(&mut tx, record.id, preimage, &spent, 12)
            .await
            .unwrap();
        tx.commit().await.unwrap();

        // Balance drops to zero; total received still reflects the receipt.
        let after = wallet.known_watch_only().await.unwrap();
        assert_eq!(after[0].total_received, amount.display_lossless());
        assert_eq!(
            after[0].balance.as_deref(),
            Some(
                NativeCurrencyAmount::from_nau(0)
                    .display_lossless()
                    .as_str()
            )
        );
    }

    #[tokio::test]
    async fn balance_breakdown_splits_available_and_locked() {
        let wallet = test_devnet_wallet().await;
        let vkey = WalletEntropy::devnet_wallet().nth_viewing_address_key(0);
        let encoded = vkey.to_address().to_bech32m(wallet.network);
        let record = wallet
            .add_watch_only(
                "ViewingAddress",
                &encoded,
                Some(vkey.receiver_preimage().to_hex()),
                None,
            )
            .await
            .unwrap();

        let unlocked_amount = NativeCurrencyAmount::from_nau(3000);
        let locked_amount = NativeCurrencyAmount::from_nau(2000);
        let release = Timestamp::now() + Timestamp::days(30);

        let unlocked = Utxo::new_native_currency(Digest::default(), unlocked_amount);
        let locked =
            Utxo::new_native_currency(Digest::default(), locked_amount).with_time_lock(release);
        insert_receipt(&wallet, record.id, 0, &unlocked).await;
        insert_receipt(&wallet, record.id, 1, &locked).await;

        let listed = wallet.known_watch_only().await.unwrap();
        let entry = &listed[0];
        // Balance counts both; available excludes the still-locked coin.
        assert_eq!(
            entry.balance.as_deref(),
            Some(
                NativeCurrencyAmount::from_nau(5000)
                    .display_lossless()
                    .as_str()
            )
        );
        assert_eq!(
            entry.available.as_deref(),
            Some(unlocked_amount.display_lossless().as_str())
        );
        assert_eq!(
            entry.locked.as_deref(),
            Some(locked_amount.display_lossless().as_str())
        );
        assert_eq!(
            entry.next_release_date.map(|t| t.to_millis()),
            Some(release.to_millis())
        );
    }

    #[test]
    fn scan_block_matches_only_confirmed_utxo() {
        let address = devnet_viewing_address(0);
        let amount = NativeCurrencyAmount::from_nau(1234);
        let utxo = Utxo::new_native_currency(Digest::default(), amount);
        let sender_randomness = Digest::default();
        let payload = UtxoNotificationPayload::new(utxo.clone(), sender_randomness);
        let announcement = address.generate_announcement(&payload);

        let addition_record = UtxoTriple {
            utxo,
            sender_randomness,
            receiver_digest: address.receiver_postimage(),
        }
        .addition_record();

        let key = WatchOnlyKey::Viewing(address);
        let announcements = std::slice::from_ref(&announcement);
        let addition_records = std::slice::from_ref(&addition_record);
        let no_guesser = no_guesser_data();

        // Announcement decrypts and its addition record is in the block => counted,
        // with the AOCL index recovered from its position past `num_prior`.
        let receipts = key.scan_block(
            announcements,
            addition_records,
            7,
            &no_guesser,
            &[],
            Digest::default(),
        );
        assert_eq!(receipts.len(), 1);
        assert_eq!(receipts[0].amount, amount);
        assert_eq!(receipts[0].aocl_index, 7);

        // Announced but absent from the block => not counted.
        assert!(key
            .scan_block(announcements, &[], 0, &no_guesser, &[], Digest::default())
            .is_empty());

        // Announcement addressed to a different viewing key => ignored.
        let other = WatchOnlyKey::Viewing(devnet_viewing_address(1));
        assert!(other
            .scan_block(
                announcements,
                addition_records,
                0,
                &no_guesser,
                &[],
                Digest::default()
            )
            .is_empty());
    }

    #[test]
    fn scan_block_catches_guesser_reward() {
        let address = devnet_viewing_address(0);
        let key = WatchOnlyKey::Viewing(address);
        let block_hash = Digest::default(); // stands in for the block hash / sender randomness
        let receiver_digest = address.receiver_postimage();

        // Two guesser-fee UTXOs (mirrors `guesser_fee_utxos`: one plain, one locked).
        let a1 = NativeCurrencyAmount::from_nau(700);
        let a2 = NativeCurrencyAmount::from_nau(300);
        let u1 = Utxo::new_native_currency(Digest::default(), a1);
        let u2 = Utxo::new_native_currency(Digest::default(), a2);
        let guesser_utxos = vec![u1.clone(), u2.clone()];

        let ar = |u: &Utxo| {
            UtxoTriple {
                utxo: u.clone(),
                sender_randomness: block_hash,
                receiver_digest,
            }
            .addition_record()
        };
        let addition_records = vec![ar(&u1), ar(&u2)];

        // Guessed by us => both guesser UTXOs are caught (no announcements needed).
        let receipts = key.scan_block(
            &[],
            &addition_records,
            0,
            &key.guesser_receiver_data(),
            &guesser_utxos,
            block_hash,
        );
        assert_eq!(receipts.len(), 2);
        let total: i128 = receipts.iter().map(|r| r.amount.to_nau()).sum();
        assert_eq!(total, a1.to_nau() + a2.to_nau());

        // Guessed by a different address => nothing caught.
        let other = WatchOnlyKey::Viewing(devnet_viewing_address(1)).guesser_receiver_data();
        assert!(key
            .scan_block(
                &[],
                &addition_records,
                0,
                &other,
                &guesser_utxos,
                block_hash
            )
            .is_empty());
    }

    fn no_guesser_data() -> GuesserReceiverData {
        // A sentinel that no real address matches (real receiver digests are
        // non-default hashes).
        GuesserReceiverData {
            receiver_digest: Digest::default(),
            lock_script_hash: Digest::default(),
        }
    }
}
