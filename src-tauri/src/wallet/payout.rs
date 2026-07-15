//! Daily payout policies.
//!
//! A payout policy is attached to a watch-only address, which acts purely as a
//! *meter*: it can never be spent from. On a daily cadence the wallet sends a
//! payment **from this account's own balance** (using its secret keys) to a
//! fixed recipient, sized as `multiplier × (eligible amount the watched address
//! received since the policy was armed)`.
//!
//! At most one policy per watch-only address. A policy is inert until `armed`;
//! arming stamps `meter_start` (and re-arming resets it), so only receipts
//! confirmed after the latest arming are ever paid against.
//!
//! This module owns the policy record and its CRUD. The eligibility/accounting
//! run engine and the scheduler live alongside it (added separately).

use anyhow::bail;
use anyhow::ensure;
use anyhow::Result;
use chrono::DateTime;
use chrono::Local;
use chrono::TimeZone;
use neptune_consensus::transaction::utxo::Utxo;
use neptune_consensus::type_scripts::native_currency_amount::NativeCurrencyAmount;
use neptune_primitives::timestamp::Timestamp;
use neptune_wallet::address::ReceivingAddress;
use neptune_wallet::twenty_first::math::b_field_element::BFieldElement;
use neptune_wallet::utxo_notification::UtxoNotificationMedium;
use serde::Deserialize;
use serde::Serialize;
use sqlx::Row;
use tracing::error;
use tracing::info;

use crate::wallet::watch_only::pending_release_date;
use crate::wallet::InputSelectionRule;

/// Milliseconds in a day; lock durations are compared in ms so the whole-day
/// bounds are exact at the boundary (e.g. the 1095.72-day mining lock).
const MS_PER_DAY: i128 = 24 * 60 * 60 * 1000;

/// Fee for automated payouts — the app's standard send fee (0.5 NPT), paid on
/// top from this account.
const DEFAULT_PAYOUT_FEE_NPT: &str = "0.5";

/// Outcome of a single payout run.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum PayoutRunStatus {
    /// Payment was built and broadcast.
    Paid,
    /// No eligible receipts (or the amount rounded to zero) — nothing to do.
    SkippedNoReceipts,
    /// Eligible receipts existed but the account couldn't cover them; dropped.
    SkippedInsufficientFunds,
    /// Eligible receipts were accounted (not retried) but the send failed.
    Failed,
}

impl PayoutRunStatus {
    fn as_str(&self) -> &'static str {
        match self {
            Self::Paid => "paid",
            Self::SkippedNoReceipts => "skipped_no_receipts",
            Self::SkippedInsufficientFunds => "skipped_insufficient_funds",
            Self::Failed => "failed",
        }
    }
}

/// `floor(basis_nau × multiplier)`, clamped to `[0, MAX_NAU]`.
///
/// Lossy (f64), but deterministic across machines (IEEE-754); the precision
/// loss is sub-nau on any realistic amount.
fn payout_amount_nau(basis_nau: i128, multiplier: &str) -> i128 {
    let mult: f64 = multiplier.parse().unwrap_or(0.0);
    let product = ((basis_nau as f64) * mult).floor();
    // Clamp in i128 space: MAX_NAU as f64 rounds up, so clamping there could
    // exceed it.
    if product <= 0.0 {
        0
    } else if product >= NativeCurrencyAmount::MAX_NAU as f64 {
        NativeCurrencyAmount::MAX_NAU
    } else {
        product as i128
    }
}

/// The payout a policy would make for a given basis: `floor(basis × multiplier)`
/// capped by the policy's daily maximum (if any). Shared by the run engine and
/// the read-only preview so the shown and paid amounts can never diverge.
fn capped_payout_nau(policy: &PayoutPolicy, basis_nau: i128) -> i128 {
    let mut payout_nau = payout_amount_nau(basis_nau, &policy.multiplier);
    if let Some(cap) = &policy.max_daily_payout {
        if let Ok(cap_amt) = NativeCurrencyAmount::coins_from_str(cap) {
            payout_nau = payout_nau.min(cap_amt.to_nau());
        }
    }
    payout_nau
}

/// The most recent daily run slot at or before `now`, in epoch milliseconds,
/// for a policy whose local-time run is `run_time_minutes` minutes past
/// midnight. Returns `None` only on impossible calendar/DST inputs.
fn most_recent_slot_ms(run_time_minutes: i64, now: DateTime<Local>) -> Option<i64> {
    let hour = (run_time_minutes / 60) as u32;
    let minute = (run_time_minutes % 60) as u32;
    let today = now.date_naive();

    let today_slot = Local
        .from_local_datetime(&today.and_hms_opt(hour, minute, 0)?)
        .earliest()?;
    let slot = if now >= today_slot {
        today_slot
    } else {
        // Before today's time — the most recent slot was yesterday's.
        Local
            .from_local_datetime(&today.pred_opt()?.and_hms_opt(hour, minute, 0)?)
            .earliest()?
    };
    Some(slot.timestamp_millis())
}

/// Whether a policy's daily run is due: a scheduled slot at or after arming has
/// elapsed since the last run (so arming never fires immediately, and a slot
/// missed while closed catches up as one run).
fn is_due(meter_start: i64, last_run_at: Option<i64>, slot: i64) -> bool {
    slot >= meter_start && last_run_at.is_none_or(|last| last < slot)
}

/// Minutes in a day; `run_time` is a minutes-of-day offset in `0..MINUTES_PER_DAY`.
const MINUTES_PER_DAY: i64 = 24 * 60;

/// Which incoming receipts a policy pays against — decided per receipt from
/// whether it carried a pending time lock when it was received.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub(crate) enum PayoutBasis {
    /// Received spendable, with no pending time lock.
    Liquid,
    /// Received carrying a time lock (within the policy's lock-day bounds).
    TimeLocked,
}

impl PayoutBasis {
    fn as_str(&self) -> &'static str {
        match self {
            Self::Liquid => "Liquid",
            Self::TimeLocked => "TimeLocked",
        }
    }

    fn from_str(s: &str) -> Result<Self> {
        match s {
            "Liquid" => Ok(Self::Liquid),
            "TimeLocked" => Ok(Self::TimeLocked),
            other => bail!("Unknown payout basis: {other}"),
        }
    }
}

/// A saved payout policy, as returned to the frontend.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub(crate) struct PayoutPolicy {
    pub id: i64,
    pub watch_only_id: i64,
    pub recipient: String,
    pub basis: PayoutBasis,
    /// Decimal rate, kept as text (applied to i128 nau backend-side).
    pub multiplier: String,
    /// Lower bound on a receipt's lock in whole days (TimeLocked only); `None`
    /// means no lower bound.
    pub min_lock_days: Option<i64>,
    /// Upper bound on a receipt's lock in whole days (TimeLocked only).
    pub max_lock_days: i64,
    /// NPT decimal ceiling on one run's payout; `None` means no ceiling.
    pub max_daily_payout: Option<String>,
    pub min_confirmations: i64,
    /// Daily run time as minutes-of-day in the user's local wall clock.
    pub run_time: i64,
    pub armed: bool,
    /// Milliseconds; when the policy was (last) armed. Only receipts confirmed
    /// after this are ever paid against. `None` if never armed.
    pub meter_start: Option<i64>,
    /// Milliseconds of the most recent run, if any.
    pub last_run_at: Option<i64>,
}

impl PayoutPolicy {
    fn from_row(row: &sqlx::sqlite::SqliteRow) -> Result<Self> {
        Ok(Self {
            id: row.get("id"),
            watch_only_id: row.get("watch_only_id"),
            recipient: row.get("recipient"),
            basis: PayoutBasis::from_str(&row.get::<String, _>("basis"))?,
            multiplier: row.get("multiplier"),
            min_lock_days: row.get("min_lock_days"),
            max_lock_days: row.get("max_lock_days"),
            max_daily_payout: row.get("max_daily_payout"),
            min_confirmations: row.get("min_confirmations"),
            run_time: row.get("run_time"),
            armed: row.get::<i64, _>("armed") != 0,
            meter_start: row.get("meter_start"),
            last_run_at: row.get("last_run_at"),
        })
    }
}

/// One recorded daily payout run, for the audit/history view. Amounts are NPT
/// decimal strings (converted from stored nau).
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub(crate) struct PayoutRun {
    pub id: i64,
    pub run_at: i64,
    pub basis_amount: String,
    pub payout_amount: String,
    pub fee: String,
    /// The broadcast transaction's output addition records (canonical
    /// commitments, comma-separated hex); `None` unless a payment was sent.
    pub output_commitments: Option<String>,
    pub status: String,
}

/// A read-only projection of what an armed policy would pay if it ran right
/// now. Computed from the exact same eligibility rules as a real run, so the
/// number shown can never drift from the number that would be paid. Amounts
/// are NPT decimal strings.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub(crate) struct PayoutPreview {
    /// Whether the policy exists and is armed. When false the amounts are zero
    /// and the meter is not running.
    pub armed: bool,
    /// Sum of eligible receipts — confirmed after arming, matured to
    /// `min_confirmations`, of the policy's basis, and not yet accounted.
    pub basis_amount: String,
    /// Projected payout: `floor(basis × multiplier)`, capped by the daily
    /// maximum. This is what a run right now would send.
    pub payout_amount: String,
    /// How many receipts are counted into `basis_amount`.
    pub eligible_count: i64,
    /// Basis-eligible receipts still short of `min_confirmations`: they count
    /// toward no payout yet but will once buried deep enough, so the real
    /// figure can grow to include them.
    pub pending_maturity_amount: String,
    /// How many receipts are counted into `pending_maturity_amount`.
    pub pending_count: i64,
    /// Whether this account can currently cover the payout plus fee. When
    /// false, a run would skip-and-drop instead of paying.
    pub sufficient_funds: bool,
}

/// The form's working shape — every field as typed text — validated and
/// converted on save. `run_time` is "HH:MM"; empty `min_lock_days` /
/// `max_daily_payout` mean "unset".
#[derive(Debug, Clone, Deserialize)]
pub(crate) struct PayoutPolicyDraft {
    pub recipient: String,
    pub basis: PayoutBasis,
    pub multiplier: String,
    pub min_lock_days: String,
    pub max_lock_days: String,
    pub max_daily_payout: String,
    pub min_confirmations: String,
    pub run_time: String,
    pub armed: bool,
}

/// The eligible/pending tally of a policy's receipts, as computed by
/// [`WalletState::compute_payout_basis`]. Fields are raw nau.
#[derive(Debug, Default)]
struct PayoutBasisCalc {
    /// aocl_index of each receipt counted into `basis_nau` (rescan-stable).
    eligible_aocl: Vec<i64>,
    /// Sum of matured, in-basis, unaccounted receipts.
    basis_nau: i128,
    /// Sum of receipts eligible by basis but not yet matured.
    pending_maturity_nau: i128,
    /// Count of the receipts summed into `pending_maturity_nau`.
    pending_count: i64,
}

/// A draft that has passed validation and been normalised for storage.
struct ValidatedPolicy {
    recipient: String,
    basis: PayoutBasis,
    multiplier: String,
    min_lock_days: Option<i64>,
    max_lock_days: i64,
    max_daily_payout: Option<String>,
    min_confirmations: i64,
    run_time: i64,
    armed: bool,
}

/// Parse "HH:MM" (24-hour) into minutes-of-day.
fn parse_run_time(text: &str) -> Result<i64> {
    let (h, m) = text
        .split_once(':')
        .ok_or_else(|| anyhow::anyhow!("Run time must be HH:MM"))?;
    let hours: i64 = h
        .trim()
        .parse()
        .map_err(|_| anyhow::anyhow!("Invalid hour"))?;
    let minutes: i64 = m
        .trim()
        .parse()
        .map_err(|_| anyhow::anyhow!("Invalid minute"))?;
    ensure!(
        (0..24).contains(&hours) && (0..60).contains(&minutes),
        "Run time must be a valid 24-hour HH:MM"
    );
    Ok(hours * 60 + minutes)
}

/// True for a strictly-positive decimal such as "0.5" or "2".
fn is_positive_decimal(text: &str) -> bool {
    // Same shape the frontend accepts; the value must also be > 0.
    let ok_shape = !text.is_empty()
        && text
            .split_once('.')
            .map_or(text, |(i, _)| i)
            .chars()
            .all(|c| c.is_ascii_digit())
        && text.chars().all(|c| c.is_ascii_digit() || c == '.')
        && text.matches('.').count() <= 1;
    ok_shape && text.chars().any(|c| ('1'..='9').contains(&c))
}

impl super::WalletState {
    fn validate_policy(&self, draft: &PayoutPolicyDraft) -> Result<ValidatedPolicy> {
        let recipient = draft.recipient.trim().to_string();
        ensure!(!recipient.is_empty(), "A recipient address is required");
        // Authoritative network check.
        ReceivingAddress::from_bech32m(&recipient, self.network)
            .map_err(|_| anyhow::anyhow!("Recipient is not a valid address for this network"))?;

        ensure!(
            is_positive_decimal(draft.multiplier.trim()),
            "Multiplier must be a decimal greater than zero"
        );
        let multiplier = draft.multiplier.trim().to_string();

        let max_lock_days: i64 = draft
            .max_lock_days
            .trim()
            .parse()
            .ok()
            .filter(|d| *d > 0)
            .ok_or_else(|| anyhow::anyhow!("Maximum lock days must be a whole number > 0"))?;

        let min_lock_days = match draft.min_lock_days.trim() {
            "" => None,
            s => {
                let d: i64 = s.parse().ok().filter(|d| *d > 0).ok_or_else(|| {
                    anyhow::anyhow!("Minimum lock days must be a whole number > 0")
                })?;
                ensure!(
                    d <= max_lock_days,
                    "Minimum lock days cannot exceed maximum lock days"
                );
                Some(d)
            }
        };

        let max_daily_payout = match draft.max_daily_payout.trim() {
            "" => None,
            s => {
                // Reuse the wallet's amount parser so it matches send validation.
                NativeCurrencyAmount::coins_from_str(s)
                    .ok()
                    .filter(|a| a.is_positive())
                    .ok_or_else(|| anyhow::anyhow!("Maximum per payout must be an amount > 0"))?;
                Some(s.to_string())
            }
        };

        let min_confirmations: i64 = draft
            .min_confirmations
            .trim()
            .parse()
            .ok()
            .filter(|c| *c >= 0)
            .ok_or_else(|| anyhow::anyhow!("Required confirmations must be a whole number"))?;

        let run_time = parse_run_time(draft.run_time.trim())?;
        ensure!(
            (0..MINUTES_PER_DAY).contains(&run_time),
            "Run time out of range"
        );

        Ok(ValidatedPolicy {
            recipient,
            basis: draft.basis,
            multiplier,
            min_lock_days,
            max_lock_days,
            max_daily_payout,
            min_confirmations,
            run_time,
            armed: draft.armed,
        })
    }

    /// Create or replace the payout policy for a watch-only address.
    ///
    /// Arming (a disarmed→armed transition, including the first save while
    /// armed) stamps `meter_start = now`, so a freshly armed policy never pays
    /// against receipts from before it was armed. Editing an already-armed
    /// policy keeps its `meter_start`.
    pub(crate) async fn save_payout_policy(
        &self,
        watch_only_id: i64,
        draft: PayoutPolicyDraft,
    ) -> Result<PayoutPolicy> {
        // The metered address must exist and belong to this account.
        let exists = sqlx::query("SELECT id FROM watch_only_addresses WHERE id = ?")
            .bind(watch_only_id)
            .fetch_optional(&self.pool)
            .await?;
        ensure!(exists.is_some(), "Unknown watch-only address");

        let policy = self.validate_policy(&draft)?;

        let existing = self.get_payout_policy(watch_only_id).await?;
        let now = Timestamp::now().to_millis() as i64;
        // Re-arm (or first arm) resets the meter; staying armed keeps it.
        let meter_start: Option<i64> = if policy.armed {
            match &existing {
                Some(p) if p.armed => p.meter_start,
                _ => Some(now),
            }
        } else {
            existing.as_ref().and_then(|p| p.meter_start)
        };

        sqlx::query(
            "INSERT INTO payout_policies
                (watch_only_id, recipient, basis, multiplier, min_lock_days, max_lock_days,
                 max_daily_payout, min_confirmations, run_time, armed, meter_start, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(watch_only_id) DO UPDATE SET
                recipient = excluded.recipient,
                basis = excluded.basis,
                multiplier = excluded.multiplier,
                min_lock_days = excluded.min_lock_days,
                max_lock_days = excluded.max_lock_days,
                max_daily_payout = excluded.max_daily_payout,
                min_confirmations = excluded.min_confirmations,
                run_time = excluded.run_time,
                armed = excluded.armed,
                meter_start = excluded.meter_start",
        )
        .bind(watch_only_id)
        .bind(&policy.recipient)
        .bind(policy.basis.as_str())
        .bind(&policy.multiplier)
        .bind(policy.min_lock_days)
        .bind(policy.max_lock_days)
        .bind(&policy.max_daily_payout)
        .bind(policy.min_confirmations)
        .bind(policy.run_time)
        .bind(i64::from(policy.armed))
        .bind(meter_start)
        .bind(now)
        .execute(&self.pool)
        .await?;

        self.get_payout_policy(watch_only_id)
            .await?
            .ok_or_else(|| anyhow::anyhow!("Policy vanished after save"))
    }

    /// The payout policy for a watch-only address, if one is set.
    pub(crate) async fn get_payout_policy(
        &self,
        watch_only_id: i64,
    ) -> Result<Option<PayoutPolicy>> {
        let row = sqlx::query("SELECT * FROM payout_policies WHERE watch_only_id = ?")
            .bind(watch_only_id)
            .fetch_optional(&self.pool)
            .await?;
        row.as_ref().map(PayoutPolicy::from_row).transpose()
    }

    /// All payout policies for the current account.
    pub(crate) async fn list_payout_policies(&self) -> Result<Vec<PayoutPolicy>> {
        let rows = sqlx::query("SELECT * FROM payout_policies ORDER BY created_at ASC")
            .fetch_all(&self.pool)
            .await?;
        rows.iter().map(PayoutPolicy::from_row).collect()
    }

    /// The recorded payout runs for a watch-only address's policy, newest first.
    /// Amounts are converted from stored nau to NPT decimal strings.
    pub(crate) async fn get_payout_runs(&self, watch_only_id: i64) -> Result<Vec<PayoutRun>> {
        let Some(policy) = self.get_payout_policy(watch_only_id).await? else {
            return Ok(vec![]);
        };
        let rows = sqlx::query(
            "SELECT id, run_at, basis_amount, payout_amount, fee, output_commitments, status
             FROM payout_runs WHERE policy_id = ? ORDER BY run_at DESC",
        )
        .bind(policy.id)
        .fetch_all(&self.pool)
        .await?;

        let to_npt = |nau: String| {
            NativeCurrencyAmount::from_nau(nau.parse().unwrap_or(0)).display_lossless()
        };
        let runs = rows
            .into_iter()
            .map(|row| PayoutRun {
                id: row.get("id"),
                run_at: row.get("run_at"),
                basis_amount: to_npt(row.get("basis_amount")),
                payout_amount: to_npt(row.get("payout_amount")),
                fee: to_npt(row.get("fee")),
                output_commitments: row.get("output_commitments"),
                status: row.get("status"),
            })
            .collect();
        Ok(runs)
    }

    /// Delete a watch-only address's payout policy (and its run history).
    pub(crate) async fn remove_payout_policy(&self, watch_only_id: i64) -> Result<()> {
        let mut db_tx = self.pool.begin().await?;
        if let Some(policy) = self.get_payout_policy(watch_only_id).await? {
            sqlx::query("DELETE FROM payout_runs WHERE policy_id = ?")
                .bind(policy.id)
                .execute(&mut *db_tx)
                .await?;
        }
        sqlx::query("DELETE FROM payout_accounted_receipts WHERE watch_only_id = ?")
            .bind(watch_only_id)
            .execute(&mut *db_tx)
            .await?;
        sqlx::query("DELETE FROM payout_policies WHERE watch_only_id = ?")
            .bind(watch_only_id)
            .execute(&mut *db_tx)
            .await?;
        db_tx.commit().await?;
        Ok(())
    }
}

impl super::WalletState {
    /// Fire every payout policy whose daily slot has come due, for this
    /// (active, unlocked) account. Called periodically once the account is
    /// synced; a slot missed while the app was closed fires once on the next
    /// call (a single combined payout), not once per missed day.
    ///
    /// A policy is due when a scheduled slot at or after its `meter_start` (so
    /// arming never triggers an immediate run) has elapsed since its last run.
    pub(crate) async fn run_due_payouts(&self) -> Result<()> {
        let policies = self.list_payout_policies().await?;
        let now = Local::now();
        let now_ms = now.timestamp_millis();

        for policy in policies {
            if !policy.armed {
                continue;
            }
            let Some(meter_start) = policy.meter_start else {
                continue;
            };
            let Some(slot) = most_recent_slot_ms(policy.run_time, now) else {
                continue;
            };
            if !is_due(meter_start, policy.last_run_at, slot) {
                continue;
            }

            match self.run_payout_policy(&policy, now_ms).await {
                Ok(status) => info!(
                    "Payout run for policy {} (watch-only {}): {status:?}",
                    policy.id, policy.watch_only_id
                ),
                Err(e) => error!("Payout run for policy {} errored: {e}", policy.id),
            }
        }
        Ok(())
    }

    /// Tally the metered address's eligible receipts against a policy, as of a
    /// synced `tip_height`. Read-only: no accounting, no send.
    ///
    /// A receipt counts toward `basis_nau` when it is confirmed after
    /// `meter_start`, not yet accounted, of the policy's basis (Liquid, or
    /// TimeLocked within the lock-day bounds), and matured to
    /// `min_confirmations`. A receipt that satisfies everything *except*
    /// maturity is set aside in `pending_maturity_nau` — it earns nothing yet
    /// but will once buried deep enough.
    async fn compute_payout_basis(
        &self,
        policy: &PayoutPolicy,
        meter_start: i64,
        tip_height: i64,
    ) -> Result<PayoutBasisCalc> {
        // Exclude receipts already accounted by a prior run. The ledger is keyed
        // by aocl_index (rescan-stable) and survives rollback, so a resync never
        // re-pays.
        let rows = sqlx::query(
            "SELECT wu.amount, wu.utxo, wu.confirm_timestamp, wu.confirm_height, wu.aocl_index
             FROM watch_only_utxos wu
             WHERE wu.watch_only_id = ? AND wu.confirm_timestamp >= ?
               AND NOT EXISTS (
                   SELECT 1 FROM payout_accounted_receipts p
                   WHERE p.watch_only_id = wu.watch_only_id AND p.aocl_index = wu.aocl_index
               )",
        )
        .bind(policy.watch_only_id)
        .bind(meter_start)
        .fetch_all(&self.pool)
        .await?;

        let max_lock_ms = policy.max_lock_days as i128 * MS_PER_DAY;
        let min_lock_ms = policy.min_lock_days.map(|d| d as i128 * MS_PER_DAY);

        let mut calc = PayoutBasisCalc::default();
        for row in &rows {
            let confirm_ms: i64 = row.get("confirm_timestamp");
            let Some(blob) = row.get::<Option<Vec<u8>>, _>("utxo") else {
                continue;
            };
            let Ok(utxo) = bincode::deserialize::<Utxo>(&blob) else {
                continue;
            };
            let receipt_time = Timestamp(BFieldElement::new(confirm_ms.max(0) as u64));
            let pending = pending_release_date(&utxo, receipt_time);
            let eligible = match policy.basis {
                PayoutBasis::Liquid => pending.is_none(),
                PayoutBasis::TimeLocked => match pending {
                    Some(release) => {
                        let lock_ms = release.to_millis() as i128 - confirm_ms as i128;
                        lock_ms <= max_lock_ms && min_lock_ms.is_none_or(|m| lock_ms >= m)
                    }
                    None => false,
                },
            };
            if !eligible {
                continue;
            }
            let amount_nau: i128 = row.get::<String, _>("amount").parse().unwrap_or(0);
            let confirm_height: i64 = row.get("confirm_height");
            if tip_height - confirm_height < policy.min_confirmations {
                // Basis-eligible but not matured yet; leave for a later run.
                calc.pending_maturity_nau = calc.pending_maturity_nau.saturating_add(amount_nau);
                calc.pending_count += 1;
                continue;
            }
            calc.basis_nau = calc.basis_nau.saturating_add(amount_nau);
            calc.eligible_aocl.push(row.get("aocl_index"));
        }
        Ok(calc)
    }

    /// Project what an armed policy would pay if it ran right now, without
    /// sending or accounting anything. Returns zeros for a missing, disarmed, or
    /// not-yet-synced policy. See [`PayoutPreview`].
    pub(crate) async fn preview_payout(&self, watch_only_id: i64) -> Result<PayoutPreview> {
        let to_npt = |nau: i128| NativeCurrencyAmount::from_nau(nau).display_lossless();
        let disarmed = |armed: bool| PayoutPreview {
            armed,
            basis_amount: to_npt(0),
            payout_amount: to_npt(0),
            eligible_count: 0,
            pending_maturity_amount: to_npt(0),
            pending_count: 0,
            sufficient_funds: true,
        };

        let Some(policy) = self.get_payout_policy(watch_only_id).await? else {
            return Ok(disarmed(false));
        };
        let Some(meter_start) = policy.meter_start.filter(|_| policy.armed) else {
            return Ok(disarmed(policy.armed));
        };
        // Maturity needs a synced tip; before that, report armed with no figure.
        let Some((tip_height, _)) = self.get_tip().await? else {
            return Ok(disarmed(true));
        };

        let calc = self
            .compute_payout_basis(&policy, meter_start, tip_height as i64)
            .await?;
        let payout_nau = capped_payout_nau(&policy, calc.basis_nau);

        // A run pays out + fee from this account; nothing to pay ⇒ trivially OK.
        let fee = NativeCurrencyAmount::coins_from_str(DEFAULT_PAYOUT_FEE_NPT)
            .expect("default payout fee must parse");
        let (available, _total) = self.get_all_balance().await?;
        let sufficient_funds =
            payout_nau <= 0 || available.to_nau() >= payout_nau.saturating_add(fee.to_nau());

        Ok(PayoutPreview {
            armed: true,
            basis_amount: to_npt(calc.basis_nau),
            payout_amount: to_npt(payout_nau),
            eligible_count: calc.eligible_aocl.len() as i64,
            pending_maturity_amount: to_npt(calc.pending_maturity_nau),
            pending_count: calc.pending_count,
            sufficient_funds,
        })
    }

    /// Execute one payout run for an armed policy at `run_at` (ms since epoch).
    ///
    /// Counts the metered address's receipts that are: confirmed after
    /// `meter_start`, matured to `min_confirmations`, of the policy's basis
    /// (Liquid, or TimeLocked within the lock-day bounds), and not yet
    /// accounted. Pays `floor(basis × multiplier)` (capped) from this account,
    /// or — if funds can't cover it — drops. Either way every counted receipt is
    /// marked accounted so it is never paid against twice, and the run is
    /// recorded. Immature receipts are left untouched for a later run.
    ///
    /// The accounting is committed *before* the transaction is broadcast, so a
    /// crash mid-send can only ever under-pay (matching skip-&-drop), never
    /// double-pay.
    pub(crate) async fn run_payout_policy(
        &self,
        policy: &PayoutPolicy,
        run_at: i64,
    ) -> Result<PayoutRunStatus> {
        // Only receipts after the latest arming are ever eligible.
        let Some(meter_start) = policy.meter_start else {
            return Ok(PayoutRunStatus::SkippedNoReceipts);
        };
        // Maturation needs a synced tip; without one, don't advance (retry later).
        let Some((tip_height, _)) = self.get_tip().await? else {
            bail!("cannot run payout before initial sync");
        };
        let tip_height = tip_height as i64;

        // Eligible receipts (matured, in-basis, unaccounted), identified by
        // their rescan-stable aocl_index. Same computation the preview uses.
        let calc = self
            .compute_payout_basis(policy, meter_start, tip_height)
            .await?;
        let eligible_aocl = calc.eligible_aocl;
        let basis_nau = calc.basis_nau;

        // Compute the payout (before the funds check).
        let payout_nau = capped_payout_nau(policy, basis_nau);

        // Nothing to pay: record and advance without touching any receipt.
        if eligible_aocl.is_empty() || payout_nau <= 0 {
            self.finalize_run(
                policy,
                run_at,
                &eligible_aocl,
                basis_nau,
                payout_nau.max(0),
                0,
                PayoutRunStatus::SkippedNoReceipts,
            )
            .await?;
            return Ok(PayoutRunStatus::SkippedNoReceipts);
        }

        let fee = NativeCurrencyAmount::coins_from_str(DEFAULT_PAYOUT_FEE_NPT)
            .expect("default payout fee must parse");
        let (available, _total) = self.get_all_balance().await?;
        let needed = payout_nau.saturating_add(fee.to_nau());

        // Insufficient funds: skip & drop (account so it is not retried).
        if available.to_nau() < needed {
            self.finalize_run(
                policy,
                run_at,
                &eligible_aocl,
                basis_nau,
                payout_nau,
                fee.to_nau(),
                PayoutRunStatus::SkippedInsufficientFunds,
            )
            .await?;
            return Ok(PayoutRunStatus::SkippedInsufficientFunds);
        }

        // Account first (committed), then broadcast — never double-pay.
        let run_id = self
            .finalize_run(
                policy,
                run_at,
                &eligible_aocl,
                basis_nau,
                payout_nau,
                fee.to_nau(),
                PayoutRunStatus::Paid,
            )
            .await?;

        let recipient = ReceivingAddress::from_bech32m(&policy.recipient, self.network)?;
        match self
            .send_to_address(
                vec![(recipient, NativeCurrencyAmount::from_nau(payout_nau))],
                (
                    UtxoNotificationMedium::OnChain,
                    UtxoNotificationMedium::OnChain,
                ),
                fee,
                InputSelectionRule::default(),
                vec![],
                true, // accept lustrations — an automated run can't prompt
            )
            .await
        {
            Ok(tx) => {
                // Track the initiated transaction by its output addition records
                // (canonical commitments), not a transaction id.
                let commitments = tx
                    .kernel
                    .outputs
                    .iter()
                    .map(|output| output.canonical_commitment.to_hex())
                    .collect::<Vec<_>>()
                    .join(",");
                info!(
                    "Payout policy {} paid {payout_nau} nau; outputs {commitments}",
                    policy.id
                );
                self.update_run_result(run_id, Some(commitments), PayoutRunStatus::Paid)
                    .await?;
                Ok(PayoutRunStatus::Paid)
            }
            Err(e) => {
                error!("Payout send failed for policy {}: {e}", policy.id);
                self.update_run_result(run_id, None, PayoutRunStatus::Failed)
                    .await?;
                Ok(PayoutRunStatus::Failed)
            }
        }
    }

    /// Record the run, mark the eligible receipts accounted (by rescan-stable
    /// aocl_index), and advance the policy's `last_run_at` — all in one
    /// transaction. Returns the run id.
    #[allow(clippy::too_many_arguments)]
    async fn finalize_run(
        &self,
        policy: &PayoutPolicy,
        run_at: i64,
        eligible_aocls: &[i64],
        basis_nau: i128,
        payout_nau: i128,
        fee_nau: i128,
        status: PayoutRunStatus,
    ) -> Result<i64> {
        let mut db_tx = self.pool.begin().await?;
        // `output_commitments` is filled in after a successful broadcast; the
        // initial insert (including the skip paths) leaves it null.
        let run_id = sqlx::query(
            "INSERT INTO payout_runs
                (policy_id, run_at, basis_amount, payout_amount, fee, output_commitments, status, created_at)
             VALUES (?, ?, ?, ?, ?, NULL, ?, ?)",
        )
        .bind(policy.id)
        .bind(run_at)
        .bind(basis_nau.to_string())
        .bind(payout_nau.to_string())
        .bind(fee_nau.to_string())
        .bind(status.as_str())
        .bind(run_at)
        .execute(&mut *db_tx)
        .await?
        .last_insert_rowid();

        // Record each counted receipt in the rescan-surviving ledger.
        for aocl_index in eligible_aocls {
            sqlx::query(
                "INSERT OR IGNORE INTO payout_accounted_receipts
                    (watch_only_id, aocl_index, run_id, accounted_at)
                 VALUES (?, ?, ?, ?)",
            )
            .bind(policy.watch_only_id)
            .bind(aocl_index)
            .bind(run_id)
            .bind(run_at)
            .execute(&mut *db_tx)
            .await?;
        }

        sqlx::query("UPDATE payout_policies SET last_run_at = ? WHERE id = ?")
            .bind(run_at)
            .bind(policy.id)
            .execute(&mut *db_tx)
            .await?;

        db_tx.commit().await?;
        Ok(run_id)
    }

    async fn update_run_result(
        &self,
        run_id: i64,
        output_commitments: Option<String>,
        status: PayoutRunStatus,
    ) -> Result<()> {
        sqlx::query("UPDATE payout_runs SET output_commitments = ?, status = ? WHERE id = ?")
            .bind(&output_commitments)
            .bind(status.as_str())
            .bind(run_id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use chrono::Local;
    use chrono::TimeZone;
    use neptune_consensus::transaction::utxo::Utxo;
    use neptune_consensus::type_scripts::native_currency_amount::NativeCurrencyAmount;
    use neptune_primitives::network::Network;
    use neptune_primitives::timestamp::Timestamp;
    use neptune_wallet::twenty_first::tip5::Digest;
    use neptune_wallet::wallet_entropy::WalletEntropy;
    use sqlx::Row;

    use super::*;
    use crate::tests::test_devnet_wallet;
    use crate::wallet::WalletState;

    const RUN_AT: i64 = 2_000_000;

    /// A fresh test wallet with its synced tip set, so `min_confirmations`
    /// maturation has a tip height to measure against.
    async fn wallet_with_tip(tip_height: u64) -> WalletState {
        let wallet = test_devnet_wallet().await;
        let mut db_tx = wallet.pool.begin().await.unwrap();
        wallet
            .set_tip(&mut db_tx, (tip_height, Digest::default()))
            .await
            .unwrap();
        db_tx.commit().await.unwrap();
        wallet
    }

    /// A valid payout recipient address for `network`.
    fn recipient(network: Network) -> String {
        WalletEntropy::devnet_wallet()
            .nth_viewing_address_key(0)
            .to_address()
            .to_bech32m(network)
    }

    /// Add a watch-only address and return its id (the metered address).
    async fn add_address(wallet: &WalletState) -> i64 {
        let key = WalletEntropy::devnet_wallet()
            .nth_viewing_address_key(1)
            .to_address()
            .to_bech32m(wallet.network);
        wallet
            .add_watch_only("ViewingAddress", &key, None, None)
            .await
            .unwrap()
            .id
    }

    /// A UTXO of `nau` with no time lock.
    fn liquid_utxo(nau: i128) -> Utxo {
        Utxo::new_native_currency(Digest::default(), NativeCurrencyAmount::from_nau(nau))
    }

    /// A UTXO of `nau` time-locked for exactly `lock_days` from epoch.
    fn timelocked_utxo(nau: i128, lock_days: usize) -> Utxo {
        liquid_utxo(nau).with_time_lock(Timestamp::days(lock_days))
    }

    /// Insert a confirmed watch-only receipt directly, as the scanner would.
    async fn insert_receipt(
        wallet: &WalletState,
        watch_only_id: i64,
        aocl_index: i64,
        confirm_height: i64,
        confirm_ms: i64,
        utxo: &Utxo,
    ) {
        sqlx::query(
            "INSERT INTO watch_only_utxos
                (watch_only_id, aocl_index, amount, confirm_height, confirm_timestamp, block_digest, utxo, sender_randomness)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        )
        .bind(watch_only_id)
        .bind(aocl_index)
        .bind(utxo.get_native_currency_amount().to_nau().to_string())
        .bind(confirm_height)
        .bind(confirm_ms)
        .bind(Digest::default().to_hex())
        .bind(bincode::serialize(utxo).unwrap())
        .bind(Digest::default().to_hex())
        .execute(&wallet.pool)
        .await
        .unwrap();
    }

    /// An armed, in-memory policy (id 1) with permissive defaults; tests
    /// override the fields they exercise.
    fn policy(watch_only_id: i64, network: Network) -> PayoutPolicy {
        PayoutPolicy {
            id: 1,
            watch_only_id,
            recipient: recipient(network),
            basis: PayoutBasis::Liquid,
            multiplier: "1".to_string(),
            min_lock_days: None,
            max_lock_days: 100_000,
            max_daily_payout: None,
            min_confirmations: 0,
            run_time: 540,
            armed: true,
            meter_start: Some(0),
            last_run_at: None,
        }
    }

    /// The aocl indices accounted so far for an address, ascending.
    async fn accounted(wallet: &WalletState, watch_only_id: i64) -> Vec<i64> {
        sqlx::query(
            "SELECT aocl_index FROM payout_accounted_receipts WHERE watch_only_id = ? ORDER BY aocl_index",
        )
        .bind(watch_only_id)
        .fetch_all(&wallet.pool)
        .await
        .unwrap()
        .iter()
        .map(|r| r.get::<i64, _>("aocl_index"))
        .collect()
    }

    /// The most recent run's `(basis_nau, payout_nau, status)`.
    async fn last_run(wallet: &WalletState, policy_id: i64) -> (i128, i128, String) {
        let row = sqlx::query(
            "SELECT basis_amount, payout_amount, status FROM payout_runs WHERE policy_id = ? ORDER BY id DESC LIMIT 1",
        )
        .bind(policy_id)
        .fetch_one(&wallet.pool)
        .await
        .unwrap();
        (
            row.get::<String, _>("basis_amount").parse().unwrap(),
            row.get::<String, _>("payout_amount").parse().unwrap(),
            row.get("status"),
        )
    }

    /// A valid disarmed draft; tests override the fields they exercise.
    fn draft(recipient: String) -> PayoutPolicyDraft {
        PayoutPolicyDraft {
            recipient,
            basis: PayoutBasis::Liquid,
            multiplier: "0.5".to_string(),
            min_lock_days: String::new(),
            max_lock_days: "1106".to_string(),
            max_daily_payout: String::new(),
            min_confirmations: "10".to_string(),
            run_time: "09:00".to_string(),
            armed: false,
        }
    }

    #[test]
    fn payout_amount_floors_and_clamps() {
        assert_eq!(500, payout_amount_nau(1000, "0.5"));
        assert_eq!(2000, payout_amount_nau(1000, "2"));
        assert_eq!(0, payout_amount_nau(1000, "0.0001"));
        assert_eq!(0, payout_amount_nau(-5, "1"));
        assert_eq!(
            NativeCurrencyAmount::MAX_NAU,
            payout_amount_nau(NativeCurrencyAmount::MAX_NAU, "2")
        );
    }

    #[test]
    fn parse_run_time_accepts_hhmm_and_rejects_garbage() {
        assert_eq!(0, parse_run_time("00:00").unwrap());
        assert_eq!(570, parse_run_time("09:30").unwrap());
        assert_eq!(1439, parse_run_time("23:59").unwrap());
        assert!(parse_run_time("24:00").is_err());
        assert!(parse_run_time("9").is_err());
        assert!(parse_run_time("aa:bb").is_err());
    }

    #[test]
    fn most_recent_slot_is_today_when_past_and_yesterday_when_before() {
        let now = Local.with_ymd_and_hms(2026, 7, 15, 10, 0, 0).unwrap();
        let today_9 = Local.with_ymd_and_hms(2026, 7, 15, 9, 0, 0).unwrap();
        assert_eq!(
            Some(today_9.timestamp_millis()),
            most_recent_slot_ms(9 * 60, now)
        );
        let yesterday_11 = Local.with_ymd_and_hms(2026, 7, 14, 11, 0, 0).unwrap();
        assert_eq!(
            Some(yesterday_11.timestamp_millis()),
            most_recent_slot_ms(11 * 60, now)
        );
    }

    #[test]
    fn is_due_respects_meter_start_last_run_and_catch_up() {
        assert!(is_due(100, None, 200));
        assert!(!is_due(300, None, 200));
        assert!(!is_due(100, Some(200), 200));
        assert!(is_due(100, Some(150), 200));
        assert!(is_due(100, Some(150), 100_000));
    }

    #[tokio::test]
    async fn save_and_get_policy_roundtrips() {
        let wallet = test_devnet_wallet().await;
        let id = add_address(&wallet).await;
        let saved = wallet
            .save_payout_policy(id, draft(recipient(wallet.network)))
            .await
            .unwrap();
        let got = wallet.get_payout_policy(id).await.unwrap().unwrap();
        assert_eq!(saved, got);
        assert_eq!("0.5", got.multiplier);
        assert_eq!(540, got.run_time);
    }

    #[tokio::test]
    async fn arming_stamps_meter_start_and_disarmed_has_none() {
        let wallet = test_devnet_wallet().await;
        let id = add_address(&wallet).await;
        let mut d = draft(recipient(wallet.network));
        let disarmed = wallet.save_payout_policy(id, d.clone()).await.unwrap();
        assert!(disarmed.meter_start.is_none());
        d.armed = true;
        let armed = wallet.save_payout_policy(id, d).await.unwrap();
        assert!(armed.meter_start.is_some());
    }

    #[tokio::test]
    async fn editing_while_armed_keeps_meter_start() {
        let wallet = test_devnet_wallet().await;
        let id = add_address(&wallet).await;
        let mut d = draft(recipient(wallet.network));
        d.armed = true;
        let first = wallet.save_payout_policy(id, d.clone()).await.unwrap();
        tokio::time::sleep(Duration::from_millis(20)).await;
        d.multiplier = "0.9".to_string();
        let second = wallet.save_payout_policy(id, d).await.unwrap();
        assert_eq!(first.meter_start, second.meter_start);
        assert_eq!("0.9", second.multiplier);
    }

    #[tokio::test]
    async fn rearming_after_disarm_resets_meter_start() {
        let wallet = test_devnet_wallet().await;
        let id = add_address(&wallet).await;
        let mut d = draft(recipient(wallet.network));
        d.armed = true;
        let first = wallet.save_payout_policy(id, d.clone()).await.unwrap();
        d.armed = false;
        wallet.save_payout_policy(id, d.clone()).await.unwrap();
        tokio::time::sleep(Duration::from_millis(2)).await;
        d.armed = true;
        let rearmed = wallet.save_payout_policy(id, d).await.unwrap();
        assert!(rearmed.meter_start.unwrap() > first.meter_start.unwrap());
    }

    #[tokio::test]
    async fn save_rejects_invalid_recipient_multiplier_and_lock_bounds() {
        let wallet = test_devnet_wallet().await;
        let id = add_address(&wallet).await;
        let network = wallet.network;

        assert!(wallet
            .save_payout_policy(id, draft("not-an-address".to_string()))
            .await
            .is_err());

        let mut d = draft(recipient(network));
        d.multiplier = "0".to_string();
        assert!(wallet.save_payout_policy(id, d).await.is_err());

        let mut e = draft(recipient(network));
        e.basis = PayoutBasis::TimeLocked;
        e.min_lock_days = "200".to_string();
        e.max_lock_days = "100".to_string();
        assert!(wallet.save_payout_policy(id, e).await.is_err());

        let mut f = draft(recipient(network));
        f.run_time = "99:99".to_string();
        assert!(wallet.save_payout_policy(id, f).await.is_err());

        assert!(wallet
            .save_payout_policy(id, draft(recipient(network)))
            .await
            .is_ok());
    }

    #[tokio::test]
    async fn liquid_basis_counts_only_unlocked_receipts() {
        let wallet = wallet_with_tip(100).await;
        let id = add_address(&wallet).await;
        insert_receipt(&wallet, id, 1, 1, 1, &liquid_utxo(1000)).await;
        insert_receipt(&wallet, id, 2, 1, 1, &timelocked_utxo(1000, 30)).await;
        let status = wallet
            .run_payout_policy(&policy(id, wallet.network), RUN_AT)
            .await
            .unwrap();
        assert_eq!(PayoutRunStatus::SkippedInsufficientFunds, status);
        assert_eq!(vec![1], accounted(&wallet, id).await);
        assert_eq!(1000, last_run(&wallet, 1).await.0);
    }

    #[tokio::test]
    async fn timelocked_basis_counts_only_locks_within_bounds() {
        let wallet = wallet_with_tip(100).await;
        let id = add_address(&wallet).await;
        insert_receipt(&wallet, id, 1, 1, 0, &timelocked_utxo(1001, 10)).await;
        insert_receipt(&wallet, id, 2, 1, 0, &timelocked_utxo(1002, 50)).await;
        insert_receipt(&wallet, id, 3, 1, 0, &timelocked_utxo(1003, 200)).await;
        let mut p = policy(id, wallet.network);
        p.basis = PayoutBasis::TimeLocked;
        p.min_lock_days = Some(20);
        p.max_lock_days = 100;
        wallet.run_payout_policy(&p, RUN_AT).await.unwrap();
        assert_eq!(vec![2], accounted(&wallet, id).await);
        assert_eq!(1002, last_run(&wallet, 1).await.0);
    }

    #[tokio::test]
    async fn receipts_before_meter_start_are_ignored() {
        let wallet = wallet_with_tip(100).await;
        let id = add_address(&wallet).await;
        insert_receipt(&wallet, id, 1, 1, 500, &liquid_utxo(1000)).await;
        let mut p = policy(id, wallet.network);
        p.meter_start = Some(1000);
        let status = wallet.run_payout_policy(&p, RUN_AT).await.unwrap();
        assert_eq!(PayoutRunStatus::SkippedNoReceipts, status);
        assert!(accounted(&wallet, id).await.is_empty());
    }

    #[tokio::test]
    async fn immature_receipts_are_left_unaccounted() {
        let wallet = wallet_with_tip(100).await;
        let id = add_address(&wallet).await;
        insert_receipt(&wallet, id, 1, 100, 0, &liquid_utxo(1000)).await;
        let mut p = policy(id, wallet.network);
        p.min_confirmations = 6;
        let status = wallet.run_payout_policy(&p, RUN_AT).await.unwrap();
        assert_eq!(PayoutRunStatus::SkippedNoReceipts, status);
        assert!(accounted(&wallet, id).await.is_empty());
    }

    #[tokio::test]
    async fn insufficient_funds_drops_and_accounts_without_paying() {
        let wallet = wallet_with_tip(100).await;
        let id = add_address(&wallet).await;
        insert_receipt(&wallet, id, 7, 1, 1, &liquid_utxo(1000)).await;
        let status = wallet
            .run_payout_policy(&policy(id, wallet.network), RUN_AT)
            .await
            .unwrap();
        assert_eq!(PayoutRunStatus::SkippedInsufficientFunds, status);
        assert_eq!(vec![7], accounted(&wallet, id).await);
        let (basis, payout, st) = last_run(&wallet, 1).await;
        assert_eq!(
            (1000, 1000, "skipped_insufficient_funds"),
            (basis, payout, st.as_str())
        );
    }

    #[tokio::test]
    async fn accounted_receipts_are_not_counted_twice() {
        let wallet = wallet_with_tip(100).await;
        let id = add_address(&wallet).await;
        insert_receipt(&wallet, id, 1, 1, 1, &liquid_utxo(1000)).await;
        let p = policy(id, wallet.network);
        let first_status = wallet.run_payout_policy(&p, RUN_AT).await.unwrap();
        assert_ne!(PayoutRunStatus::SkippedNoReceipts, first_status);

        let second_status = wallet.run_payout_policy(&p, RUN_AT + 1).await.unwrap();
        assert_eq!(PayoutRunStatus::SkippedNoReceipts, second_status);
        assert_eq!(vec![1], accounted(&wallet, id).await);
        assert_eq!(0, last_run(&wallet, 1).await.0);
    }

    #[tokio::test]
    async fn max_daily_payout_caps_the_amount() {
        let wallet = wallet_with_tip(100).await;
        let id = add_address(&wallet).await;
        let two = NativeCurrencyAmount::coins_from_str("2").unwrap();
        insert_receipt(
            &wallet,
            id,
            1,
            1,
            1,
            &Utxo::new_native_currency(Digest::default(), two),
        )
        .await;
        let mut p = policy(id, wallet.network);
        p.max_daily_payout = Some("1".to_string());
        wallet.run_payout_policy(&p, RUN_AT).await.unwrap();
        let (basis, payout, _) = last_run(&wallet, 1).await;
        assert_eq!(two.to_nau(), basis);
        assert_eq!(
            NativeCurrencyAmount::coins_from_str("1").unwrap().to_nau(),
            payout
        );
    }

    #[tokio::test]
    async fn no_eligible_receipts_records_skipped_run() {
        let wallet = wallet_with_tip(100).await;
        let id = add_address(&wallet).await;
        let status = wallet
            .run_payout_policy(&policy(id, wallet.network), RUN_AT)
            .await
            .unwrap();
        assert_eq!(PayoutRunStatus::SkippedNoReceipts, status);
        let (basis, payout, st) = last_run(&wallet, 1).await;
        assert_eq!((0, 0, "skipped_no_receipts"), (basis, payout, st.as_str()));
    }

    #[tokio::test]
    async fn accounting_survives_a_watch_only_rescan() {
        let wallet = wallet_with_tip(100).await;
        let id = add_address(&wallet).await;
        insert_receipt(&wallet, id, 5, 1, 1, &liquid_utxo(1000)).await;
        let p = policy(id, wallet.network);
        wallet.run_payout_policy(&p, RUN_AT).await.unwrap();
        assert_eq!(vec![5], accounted(&wallet, id).await);

        // Resync: watch-only UTXOs wiped and rebuilt with the same aocl_index.
        sqlx::query("DELETE FROM watch_only_utxos WHERE watch_only_id = ?")
            .bind(id)
            .execute(&wallet.pool)
            .await
            .unwrap();
        insert_receipt(&wallet, id, 5, 1, 1, &liquid_utxo(1000)).await;

        let status = wallet.run_payout_policy(&p, RUN_AT + 1).await.unwrap();
        assert_eq!(PayoutRunStatus::SkippedNoReceipts, status);
        assert_eq!(0, last_run(&wallet, 1).await.0);
    }

    #[tokio::test]
    async fn basis_computation_splits_matured_and_pending_receipts() {
        let wallet = wallet_with_tip(100).await;
        let id = add_address(&wallet).await;
        // One receipt deep enough to count, one still too shallow.
        insert_receipt(&wallet, id, 1, 1, 1, &liquid_utxo(1000)).await;
        insert_receipt(&wallet, id, 2, 97, 1, &liquid_utxo(500)).await;
        let mut p = policy(id, wallet.network);
        p.min_confirmations = 6;
        let calc = wallet.compute_payout_basis(&p, 0, 100).await.unwrap();
        assert_eq!(vec![1], calc.eligible_aocl);
        assert_eq!(1000, calc.basis_nau);
        assert_eq!(500, calc.pending_maturity_nau);
        assert_eq!(1, calc.pending_count);
    }

    #[tokio::test]
    async fn preview_projects_payout_from_received_receipts() {
        let wallet = wallet_with_tip(100).await;
        let id = add_address(&wallet).await;
        let mut d = draft(recipient(wallet.network)); // multiplier 0.5, min_conf 10
        d.armed = true;
        let ms = wallet
            .save_payout_policy(id, d)
            .await
            .unwrap()
            .meter_start
            .unwrap();
        insert_receipt(&wallet, id, 1, 1, ms, &liquid_utxo(1000)).await; // matured
        insert_receipt(&wallet, id, 2, 95, ms, &liquid_utxo(400)).await; // maturing

        let to_npt = |nau: i128| NativeCurrencyAmount::from_nau(nau).display_lossless();
        let preview = wallet.preview_payout(id).await.unwrap();
        assert!(preview.armed);
        assert_eq!(to_npt(1000), preview.basis_amount);
        assert_eq!(to_npt(500), preview.payout_amount); // 0.5 × 1000
        assert_eq!(1, preview.eligible_count);
        assert_eq!(to_npt(400), preview.pending_maturity_amount);
        assert_eq!(1, preview.pending_count);
        // The zero-balance test wallet can't cover the payout plus fee.
        assert!(!preview.sufficient_funds);
    }

    #[tokio::test]
    async fn preview_is_empty_when_absent_or_disarmed() {
        let wallet = wallet_with_tip(100).await;
        let id = add_address(&wallet).await;

        let absent = wallet.preview_payout(id).await.unwrap();
        assert!(!absent.armed);
        assert_eq!(0, absent.eligible_count);

        wallet
            .save_payout_policy(id, draft(recipient(wallet.network)))
            .await
            .unwrap();
        let disarmed = wallet.preview_payout(id).await.unwrap();
        assert!(!disarmed.armed);
    }
}
