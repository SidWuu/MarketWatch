import assert from "node:assert/strict";
import test from "node:test";

import { buildEastmoneyUrl, normalizeSymbol, parseEastmoneyQuoteList } from "../src/server/market-data.js";

test("normalizes common A-share and index symbols to Eastmoney secids", () => {
  assert.equal(normalizeSymbol("000001").secid, "0.000001");
  assert.equal(normalizeSymbol("600519").secid, "1.600519");
  assert.equal(normalizeSymbol("sh000001").secid, "1.000001");
  assert.equal(normalizeSymbol("sz399001").secid, "0.399001");
});

test("builds an Eastmoney quote URL for a watchlist", () => {
  const url = buildEastmoneyUrl(["sh000001", "000001"]);

  assert.equal(url.hostname, "push2.eastmoney.com");
  assert.equal(url.searchParams.get("secids"), "1.000001,0.000001");
  assert.match(url.searchParams.get("fields"), /f12/);
});

test("parses Eastmoney quote rows and filters unavailable prices", () => {
  const payload = {
    data: {
      diff: [
        { f12: "000001", f14: "平安银行", f2: 10.12, f3: 1.2, f4: 0.12, f5: 123456, f6: 456789000, f10: 1.1, f100: "银行" },
        { f12: "000002", f14: "坏数据", f2: "-", f3: "-", f4: "-", f5: "-", f6: "-", f10: "-", f100: "地产" }
      ]
    }
  };

  const quotes = parseEastmoneyQuoteList(payload);

  assert.equal(quotes.length, 1);
  assert.deepEqual(quotes[0], {
    symbol: "000001",
    name: "平安银行",
    price: 10.12,
    pctChange: 1.2,
    change: 0.12,
    volume: 123456,
    amount: 456789000,
    speed: 1.1,
    sector: "银行"
  });
});
