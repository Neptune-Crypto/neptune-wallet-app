import { isValidUrl } from "@/utils/common";
import assert from "node:assert";
import test from "node:test";

test("accepts valid URLs", () => {
  assert.strictEqual(isValidUrl("https://example.com"), true);
  assert.strictEqual(isValidUrl("http://example.com"), true);
  assert.strictEqual(isValidUrl("https://example.com:8080"), true);
  assert.strictEqual(isValidUrl("https://example.com:80"), true);
  assert.strictEqual(isValidUrl("http://example.com:8080"), true);
  assert.strictEqual(isValidUrl("http://example.com:80"), true);
  assert.strictEqual(isValidUrl("http://127.0.0.1:9797"), true);
  assert.strictEqual(isValidUrl("http://127.0.0.1"), true);
  assert.strictEqual(isValidUrl("https://wallet.neptunefundamentals.org"), true);
  assert.strictEqual(isValidUrl("https://wallet.neptunefundamentals.org:55555"), true);
});

test("rejects invalid URLs", () => {
  assert.strictEqual(isValidUrl("not-a-url"), false);
});
