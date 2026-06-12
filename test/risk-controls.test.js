import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_RISK_CONTROLS,
  evaluateRiskControls,
  normalizeRiskControls
} from "../src/server/risk-controls.js";

const account = {
  mode: "PAPER",
  currency: "CNY",
  cash: 1000000,
  positions: {},
  orders: [],
  orderDrafts: []
};

const quote = {
  instrumentId: "0.300750",
  symbol: "300750",
  name: "宁德时代",
  price: 380
};

const buyOrder = {
  instrumentId: "0.300750",
  symbol: "300750",
  side: "BUY",
  orderType: "MARKET",
  quantity: 100,
  limitPrice: null,
  source: "AGENT"
};

test("normalizes risk controls with auto execution disabled by default", () => {
  assert.deepEqual(normalizeRiskControls({}), DEFAULT_RISK_CONTROLS);
  assert.equal(DEFAULT_RISK_CONTROLS.autoExecutionEnabled, false);
});

test("rejects all orders while kill switch is enabled", () => {
  const result = evaluateRiskControls({
    account,
    order: buyOrder,
    quote,
    controls: { ...DEFAULT_RISK_CONTROLS, killSwitchEnabled: true }
  });

  assert.equal(result.allowed, false);
  assert.match(result.reason, /kill switch/i);
});

test("rejects orders above the single order amount limit", () => {
  const result = evaluateRiskControls({
    account,
    order: buyOrder,
    quote,
    controls: { ...DEFAULT_RISK_CONTROLS, autoExecutionEnabled: true, maxOrderAmount: 10000 }
  });

  assert.equal(result.allowed, false);
  assert.match(result.reason, /single order amount/i);
});

test("rejects blacklisted instruments", () => {
  const result = evaluateRiskControls({
    account,
    order: buyOrder,
    quote,
    controls: { ...DEFAULT_RISK_CONTROLS, autoExecutionEnabled: true, blacklist: ["0.300750"] }
  });

  assert.equal(result.allowed, false);
  assert.match(result.reason, /blacklist/i);
});

test("rejects agent execution when auto execution is disabled", () => {
  const result = evaluateRiskControls({
    account,
    order: buyOrder,
    quote,
    controls: DEFAULT_RISK_CONTROLS
  });

  assert.equal(result.allowed, false);
  assert.match(result.reason, /auto execution/i);
});

test("allows confirmed agent paper orders when controls pass", () => {
  const result = evaluateRiskControls({
    account,
    order: { ...buyOrder, confirm: true },
    quote,
    controls: { ...DEFAULT_RISK_CONTROLS, autoExecutionEnabled: true, maxOrderAmount: 100000 }
  });

  assert.equal(result.allowed, true);
});
