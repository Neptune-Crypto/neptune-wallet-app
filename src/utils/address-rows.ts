import { AddressBalances, AddressRecord, AddressTotals, NeptuneKeyType } from "@/utils/api/types";
import { amount_to_positive_fixed } from "@/utils/math-util";

export type AddressRow = AddressRecord & AddressTotals;

export const NO_BALANCE: AddressTotals = {
  received: "0",
  unspent: "0",
  locked: "0",
  utxo_count: 0,
  last_activity_height: null,
  last_activity_timestamp: null,
};

export const NO_BALANCES: AddressBalances = {
  by_key: [],
  internal: NO_BALANCE,
  unattributed: NO_BALANCE,
};

export type SettledAddressFetch = {
  // null if the addresses could not be fetched: keep the rows already shown.
  addresses: AddressRecord[] | null;
  // NO_BALANCES if the balance scan failed.
  balances: AddressBalances;
  addressesError?: { error: unknown };
  balancesError?: { error: unknown };
};

// Split the Receive page's two fetches, so a failed balance scan never hides
// the addresses themselves.
export function settleAddressFetch(
  addresses: PromiseSettledResult<AddressRecord[]>,
  balances: PromiseSettledResult<AddressBalances>
): SettledAddressFetch {
  const settled: SettledAddressFetch = {
    addresses: addresses.status === "fulfilled" ? addresses.value : null,
    balances: balances.status === "fulfilled" ? balances.value : NO_BALANCES,
  };
  if (addresses.status === "rejected") settled.addressesError = { error: addresses.reason };
  if (balances.status === "rejected") settled.balancesError = { error: balances.reason };
  return settled;
}

// Attach each address's totals (of the given key type) to its record, keeping
// the input order. Addresses that never received anything get zeros.
export function mergeAddressRows(
  addresses: AddressRecord[],
  balances: AddressBalances,
  keyType: NeptuneKeyType
): AddressRow[] {
  const byIndex = new Map<number, AddressTotals>();
  for (const { key_type, key_index, ...totals } of balances.by_key) {
    if (key_type === keyType) byIndex.set(key_index, totals);
  }
  return addresses.map((a) => ({ ...a, ...(byIndex.get(a.key_index) ?? NO_BALANCE) }));
}

// Group the digits of a non-negative integer, or of the integer part of a
// decimal string, with commas ("1234567.5" -> "1,234,567.5").
export function groupThousands(value: number | string): string {
  const [int, frac] = String(value).split(".");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return frac === undefined ? grouped : `${grouped}.${frac}`;
}

// Full-precision amounts are shown with four decimals and grouped thousands;
// zero (in either the "0" or the lossless "0.000…" form) renders as "0".
export function formatNpt(amount: string): string {
  const fixed = amount_to_positive_fixed(amount);
  return fixed === "0.0000" ? "0" : groupThousands(fixed);
}

// True if the address never received anything: its cells show a dash, so a
// 0 always means "received, all spent".
export function neverReceived(row: AddressTotals): boolean {
  return row.utxo_count === 0;
}
