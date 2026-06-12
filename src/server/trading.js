import { normalizeSymbol } from "./market-data.js";

export const DEFAULT_PAPER_ACCOUNT = Object.freeze({
  mode: "PAPER",
  currency: "CNY",
  cash: 1000000,
  positions: {},
  orders: [],
  orderDrafts: []
});

const SIDES = new Set(["BUY", "SELL"]);
const ORDER_TYPES = new Set(["MARKET", "LIMIT"]);
const SOURCES = new Set(["UI", "AGENT", "SYSTEM"]);

export function normalizeOrderInput(input) {
  const identity = normalizeSymbol(input.instrumentId || input.symbol);
  const side = String(input.side || "").toUpperCase();
  const orderType = String(input.orderType || "").toUpperCase();
  const quantity = Number(input.quantity);
  const source = String(input.source || "UI").toUpperCase();
  const limitPrice = input.limitPrice === null || input.limitPrice === undefined || input.limitPrice === ""
    ? null
    : Number(input.limitPrice);

  if (!SIDES.has(side)) {
    throw new Error(`Unsupported order side: ${input.side}`);
  }
  if (!ORDER_TYPES.has(orderType)) {
    throw new Error(`Unsupported order type: ${input.orderType}`);
  }
  if (!Number.isInteger(quantity) || quantity <= 0) {
    throw new Error("quantity must be a positive integer");
  }
  if (orderType === "LIMIT" && (!Number.isFinite(limitPrice) || limitPrice <= 0)) {
    throw new Error("limitPrice must be a positive number for limit orders");
  }
  if (!SOURCES.has(source)) {
    throw new Error(`Unsupported order source: ${input.source}`);
  }

  return {
    instrumentId: identity.instrumentId,
    symbol: identity.symbol,
    side,
    orderType,
    quantity,
    limitPrice,
    source
  };
}

export function createOrderDraft(input, quote) {
  const order = normalizeOrderInput(input);
  return {
    id: crypto.randomUUID(),
    ...order,
    name: quote?.name || order.symbol,
    referencePrice: quote?.price ?? null,
    status: "REQUIRES_CONFIRMATION",
    createdAt: new Date().toISOString()
  };
}

export function executePaperOrder(account, input, quote) {
  if (!quote || quote.instrumentId !== input.instrumentId || !Number.isFinite(quote.price)) {
    return rejected(account, input, "Quote is unavailable for this instrument");
  }

  const price = chooseExecutionPrice(input, quote);
  if (price === null) {
    const order = buildOrder(input, quote, {
      status: "OPEN",
      filledQuantity: 0,
      avgFillPrice: null
    });
    const next = cloneAccount(account);
    next.orders = [order, ...(next.orders || [])];
    return {
      account: next,
      order
    };
  }

  if (input.side === "BUY") {
    return executeBuy(account, input, quote, price);
  }

  return executeSell(account, input, quote, price);
}

export function summarizeAccount(account, quotes = []) {
  const quotesById = new Map(quotes.map((quote) => [quote.instrumentId, quote]));
  const positions = Object.values(account.positions || {}).map((position) => {
    const quote = quotesById.get(position.instrumentId);
    const marketPrice = quote?.price ?? position.avgCost;
    const marketValue = roundMoney(marketPrice * position.quantity);
    const cost = roundMoney(position.avgCost * position.quantity);
    return {
      ...position,
      marketPrice,
      marketValue,
      unrealizedPnl: roundMoney(marketValue - cost)
    };
  });

  return {
    mode: account.mode || "PAPER",
    currency: account.currency || "CNY",
    cash: roundMoney(account.cash ?? DEFAULT_PAPER_ACCOUNT.cash),
    positions,
    orders: account.orders || [],
    orderDrafts: account.orderDrafts || [],
    totalMarketValue: roundMoney(positions.reduce((sum, position) => sum + position.marketValue, 0)),
    totalEquity: roundMoney((account.cash ?? DEFAULT_PAPER_ACCOUNT.cash) + positions.reduce((sum, position) => sum + position.marketValue, 0))
  };
}

function executeBuy(account, input, quote, price) {
  const cost = roundMoney(price * input.quantity);
  if ((account.cash ?? 0) < cost) {
    return rejected(account, input, `Insufficient cash: need ${cost}, available ${account.cash ?? 0}`);
  }

  const next = cloneAccount(account);
  const current = next.positions[input.instrumentId];
  const currentQty = current?.quantity ?? 0;
  const currentCost = (current?.avgCost ?? 0) * currentQty;
  const quantity = currentQty + input.quantity;

  next.cash = roundMoney(next.cash - cost);
  next.positions[input.instrumentId] = {
    instrumentId: input.instrumentId,
    symbol: input.symbol,
    name: quote.name || input.symbol,
    quantity,
    avgCost: roundMoney((currentCost + cost) / quantity)
  };

  const order = buildOrder(input, quote, {
    status: "FILLED",
    filledQuantity: input.quantity,
    avgFillPrice: price
  });
  next.orders = [order, ...(next.orders || [])];
  return { account: next, order };
}

function executeSell(account, input, quote, price) {
  const current = account.positions?.[input.instrumentId];
  if (!current || current.quantity < input.quantity) {
    return rejected(account, input, `Insufficient position: need ${input.quantity}, available ${current?.quantity ?? 0}`);
  }

  const next = cloneAccount(account);
  const proceeds = roundMoney(price * input.quantity);
  const remainingQuantity = current.quantity - input.quantity;
  next.cash = roundMoney(next.cash + proceeds);

  if (remainingQuantity === 0) {
    delete next.positions[input.instrumentId];
  } else {
    next.positions[input.instrumentId] = {
      ...current,
      quantity: remainingQuantity
    };
  }

  const order = buildOrder(input, quote, {
    status: "FILLED",
    filledQuantity: input.quantity,
    avgFillPrice: price
  });
  next.orders = [order, ...(next.orders || [])];
  return { account: next, order };
}

function rejected(account, input, rejectReason) {
  const order = {
    id: crypto.randomUUID(),
    ...input,
    status: "REJECTED",
    filledQuantity: 0,
    avgFillPrice: null,
    rejectReason,
    createdAt: new Date().toISOString()
  };
  const next = cloneAccount(account);
  next.orders = [order, ...(next.orders || [])];
  return { account: next, order };
}

function buildOrder(input, quote, execution) {
  return {
    id: crypto.randomUUID(),
    ...input,
    name: quote.name || input.symbol,
    submittedPrice: quote.price,
    ...execution,
    createdAt: new Date().toISOString()
  };
}

function chooseExecutionPrice(input, quote) {
  if (input.orderType === "MARKET") {
    return quote.price;
  }
  if (input.side === "BUY" && quote.price <= input.limitPrice) {
    return quote.price;
  }
  if (input.side === "SELL" && quote.price >= input.limitPrice) {
    return quote.price;
  }
  return null;
}

export function cloneAccount(account = DEFAULT_PAPER_ACCOUNT) {
  return {
    mode: account.mode || "PAPER",
    currency: account.currency || "CNY",
    cash: account.cash ?? DEFAULT_PAPER_ACCOUNT.cash,
    positions: structuredClone(account.positions || {}),
    orders: structuredClone(account.orders || []),
    orderDrafts: structuredClone(account.orderDrafts || [])
  };
}

export function cancelPaperOrder(account, orderId, reason = "USER_REQUEST") {
  const next = cloneAccount(account);
  const index = next.orders.findIndex((order) => order.id === orderId);
  if (index === -1) {
    throw new Error(`Order not found: ${orderId}`);
  }

  const order = next.orders[index];
  if (order.status !== "OPEN") {
    throw new Error("Only OPEN orders can be cancelled");
  }

  const cancelled = {
    ...order,
    status: "CANCELLED",
    cancelReason: String(reason || "USER_REQUEST"),
    cancelledAt: new Date().toISOString()
  };
  next.orders[index] = cancelled;
  return { account: next, order: cancelled };
}

function roundMoney(value) {
  return Math.round(value * 100) / 100;
}
