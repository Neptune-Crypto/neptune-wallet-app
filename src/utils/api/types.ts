export interface SendTransactionParam {
  outputs: Output[];
  fee: string;
  inputs: number[];
  accept_lustrations: boolean;
}

// One on-chain output of a sent transaction. `is_change` marks outputs that
// return funds to this wallet (change / self-send), so the UI can tell them
// apart from the recipient output(s). Fields beyond `commitment` are optional
// because records written before this existed stored only the commitment hex.
export interface OutputInfo {
  commitment: string;
  amount?: string;
  is_change?: boolean;
  // Recipient address (bech32m) this output pays; absent for change outputs
  // and for legacy records that stored only the commitment.
  address?: string;
}

export interface SendTransactionResponse {
  txid: string;
  outputs: OutputInfo[];
}

export interface Output {
  address: string;
  amount: string;
}

export interface WalletBalanceData {
  spendable_balance: string;
  pending_change: string;
  total_balance: string;
}

export interface PendingTransaction {
  tx_id: string;
  status: string;
}

export interface HistoryData {
  amount: string;
  timestamp: number;
  height: number;
  index: number;
  release_date: any;
  txid: string;
}

export interface SendInputItem {
  index: number;
  toAddress: string;
  amount: string;
}

// Match the exact PascalCase names of the Rust enum variants
// Does not include symmetric addresses since they cannot be securely displayed.
export type NeptuneKeyType = "Generation" | "ViewingAddress" | "EcHybrid";

// Matches the Rust AddressRecord struct
export interface AddressRecord {
  key_index: number;
  address: string;
  address_short_form: string;
  label?: string;
}

// Watch-only address types the backend can import today. EC hybrid is scoped
// but gated on serializable viewing-key support in neptune-wallet.
export type WatchOnlyKeyType = "ViewingAddress" | "EcHybrid";

// Matches the Rust WatchOnlyAddressRecord struct
export interface WatchOnlyAddressRecord {
  id: number;
  key_type: string;
  address: string;
  address_short_form: string;
  name: string;
  // True when a receiver preimage was imported, so balance/available are meaningful.
  tracks_balance: boolean;
  total_received: string;
  // Present only when tracks_balance is true.
  balance?: string;
  available?: string;
  // Amount still time-locked, and the earliest upcoming unlock among those
  // coins. A time-locked UTXO cannot have been spent yet, so these need no
  // receiver preimage to populate. Timestamp serializes as epoch millis.
  locked: string;
  next_release_date?: number;
}

// Which incoming UTXOs count toward a payout policy's basis. Decided per
// receipt, from whether it carried a pending time lock when it was received.
export type PayoutBasis = "Liquid" | "TimeLocked";

// A daily payout policy attached to a watch-only address.
//
// The watched address is only the meter: it can never be spent from, so the
// payout is sent from this account's own balance. Each run pays
// `multiplier × (eligible amount received since the last run)`, so a stretch
// with no receipts pays nothing and a missed day is covered by the next run.
export interface PayoutPolicy {
  id: number;
  watch_only_id: number;
  // Destination of every payout. Validated backend-side against the network;
  recipient: string;

  basis: PayoutBasis;

  // A multiplier on the meter. How much to pay out for each coin received.
  multiplier: string;

  // Whole days, measured from each UTXO's receipt; only consulted when `basis`
  // is TimeLocked. A receipt whose lock runs longer than this is excluded from
  // the basis entirely.
  //
  // Deliberately not optional: with no cap, a receipt locked for a million
  // years would earn a payout, and those coins are burnt in all but name. The
  // backend converts this to a Timestamp (millisecond resolution) on the way
  // in; whole days are all the frontend needs to express.
  //
  // Mining rewards sit at 1095.72 days (Timestamp::years(3), i.e. 365.24 mean
  // days each), so a cap must clear that to include them.
  max_lock_days: number;

  // Whole days; TimeLocked only. Lower bound on a receipt's lock — locks
  // shorter than this are excluded. Optional (undefined = no lower bound).
  min_lock_days?: number;

  // NPT decimal string. Ceiling on a single run's payout; undefined = none.
  max_daily_payout?: string;

  // Receipts count only once buried this deep, so a reorg cannot undo a
  // receipt that has already been paid out against.
  min_confirmations: number;

  // Daily run time as minutes-of-day in the user's local wall clock.
  run_time: number;

  // A saved policy starts disarmed and never sends until explicitly armed.
  armed: boolean;

  // Epoch ms when last armed (only receipts after this are ever paid against),
  // and epoch ms of the most recent run. Backend-managed; shown as status.
  meter_start?: number;
  last_run_at?: number;
}

// The form's working shape: every field a string, as typed, validated and
// converted on save.
export interface PayoutPolicyDraft {
  recipient: string;
  basis: PayoutBasis;
  multiplier: string;
  min_lock_days: string;
  max_lock_days: string;
  max_daily_payout: string;
  min_confirmations: string;
  // 24-hour "HH:MM", local wall clock.
  run_time: string;
  armed: boolean;
}

// One recorded daily payout run (audit history). Amounts are NPT decimal
// strings. `status` is one of paid / skipped_no_receipts /
// skipped_insufficient_funds / failed.
export interface PayoutRun {
  id: number;
  run_at: number;
  basis_amount: string;
  payout_amount: string;
  fee: string;
  // The broadcast transaction's output addition records (comma-separated hex),
  // set only for paid runs. Transactions are tracked by outputs, not a txid.
  output_commitments?: string;
  status: string;
}
