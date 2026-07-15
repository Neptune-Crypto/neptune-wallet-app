export interface SendTransactionParam {
  outputs: Output[];
  fee: string;
  inputs: number[];
  accept_lustrations: boolean;
}

export interface SendTransactionResponse {
  txid: string;
  outputs: string[];
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
  label?: string;
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
