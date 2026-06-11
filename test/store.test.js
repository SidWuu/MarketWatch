import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { JsonStore } from "../src/server/store.js";

test("creates default state on first load", async () => {
  const dir = await mkdtemp(join(tmpdir(), "market-watch-store-"));
  try {
    const file = join(dir, "state.json");
    const store = new JsonStore(file);
    const state = await store.load();
    const saved = JSON.parse(await readFile(file, "utf8"));

    assert.ok(state.watchlist.includes("sh000001"));
    assert.deepEqual(saved.watchlist, state.watchlist);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("deduplicates watchlist entries by instrument id while preserving index and stock collisions", async () => {
  const dir = await mkdtemp(join(tmpdir(), "market-watch-store-"));
  try {
    const store = new JsonStore(join(dir, "state.json"));
    const state = await store.save({
      watchlist: ["sh000001", "SH000001", "000001"],
      rules: []
    });

    assert.deepEqual(state.watchlist, ["sh000001", "000001"]);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("throws a clear error for damaged state json", async () => {
  const dir = await mkdtemp(join(tmpdir(), "market-watch-store-"));
  try {
    const file = join(dir, "state.json");
    await writeFile(file, "{bad json", "utf8");
    const store = new JsonStore(file);

    await assert.rejects(() => store.load(), /State file is not valid JSON/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
