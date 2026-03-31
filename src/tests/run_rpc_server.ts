import { _test_internals } from "@/store/auth/auth-slice";
import assert from "node:assert";
import test from "node:test";

/** Trick to silence console for negative test cases */
const silentLogger = { log: () => {}, error: () => {} };

test("returns true on success", async () => {
  const mock = async () => {};

  const result = await _test_internals.startRpcLogic(mock);

  assert.deepStrictEqual(result, { data: true });
});

test("returns true if already running", async () => {
  const mock = async () => {
    throw "rpc server is already running";
  };

  const result = await _test_internals.startRpcLogic(mock);

  assert.deepStrictEqual(result, { data: true });
});

test("returns false on other errors", async () => {
  const mock = async () => {
    throw new Error("boom");
  };

  const result = await _test_internals.startRpcLogic(mock, silentLogger as any);

  assert.deepStrictEqual(result, { data: false });
});
