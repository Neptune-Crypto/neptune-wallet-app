import { shouldAutoLock } from "@/utils/auto-lock";
import assert from "node:assert";
import test from "node:test";

const MINUTE = 60_000;
const base = {
  timeoutMinutes: 5,
  lastActivity: 0,
  now: 0,
  sendInProgress: false,
};

test("locks once the idle timeout has elapsed", () => {
  assert.strictEqual(shouldAutoLock({ ...base, now: 5 * MINUTE }), true);
  assert.strictEqual(shouldAutoLock({ ...base, now: 30 * MINUTE }), true);
});

test("stays unlocked before the timeout", () => {
  assert.strictEqual(shouldAutoLock({ ...base, now: 5 * MINUTE - 1 }), false);
});

test("counts idle time from the last activity, not from zero", () => {
  assert.strictEqual(
    shouldAutoLock({ ...base, lastActivity: 10 * MINUTE, now: 14 * MINUTE }),
    false
  );
  assert.strictEqual(
    shouldAutoLock({ ...base, lastActivity: 10 * MINUTE, now: 15 * MINUTE }),
    true
  );
});

test("never locks when the timeout is off", () => {
  assert.strictEqual(shouldAutoLock({ ...base, timeoutMinutes: 0, now: 10_000 * MINUTE }), false);
});

test("defers while a send is in flight", () => {
  assert.strictEqual(shouldAutoLock({ ...base, now: 30 * MINUTE, sendInProgress: true }), false);
});
