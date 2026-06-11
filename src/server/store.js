import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { normalizeSymbol } from "./market-data.js";

const DEFAULT_STATE = {
  watchlist: ["sh000001", "sz399001", "sz399006", "000001", "300750", "600519"],
  rules: [
    {
      id: "demo-pct-300750",
      instrumentId: "0.300750",
      symbol: "300750",
      type: "pct-change-above",
      threshold: 2.5,
      enabled: true
    }
  ]
};

export class JsonStore {
  constructor(filePath = join(process.cwd(), "data", "state.json")) {
    this.filePath = filePath;
  }

  async load() {
    try {
      const text = await readFile(this.filePath, "utf8");
      try {
        return sanitizeState(JSON.parse(text));
      } catch (error) {
        throw new Error(`State file is not valid JSON: ${error.message}`);
      }
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }
      await this.save(DEFAULT_STATE);
      return structuredClone(DEFAULT_STATE);
    }
  }

  async save(state) {
    const sanitized = sanitizeState(state);
    await mkdir(dirname(this.filePath), { recursive: true });
    await writeFile(this.filePath, `${JSON.stringify(sanitized, null, 2)}\n`, "utf8");
    return sanitized;
  }
}

function sanitizeState(state) {
  const watchlist = dedupeWatchlist(state.watchlist || DEFAULT_STATE.watchlist);
  return {
    watchlist,
    rules: (state.rules || []).map((rule) => ({
      id: String(rule.id || crypto.randomUUID()),
      instrumentId: normalizeRuleInstrumentId(rule),
      symbol: normalizeRuleSymbol(rule),
      type: String(rule.type || "price-above"),
      threshold: Number(rule.threshold),
      enabled: rule.enabled !== false
    }))
  };
}

function dedupeWatchlist(watchlist) {
  const byId = new Map();
  for (const raw of watchlist) {
    const text = String(raw).trim();
    if (!text) continue;
    const normalized = normalizeSymbol(text);
    if (!byId.has(normalized.instrumentId)) {
      byId.set(normalized.instrumentId, text.toLowerCase());
    }
  }
  return [...byId.values()];
}

function normalizeRuleInstrumentId(rule) {
  if (rule.instrumentId) {
    return String(rule.instrumentId);
  }
  return normalizeSymbol(rule.symbol).instrumentId;
}

function normalizeRuleSymbol(rule) {
  if (rule.symbol) {
    return normalizeSymbol(rule.symbol).symbol;
  }
  const instrumentId = String(rule.instrumentId || "");
  return instrumentId.includes(".") ? instrumentId.split(".")[1] : instrumentId;
}
