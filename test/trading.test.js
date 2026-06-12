import assert from "node:assert/strict";
import test from "node:test";

import {
  cancelPaperOrder,
  DEFAULT_PAPER_ACCOUNT,
  executePaperOrder,
  normalizeOrderInput
} from "../src/server/trading.js";

const quote = {
  instrumentId: "0.300750",
  symbol: "300750",
  name: "宁德时代",
  price: 380
};

test("normalizes a market buy order for paper trading", () => {
  assert.deepEqual(
    normalizeOrderInput({
      instrumentId: "0.300750",
      side: "buy",
      orderType: "market",
      quantity: "100",
      source: "agent"
    }),
    {
      instrumentId: "0.300750",
      symbol: "300750",
      side: "BUY",
      orderType: "MARKET",
      quantity: 100,
      limitPrice: null,
      source: "AGENT"
    }
  );
});

test("fills a paper market buy and updates cash and position average cost", () => {
  const result = executePaperOrder(DEFAULT_PAPER_ACCOUNT, {
    instrumentId: "0.300750",
    symbol: "300750",
    side: "BUY",
    orderType: "MARKET",
    quantity: 100,
    limitPrice: null,
    source: "UI"
  }, quote);

  assert.equal(result.order.status, "FILLED");
  assert.equal(result.account.cash, 962000);
  assert.deepEqual(result.account.positions["0.300750"], {
    instrumentId: "0.300750",
    symbol: "300750",
    name: "宁德时代",
    quantity: 100,
    avgCost: 380
  });
});

test("rejects a paper buy when cash is insufficient", () => {
  const account = { ...DEFAULT_PAPER_ACCOUNT, cash: 1000 };
  const result = executePaperOrder(account, {
    instrumentId: "0.300750",
    symbol: "300750",
    side: "BUY",
    orderType: "MARKET",
    quantity: 100,
    limitPrice: null,
    source: "UI"
  }, quote);

  assert.equal(result.order.status, "REJECTED");
  assert.match(result.order.rejectReason, /Insufficient cash/);
  assert.equal(result.account.cash, 1000);
});

test("fills a paper sell and realizes cash", () => {
  const account = {
    ...DEFAULT_PAPER_ACCOUNT,
    cash: 1000,
    positions: {
      "0.300750": {
        instrumentId: "0.300750",
        symbol: "300750",
        name: "宁德时代",
        quantity: 100,
        avgCost: 360
      }
    }
  };

  const result = executePaperOrder(account, {
    instrumentId: "0.300750",
    symbol: "300750",
    side: "SELL",
    orderType: "MARKET",
    quantity: 40,
    limitPrice: null,
    source: "UI"
  }, quote);

  assert.equal(result.order.status, "FILLED");
  assert.equal(result.account.cash, 16200);
  assert.equal(result.account.positions["0.300750"].quantity, 60);
});

test("keeps non-marketable limit orders open", () => {
  const result = executePaperOrder(DEFAULT_PAPER_ACCOUNT, {
    instrumentId: "0.300750",
    symbol: "300750",
    side: "BUY",
    orderType: "LIMIT",
    quantity: 100,
    limitPrice: 370,
    source: "UI"
  }, quote);

  assert.equal(result.order.status, "OPEN");
  assert.equal(result.account.cash, DEFAULT_PAPER_ACCOUNT.cash);
});

test("stores open limit orders so they can be cancelled later", () => {
  const result = executePaperOrder(DEFAULT_PAPER_ACCOUNT, {
    instrumentId: "0.300750",
    symbol: "300750",
    side: "BUY",
    orderType: "LIMIT",
    quantity: 100,
    limitPrice: 370,
    source: "UI"
  }, quote);

  assert.equal(result.account.orders.length, 1);
  assert.equal(result.account.orders[0].status, "OPEN");
});

test("cancels an open paper order without changing cash or positions", () => {
  const opened = executePaperOrder(DEFAULT_PAPER_ACCOUNT, {
    instrumentId: "0.300750",
    symbol: "300750",
    side: "BUY",
    orderType: "LIMIT",
    quantity: 100,
    limitPrice: 370,
    source: "UI"
  }, quote);

  const cancelled = cancelPaperOrder(opened.account, opened.order.id, "USER_REQUEST");

  assert.equal(cancelled.order.status, "CANCELLED");
  assert.equal(cancelled.order.cancelReason, "USER_REQUEST");
  assert.equal(cancelled.account.cash, DEFAULT_PAPER_ACCOUNT.cash);
  assert.deepEqual(cancelled.account.positions, {});
});

test("rejects cancelling a filled order", () => {
  const filled = executePaperOrder(DEFAULT_PAPER_ACCOUNT, {
    instrumentId: "0.300750",
    symbol: "300750",
    side: "BUY",
    orderType: "MARKET",
    quantity: 100,
    limitPrice: null,
    source: "UI"
  }, quote);

  assert.throws(() => cancelPaperOrder(filled.account, filled.order.id), /Only OPEN orders can be cancelled/);
});
