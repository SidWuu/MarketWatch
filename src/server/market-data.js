const EASTMONEY_FIELDS = [
  "f13",
  "f12",
  "f14",
  "f2",
  "f3",
  "f4",
  "f5",
  "f6",
  "f10",
  "f100"
].join(",");

const DEMO_BASE = new Map([
  ["1.000001", { instrumentId: "1.000001", symbol: "000001", market: "SH", name: "上证指数", price: 3096.58, sector: "指数" }],
  ["0.399001", { instrumentId: "0.399001", symbol: "399001", market: "SZ", name: "深证成指", price: 9362.12, sector: "指数" }],
  ["0.399006", { instrumentId: "0.399006", symbol: "399006", market: "SZ", name: "创业板指", price: 1818.75, sector: "指数" }],
  ["0.000001", { instrumentId: "0.000001", symbol: "000001", market: "SZ", name: "平安银行", price: 10.12, sector: "银行" }],
  ["0.300750", { instrumentId: "0.300750", symbol: "300750", market: "SZ", name: "宁德时代", price: 260.3, sector: "电池" }],
  ["1.600519", { instrumentId: "1.600519", symbol: "600519", market: "SH", name: "贵州茅台", price: 1518.8, sector: "白酒" }]
]);

export function normalizeSymbol(input) {
  const raw = String(input || "").trim().toLowerCase();
  const compact = raw.replace(/\s+/g, "");

  if (/^[01]\.\d{6}$/.test(compact)) {
    const [marketCode, symbol] = compact.split(".");
    return {
      input,
      symbol,
      instrumentId: compact,
      secid: compact,
      market: marketCode === "1" ? "SH" : "SZ"
    };
  }

  if (/^sh\d{6}$/.test(compact)) {
    const symbol = compact.slice(2);
    return { input, symbol, instrumentId: `1.${symbol}`, secid: `1.${symbol}`, market: "SH" };
  }

  if (/^sz\d{6}$/.test(compact)) {
    const symbol = compact.slice(2);
    return { input, symbol, instrumentId: `0.${symbol}`, secid: `0.${symbol}`, market: "SZ" };
  }

  if (!/^\d{6}$/.test(compact)) {
    throw new Error(`Unsupported symbol: ${input}`);
  }

  if (compact.startsWith("6") || compact.startsWith("9")) {
    return { input, symbol: compact, instrumentId: `1.${compact}`, secid: `1.${compact}`, market: "SH" };
  }

  return { input, symbol: compact, instrumentId: `0.${compact}`, secid: `0.${compact}`, market: "SZ" };
}

export function buildEastmoneyUrl(symbols) {
  const url = new URL("https://push2.eastmoney.com/api/qt/ulist.np/get");
  const secids = symbols.map((symbol) => normalizeSymbol(symbol).secid);

  url.searchParams.set("fltt", "2");
  url.searchParams.set("invt", "2");
  url.searchParams.set("fields", EASTMONEY_FIELDS);
  url.searchParams.set("secids", secids.join(","));

  return url;
}

export function parseEastmoneyQuoteList(payload) {
  const rows = payload?.data?.diff;
  if (!Array.isArray(rows)) {
    return [];
  }

  return rows
    .map((row) => {
      const identity = identityFromEastmoneyRow(row);
      return {
      instrumentId: identity.instrumentId,
      symbol: identity.symbol,
      market: identity.market,
      name: String(row.f14 || row.f12),
      price: toNumber(row.f2),
      pctChange: toNumber(row.f3),
      change: toNumber(row.f4),
      volume: toNumber(row.f5),
      amount: toNumber(row.f6),
      speed: toNumber(row.f10),
      sector: String(row.f100 || "")
    };
    })
    .filter((quote) => Number.isFinite(quote.price));
}

export async function fetchQuotes(symbols, options = {}) {
  const uniqueSymbols = [...new Set(symbols.filter(Boolean))];
  if (uniqueSymbols.length === 0) {
    return [];
  }

  try {
    const url = buildEastmoneyUrl(uniqueSymbols);
    const response = await fetch(url, {
      signal: AbortSignal.timeout(options.timeoutMs ?? 4500),
      headers: {
        "user-agent": "MarketWatch/0.1"
      }
    });

    if (!response.ok) {
      throw new Error(`Eastmoney responded ${response.status}`);
    }

    const payload = await response.json();
    const quotes = parseEastmoneyQuoteList(payload);
    return mergeMissingQuotes(uniqueSymbols, enrichQuotes(quotes, "eastmoney"));
  } catch (error) {
    if (options.allowDemoFallback === false) {
      throw error;
    }

    return createDemoQuotes(uniqueSymbols, error);
  }
}

function enrichQuotes(quotes, source) {
  const now = new Date().toISOString();
  return quotes.map((quote) => ({
    ...quote,
    source,
    updatedAt: now
  }));
}

function mergeMissingQuotes(symbols, quotes) {
  const returned = new Set(quotes.map((quote) => quote.instrumentId));
  const missing = symbols.filter((symbol) => !returned.has(normalizeSymbol(symbol).instrumentId));
  if (missing.length === 0) {
    return quotes;
  }

  return [
    ...quotes,
    ...createDemoQuotes(missing, new Error("部分自选项未返回实时行情")).map((quote) => ({
      ...quote,
      warning: "部分自选项未返回实时行情，缺失行已用演示数据占位"
    }))
  ];
}

function createDemoQuotes(symbols, error) {
  const now = Date.now();
  const phase = Math.sin(now / 15000);

  return symbols.map((raw, index) => {
    const key = String(raw).trim().toLowerCase();
    const identity = normalizeSymbol(key);
    const base = DEMO_BASE.get(identity.instrumentId) ?? {
      instrumentId: identity.instrumentId,
      symbol: identity.symbol,
      market: identity.market,
      name: identity.symbol,
      price: 20 + index * 3,
      sector: "自选"
    };
    const pctChange = round2(phase * 1.8 + (index - 2) * 0.28);
    const price = round2(base.price * (1 + pctChange / 100));

    return {
      instrumentId: base.instrumentId,
      symbol: base.symbol,
      market: base.market,
      name: base.name,
      price,
      pctChange,
      change: round2(price - base.price),
      volume: Math.round(90000 + Math.abs(phase) * 60000 + index * 12000),
      amount: Math.round(price * (9000000 + index * 2100000)),
      speed: round2(Math.cos(now / 9000 + index) * 1.2),
      sector: base.sector,
      source: "demo",
      warning: `行情源不可用，已切换演示数据：${error.message}`,
      updatedAt: new Date().toISOString()
    };
  });
}

function identityFromEastmoneyRow(row) {
  const symbol = String(row.f12);
  const marketCode = Number(row.f13);
  if (marketCode === 1) {
    return { instrumentId: `1.${symbol}`, symbol, market: "SH" };
  }
  return { instrumentId: `0.${symbol}`, symbol, market: "SZ" };
}

function toNumber(value) {
  if (value === "-" || value === null || value === undefined || value === "") {
    return Number.NaN;
  }
  return Number(value);
}

function round2(value) {
  return Math.round(value * 100) / 100;
}
