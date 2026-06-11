import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const DEFAULT_STATE = {
  watchlist: ["sh000001", "sz399001", "sz399006", "000001", "300750", "600519"],
  rules: [
    {
      id: "demo-pct-300750",
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
      return sanitizeState(JSON.parse(text));
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
  return {
    watchlist: [...new Set((state.watchlist || DEFAULT_STATE.watchlist).map((symbol) => String(symbol).trim()).filter(Boolean))],
    rules: (state.rules || []).map((rule) => ({
      id: String(rule.id || crypto.randomUUID()),
      symbol: String(rule.symbol || "").trim(),
      type: String(rule.type || "price-above"),
      threshold: Number(rule.threshold),
      enabled: rule.enabled !== false
    }))
  };
}
