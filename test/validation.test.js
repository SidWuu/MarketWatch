import assert from "node:assert/strict";
import test from "node:test";

import { validateRuleInput, validateRulePatchInput, validateWatchSymbol } from "../src/server/validation.js";

test("validates watch symbols before mutating state", () => {
  assert.equal(validateWatchSymbol("sh000001").instrumentId, "1.000001");
  assert.throws(() => validateWatchSymbol("abc"), /Unsupported symbol/);
});

test("rejects unsupported rule types and non-number thresholds", () => {
  assert.throws(
    () => validateRuleInput({ symbol: "300750", type: "unknown", threshold: "3" }),
    /Unsupported rule type/
  );
  assert.throws(
    () => validateRuleInput({ symbol: "300750", type: "price-above", threshold: "bad" }),
    /threshold must be a number/
  );
});

test("normalizes valid rule input to instrument id", () => {
  assert.deepEqual(validateRuleInput({ symbol: "300750", type: "price-above", threshold: "260" }), {
    instrumentId: "0.300750",
    symbol: "300750",
    type: "price-above",
    threshold: 260
  });
});

test("normalizes editable rule patches without requiring every field", () => {
  assert.deepEqual(validateRulePatchInput({ type: "price-below", threshold: "250", enabled: false }), {
    type: "price-below",
    threshold: 250,
    enabled: false
  });
  assert.deepEqual(validateRulePatchInput({ symbol: "600519" }), {
    instrumentId: "1.600519",
    symbol: "600519"
  });
});
