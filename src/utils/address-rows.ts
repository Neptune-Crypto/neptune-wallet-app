import { AddressBalances, AddressRecord, AddressTotals, NeptuneKeyType } from "@/utils/api/types";

export type AddressRow = AddressRecord & AddressTotals;

export const NO_BALANCE: AddressTotals = {
  received: "0",
  unspent: "0",
  locked: "0",
  utxo_count: 0,
  last_received_height: null,
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
