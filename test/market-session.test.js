import assert from "node:assert/strict";
import test from "node:test";

import { getCnMarketSession, getRefreshDelayMs } from "../src/server/market-session.js";

test("detects CN market morning and afternoon sessions", () => {
  assert.equal(getCnMarketSession(new Date("2026-06-16T10:00:00+08:00")).isOpen, true);
  assert.equal(getCnMarketSession(new Date("2026-06-16T14:30:00+08:00")).isOpen, true);
});

test("detects lunch break, after close, and weekends as closed", () => {
  assert.equal(getCnMarketSession(new Date("2026-06-16T12:00:00+08:00")).isOpen, false);
  assert.equal(getCnMarketSession(new Date("2026-06-16T16:00:00+08:00")).isOpen, false);
  assert.equal(getCnMarketSession(new Date("2026-06-13T10:00:00+08:00")).isOpen, false);
});

test("uses fast refresh while open and slower refresh while closed", () => {
  assert.equal(getRefreshDelayMs(new Date("2026-06-16T10:00:00+08:00")), 5000);
  assert.equal(getRefreshDelayMs(new Date("2026-06-16T16:00:00+08:00")), 60000);
});
