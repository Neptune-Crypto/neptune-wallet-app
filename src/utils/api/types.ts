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
  label?: string | null;
}

// Matches the Rust AddressTotals struct. Amounts are lossless display strings.
export interface AddressTotals {
  received: string;
  unspent: string;
  locked: string;
  utxo_count: number;
  // Latest block that confirmed or spent one of the UTXOs; null without UTXOs.
  last_activity_height: number | null;
  // That block's timestamp in milliseconds.
  last_activity_timestamp: number | null;
}

// Matches the Rust AddressBalance struct (totals are flattened in).
export interface AddressBalance extends AddressTotals {
  key_type: NeptuneKeyType;
  key_index: number;
}

// Matches the Rust AddressBalances struct
export interface AddressBalances {
  by_key: AddressBalance[];
  // Symmetric keys: change and the wallet's own mining rewards.
  internal: AddressTotals;
  // UTXOs that match no known key.
  unattributed: AddressTotals;
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
