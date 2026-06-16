import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createMarketWatchServer } from "../src/server/index.js";
import { JsonStore } from "../src/server/store.js";

const quote = {
  instrumentId: "0.300750",
  symbol: "300750",
  market: "SZ",
  name: "宁德时代",
  price: 380,
  pctChange: 3.1,
  change: 11.4,
  volume: 100000,
  amount: 38000000,
  speed: 1.2,
  sector: "电池",
  source: "test",
  updatedAt: "2026-06-16T10:00:00.000Z"
};

test("streams quote refresh events over SSE", async () => {
  const dir = await mkdtemp(join(tmpdir(), "market-watch-server-"));
  const app = await createMarketWatchServer({
    store: new JsonStore(join(dir, "state.json")),
    fetchQuotesImpl: async () => [quote],
    refreshMs: 30
  });

  await app.listen(0);

  try {
    const address = app.server.address();
    const response = await fetch(`http://127.0.0.1:${address.port}/api/events`);
    assert.equal(response.status, 200);

    const event = await readSseEvent(response, "quotes");
    assert.equal(event.event, "quotes");
    assert.equal(event.data.quotes[0].instrumentId, "0.300750");
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});

test("exports trading audit log as ndjson", async () => {
  const dir = await mkdtemp(join(tmpdir(), "market-watch-server-"));
  const app = await createMarketWatchServer({
    store: new JsonStore(join(dir, "state.json")),
    fetchQuotesImpl: async () => [quote],
    refreshMs: 1000
  });

  await app.listen(0);

  try {
    const address = app.server.address();
    const baseUrl = `http://127.0.0.1:${address.port}`;
    await fetch(`${baseUrl}/api/trading/risk-controls`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ maxOrderAmount: 10000 })
    });

    const response = await fetch(`${baseUrl}/api/trading/audit-log.ndjson`);
    const text = await response.text();
    const rows = text.trim().split("\n").map((line) => JSON.parse(line));

    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "application/x-ndjson; charset=utf-8");
    assert.match(response.headers.get("content-disposition"), /audit-log\.ndjson/);
    assert.equal(rows[0].actor, "UI");
    assert.equal(rows[0].action, "RISK_CONTROLS_UPDATE");
  } finally {
    await app.close();
    await rm(dir, { recursive: true, force: true });
  }
});

async function readSseEvent(response, targetEvent) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  for (;;) {
    const { value } = await reader.read();
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split("\n\n");
    buffer = frames.pop() || "";

    for (const frame of frames) {
      const event = parseSseFrame(frame);
      if (event.event === targetEvent) {
        reader.cancel();
        return event;
      }
    }
  }
}

function parseSseFrame(frame) {
  const lines = frame.split("\n");
  const event = lines.find((line) => line.startsWith("event: "))?.slice("event: ".length);
  const data = lines.find((line) => line.startsWith("data: "))?.slice("data: ".length);
  return { event, data: data ? JSON.parse(data) : null };
}
