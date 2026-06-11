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
  ["sh000001", { symbol: "000001", name: "上证指数", price: 3096.58, sector: "指数" }],
  ["sz399001", { symbol: "399001", name: "深证成指", price: 9362.12, sector: "指数" }],
  ["sz399006", { symbol: "399006", name: "创业板指", price: 1818.75, sector: "指数" }],
  ["000001", { symbol: "000001", name: "平安银行", price: 10.12, sector: "银行" }],
  ["300750", { symbol: "300750", name: "宁德时代", price: 260.3, sector: "电池" }],
  ["600519", { symbol: "600519", name: "贵州茅台", price: 1518.8, sector: "白酒" }]
]);

export function normalizeSymbol(input) {
  const raw = String(input || "").trim().toLowerCase();
  const compact = raw.replace(/\s+/g, "");

  if (/^sh\d{6}$/.test(compact)) {
    return { input, symbol: compact.slice(2), secid: `1.${compact.slice(2)}`, market: "SH" };
  }

  if (/^sz\d{6}$/.test(compact)) {
    return { input, symbol: compact.slice(2), secid: `0.${compact.slice(2)}`, market: "SZ" };
  }

  if (!/^\d{6}$/.test(compact)) {
    throw new Error(`Unsupported symbol: ${input}`);
  }

  if (compact.startsWith("6") || compact.startsWith("9")) {
    return { input, symbol: compact, secid: `1.${compact}`, market: "SH" };
  }

  return { input, symbol: compact, secid: `0.${compact}`, market: "SZ" };
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
    .map((row) => ({
      symbol: String(row.f12),
      name: String(row.f14 || row.f12),
      price: toNumber(row.f2),
      pctChange: toNumber(row.f3),
      change: toNumber(row.f4),
      volume: toNumber(row.f5),
      amount: toNumber(row.f6),
      speed: toNumber(row.f10),
      sector: String(row.f100 || "")
    }))
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
  const returned = new Set(quotes.map((quote) => quote.symbol));
  const missing = symbols.filter((symbol) => !returned.has(normalizeSymbol(symbol).symbol));
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
    const base = DEMO_BASE.get(key) ?? DEMO_BASE.get(normalizeSymbol(key).symbol) ?? {
      symbol: normalizeSymbol(key).symbol,
      name: normalizeSymbol(key).symbol,
      price: 20 + index * 3,
      sector: "自选"
    };
    const pctChange = round2(phase * 1.8 + (index - 2) * 0.28);
    const price = round2(base.price * (1 + pctChange / 100));

    return {
      symbol: base.symbol,
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

function toNumber(value) {
  if (value === "-" || value === null || value === undefined || value === "") {
    return Number.NaN;
  }
  return Number(value);
}

function round2(value) {
  return Math.round(value * 100) / 100;
}
