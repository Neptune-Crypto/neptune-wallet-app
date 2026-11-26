import {
  NO_BALANCES,
  formatNpt,
  groupThousands,
  mergeAddressRows,
  neverReceived,
  settleAddressFetch,
} from "@/utils/address-rows";
import { AddressBalances, AddressRecord } from "@/utils/api/types";
import assert from "node:assert";
import test from "node:test";

const zero = "0.0000000000000000000000000000000000";
const emptyTotals = {
  received: zero,
  unspent: zero,
  locked: zero,
  utxo_count: 0,
  last_activity_height: null,
  last_activity_timestamp: null,
};

const addresses: AddressRecord[] = [
  { key_index: 2, address: "a2", address_short_form: "s2", label: "Pool" },
  { key_index: 0, address: "a0", address_short_form: "s0", label: null },
  { key_index: 1, address: "a1", address_short_form: "s1", label: null },
];

const balances: AddressBalances = {
  by_key: [
    {
      key_type: "Generation",
      key_index: 2,
      received: "5.5",
      unspent: "3",
      locked: "1",
      utxo_count: 2,
      last_activity_height: 100,
      last_activity_timestamp: 1764000000000,
    },
    {
      key_type: "EcHybrid",
      key_index: 0,
      received: "7",
      unspent: "7",
      locked: zero,
      utxo_count: 1,
      last_activity_height: 50,
      last_activity_timestamp: 1763000000000,
    },
  ],
  internal: emptyTotals,
  unattributed: emptyTotals,
};

test("Balances attach by key index", () => {
  const rows = mergeAddressRows(addresses, balances, "Generation");
  const row = rows.find((r) => r.key_index === 2)!;
  assert.strictEqual(row.address, "a2");
  assert.strictEqual(row.label, "Pool");
  assert.strictEqual(row.received, "5.5");
  assert.strictEqual(row.unspent, "3");
  assert.strictEqual(row.locked, "1");
  assert.strictEqual(row.utxo_count, 2);
  assert.strictEqual(row.last_activity_height, 100);
  assert.strictEqual(row.last_activity_timestamp, 1764000000000);
});

test("Balances of another key type do not attach", () => {
  const rows = mergeAddressRows(addresses, balances, "Generation");
  const row = rows.find((r) => r.key_index === 0)!;
  assert.strictEqual(row.utxo_count, 0);
  assert.strictEqual(row.received, "0");

  const ec = mergeAddressRows(addresses, balances, "EcHybrid");
  assert.strictEqual(ec.find((r) => r.key_index === 0)!.received, "7");
  assert.strictEqual(ec.find((r) => r.key_index === 2)!.utxo_count, 0);
});

test("Addresses without a balance get zeros", () => {
  const rows = mergeAddressRows(addresses, balances, "Generation");
  const row = rows.find((r) => r.key_index === 1)!;
  assert.deepStrictEqual(row, {
    key_index: 1,
    address: "a1",
    address_short_form: "s1",
    label: null,
    received: "0",
    unspent: "0",
    locked: "0",
    utxo_count: 0,
    last_activity_height: null,
    last_activity_timestamp: null,
  });
});

test("Rows keep the input address order", () => {
  const rows = mergeAddressRows(addresses, balances, "Generation");
  assert.deepStrictEqual(
    rows.map((r) => r.key_index),
    [2, 0, 1]
  );
});

test("A failed balance scan keeps the addresses", () => {
  const settled = settleAddressFetch(
    { status: "fulfilled", value: addresses },
    { status: "rejected", reason: "scan failed" }
  );
  assert.strictEqual(settled.addresses, addresses);
  assert.strictEqual(settled.balances, NO_BALANCES);
  assert.strictEqual(settled.addressesError, undefined);
  assert.deepStrictEqual(settled.balancesError, { error: "scan failed" });
});

test("A failed address fetch keeps the balances", () => {
  const settled = settleAddressFetch(
    { status: "rejected", reason: undefined },
    { status: "fulfilled", value: balances }
  );
  assert.strictEqual(settled.addresses, null);
  assert.strictEqual(settled.balances, balances);
  assert.deepStrictEqual(settled.addressesError, { error: undefined });
  assert.strictEqual(settled.balancesError, undefined);
});

test("Thousands are grouped", () => {
  assert.strictEqual(groupThousands(0), "0");
  assert.strictEqual(groupThousands(999), "999");
  assert.strictEqual(groupThousands(62301), "62,301");
  assert.strictEqual(groupThousands(1234567), "1,234,567");
  assert.strictEqual(groupThousands("2046.8750"), "2,046.8750");
});

test("Amounts keep four decimals with grouped thousands", () => {
  assert.strictEqual(formatNpt("2046.875"), "2,046.8750");
  assert.strictEqual(formatNpt("300"), "300.0000");
  assert.strictEqual(formatNpt(zero), "0");
  assert.strictEqual(formatNpt("0"), "0");
});

test("Only addresses without UTXOs count as never received", () => {
  const rows = mergeAddressRows(addresses, balances, "Generation");
  assert.strictEqual(neverReceived(rows.find((r) => r.key_index === 1)!), true);
  assert.strictEqual(neverReceived(rows.find((r) => r.key_index === 2)!), false);
  // Received and fully spent: still shown as numbers.
  assert.strictEqual(neverReceived({ ...emptyTotals, utxo_count: 1 }), false);
});
