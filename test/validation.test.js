import assert from "node:assert/strict";
import test from "node:test";

import { validateRuleInput, validateWatchSymbol } from "../src/server/validation.js";

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
