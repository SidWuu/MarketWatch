import assert from "node:assert/strict";
import test from "node:test";

import { evaluateRules } from "../src/server/rules.js";

test("emits a price above alert once per crossing", () => {
  const rule = {
    id: "r1",
    symbol: "000001",
    type: "price-above",
    threshold: 10,
    enabled: true
  };

  const first = evaluateRules([rule], [{ symbol: "000001", price: 10.01 }], new Map());
  const second = evaluateRules([rule], [{ symbol: "000001", price: 10.20 }], first.state);

  assert.equal(first.alerts.length, 1);
  assert.equal(first.alerts[0].severity, "danger");
  assert.equal(second.alerts.length, 0);
});

test("resets a price alert after condition becomes false", () => {
  const rule = {
    id: "r2",
    symbol: "000001",
    type: "price-below",
    threshold: 9,
    enabled: true
  };

  const first = evaluateRules([rule], [{ symbol: "000001", price: 8.99 }], new Map());
  const reset = evaluateRules([rule], [{ symbol: "000001", price: 9.10 }], first.state);
  const second = evaluateRules([rule], [{ symbol: "000001", price: 8.95 }], reset.state);

  assert.equal(first.alerts.length, 1);
  assert.equal(reset.alerts.length, 0);
  assert.equal(second.alerts.length, 1);
});

test("supports percent and turnover alerts", () => {
  const rules = [
    { id: "pct", symbol: "300750", type: "pct-change-above", threshold: 3, enabled: true },
    { id: "amount", symbol: "300750", type: "amount-above", threshold: 1000000000, enabled: true }
  ];

  const result = evaluateRules(
    rules,
    [{ symbol: "300750", price: 260, pctChange: 3.2, amount: 1200000000 }],
    new Map()
  );

  assert.deepEqual(
    result.alerts.map((alert) => alert.ruleId),
    ["pct", "amount"]
  );
});
