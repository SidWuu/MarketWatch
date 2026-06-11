import { normalizeSymbol } from "./market-data.js";
import { listRuleTypes } from "./rules.js";

export function validateWatchSymbol(symbol) {
  return normalizeSymbol(symbol);
}

export function validateRuleInput(input) {
  const identity = normalizeSymbol(input.symbol);
  const supportedTypes = new Set(listRuleTypes().map((type) => type.value));
  if (!supportedTypes.has(String(input.type))) {
    throw new Error(`Unsupported rule type: ${input.type}`);
  }

  const threshold = Number(input.threshold);
  if (!Number.isFinite(threshold)) {
    throw new Error("threshold must be a number");
  }

  return {
    instrumentId: identity.instrumentId,
    symbol: identity.symbol,
    type: String(input.type),
    threshold
  };
}
