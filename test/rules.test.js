import assert from "node:assert/strict";
import test from "node:test";

import { evaluateRules } from "../src/server/rules.js";

test("emits a price above alert once per crossing", () => {
  const rule = {
    id: "r1",
    instrumentId: "0.000001",
    type: "price-above",
    threshold: 10,
    enabled: true
  };

  const first = evaluateRules([rule], [{ instrumentId: "0.000001", symbol: "000001", name: "平安银行", price: 10.01 }], new Map());
  const second = evaluateRules([rule], [{ instrumentId: "0.000001", symbol: "000001", name: "平安银行", price: 10.20 }], first.state);

  assert.equal(first.alerts.length, 1);
  assert.equal(first.alerts[0].severity, "danger");
  assert.equal(second.alerts.length, 0);
});

test("resets a price alert after condition becomes false", () => {
  const rule = {
    id: "r2",
    instrumentId: "0.000001",
    type: "price-below",
    threshold: 9,
    enabled: true
  };

  const first = evaluateRules([rule], [{ instrumentId: "0.000001", symbol: "000001", name: "平安银行", price: 8.99 }], new Map());
  const reset = evaluateRules([rule], [{ instrumentId: "0.000001", symbol: "000001", name: "平安银行", price: 9.10 }], first.state);
  const second = evaluateRules([rule], [{ instrumentId: "0.000001", symbol: "000001", name: "平安银行", price: 8.95 }], reset.state);

  assert.equal(first.alerts.length, 1);
  assert.equal(reset.alerts.length, 0);
  assert.equal(second.alerts.length, 1);
});

test("supports percent and turnover alerts", () => {
  const rules = [
    { id: "pct", instrumentId: "0.300750", type: "pct-change-above", threshold: 3, enabled: true },
    { id: "amount", instrumentId: "0.300750", type: "amount-above", threshold: 1000000000, enabled: true }
  ];

  const result = evaluateRules(
    rules,
    [{ instrumentId: "0.300750", symbol: "300750", name: "宁德时代", price: 260, pctChange: 3.2, amount: 1200000000 }],
    new Map()
  );

  assert.deepEqual(
    result.alerts.map((alert) => alert.ruleId),
    ["pct", "amount"]
  );
});

test("does not trigger stock rule from same-code index quote", () => {
  const result = evaluateRules(
    [{ id: "stock", instrumentId: "0.000001", type: "price-above", threshold: 10, enabled: true }],
    [{ instrumentId: "1.000001", symbol: "000001", name: "上证指数", price: 3990 }],
    new Map()
  );

  assert.equal(result.alerts.length, 0);
});

test("suppresses repeated alerts inside the silence window", () => {
  const rule = {
    id: "cooldown",
    instrumentId: "0.000001",
    type: "price-above",
    threshold: 10,
    enabled: true
  };
  const quote = { instrumentId: "0.000001", symbol: "000001", name: "平安银行", price: 10.01 };
  const inactiveQuote = { ...quote, price: 9.99 };

  const first = evaluateRules([rule], [quote], new Map(), {
    now: new Date("2026-06-16T10:00:00+08:00"),
    cooldownMs: 60000
  });
  const reset = evaluateRules([rule], [inactiveQuote], first.state, {
    now: new Date("2026-06-16T10:00:10+08:00"),
    cooldownMs: 60000
  });
  const suppressed = evaluateRules([rule], [quote], reset.state, {
    now: new Date("2026-06-16T10:00:20+08:00"),
    cooldownMs: 60000
  });
  const retriggered = evaluateRules([rule], [quote], suppressed.state, {
    now: new Date("2026-06-16T10:01:01+08:00"),
    cooldownMs: 60000
  });

  assert.equal(first.alerts.length, 1);
  assert.equal(suppressed.alerts.length, 0);
  assert.equal(retriggered.alerts.length, 1);
});
