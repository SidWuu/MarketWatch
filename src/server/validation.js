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

export function validateRulePatchInput(input) {
  const patch = {};

  if (input.symbol !== undefined || input.instrumentId !== undefined) {
    const identity = normalizeSymbol(input.symbol ?? input.instrumentId);
    patch.instrumentId = identity.instrumentId;
    patch.symbol = identity.symbol;
  }

  if (input.type !== undefined) {
    const supportedTypes = new Set(listRuleTypes().map((type) => type.value));
    if (!supportedTypes.has(String(input.type))) {
      throw new Error(`Unsupported rule type: ${input.type}`);
    }
    patch.type = String(input.type);
  }

  if (input.threshold !== undefined) {
    const threshold = Number(input.threshold);
    if (!Number.isFinite(threshold)) {
      throw new Error("threshold must be a number");
    }
    patch.threshold = threshold;
  }

  if (input.enabled !== undefined) {
    patch.enabled = input.enabled === true;
  }

  return patch;
}
