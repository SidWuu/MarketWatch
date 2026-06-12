export const DEFAULT_RISK_CONTROLS = Object.freeze({
  autoExecutionEnabled: false,
  killSwitchEnabled: false,
  maxOrderAmount: 50000,
  maxPositionQuantity: 100000,
  blacklist: [],
  blockNonTradingHours: false
});

export function normalizeRiskControls(input = {}) {
  return {
    autoExecutionEnabled: input.autoExecutionEnabled === true,
    killSwitchEnabled: input.killSwitchEnabled === true,
    maxOrderAmount: normalizePositiveNumber(input.maxOrderAmount, DEFAULT_RISK_CONTROLS.maxOrderAmount),
    maxPositionQuantity: normalizePositiveNumber(input.maxPositionQuantity, DEFAULT_RISK_CONTROLS.maxPositionQuantity),
    blacklist: Array.isArray(input.blacklist) ? [...new Set(input.blacklist.map(String))] : [],
    blockNonTradingHours: input.blockNonTradingHours === true
  };
}

export function evaluateRiskControls({ account, order, quote, controls = DEFAULT_RISK_CONTROLS, now = new Date() }) {
  const normalized = normalizeRiskControls(controls);

  if (normalized.killSwitchEnabled) {
    return denied("Trading blocked by kill switch");
  }

  if (order.source === "AGENT" && normalized.autoExecutionEnabled !== true) {
    return denied("Agent auto execution is disabled");
  }

  if (normalized.blacklist.includes(order.instrumentId)) {
    return denied(`Instrument is on blacklist: ${order.instrumentId}`);
  }

  if (!quote || !Number.isFinite(quote.price)) {
    return denied("Quote is unavailable for risk evaluation");
  }

  const notional = quote.price * order.quantity;
  if (notional > normalized.maxOrderAmount) {
    return denied(`Single order amount ${roundMoney(notional)} exceeds limit ${normalized.maxOrderAmount}`);
  }

  const currentQuantity = account.positions?.[order.instrumentId]?.quantity ?? 0;
  const nextQuantity = order.side === "BUY"
    ? currentQuantity + order.quantity
    : Math.max(0, currentQuantity - order.quantity);
  if (nextQuantity > normalized.maxPositionQuantity) {
    return denied(`Position quantity ${nextQuantity} exceeds limit ${normalized.maxPositionQuantity}`);
  }

  if (normalized.blockNonTradingHours && !isCnMarketTradingTime(now)) {
    return denied("Trading blocked outside CN market hours");
  }

  return { allowed: true, reason: "Risk controls passed" };
}

export function updateRiskControls(current, patch) {
  return normalizeRiskControls({
    ...current,
    ...patch
  });
}

function denied(reason) {
  return { allowed: false, reason };
}

function normalizePositiveNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function isCnMarketTradingTime(now) {
  const day = now.getDay();
  if (day === 0 || day === 6) {
    return false;
  }

  const minutes = now.getHours() * 60 + now.getMinutes();
  const morning = minutes >= 9 * 60 + 30 && minutes <= 11 * 60 + 30;
  const afternoon = minutes >= 13 * 60 && minutes <= 15 * 60;
  return morning || afternoon;
}

function roundMoney(value) {
  return Math.round(value * 100) / 100;
}
