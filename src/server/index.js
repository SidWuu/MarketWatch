import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";

import { fetchQuotes, normalizeSymbol } from "./market-data.js";
import { evaluateRules, listRuleTypes } from "./rules.js";
import { JsonStore } from "./store.js";
import { validateRuleInput, validateWatchSymbol } from "./validation.js";

const PORT = Number(process.env.PORT || 4177);
const PUBLIC_DIR = join(process.cwd(), "src", "public");
const store = new JsonStore();

let state = await store.load();
let lastQuotes = [];
let ruleState = new Map();
const clients = new Set();

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);

    if (url.pathname === "/api/quotes" && request.method === "GET") {
      return sendJson(response, { quotes: lastQuotes, source: lastQuotes[0]?.source || "loading" });
    }

    if (url.pathname === "/api/state" && request.method === "GET") {
      return sendJson(response, { ...state, ruleTypes: listRuleTypes(), quotes: lastQuotes });
    }

    if (url.pathname === "/api/watchlist" && request.method === "POST") {
      const body = await readJson(request);
      const identity = validateWatchSymbol(body.symbol);
      state.watchlist = upsertWatchSymbol(state.watchlist, body.symbol, identity.instrumentId);
      state = await store.save(state);
      await refreshQuotes();
      return sendJson(response, state);
    }

    if (url.pathname.startsWith("/api/watchlist/") && request.method === "DELETE") {
      const instrumentId = decodeURIComponent(url.pathname.slice("/api/watchlist/".length));
      state.watchlist = state.watchlist.filter((item) => normalizeSymbol(item).instrumentId !== instrumentId);
      state.rules = state.rules.filter((rule) => rule.instrumentId !== instrumentId);
      state = await store.save(state);
      await refreshQuotes();
      return sendJson(response, state);
    }

    if (url.pathname === "/api/rules" && request.method === "POST") {
      const body = await readJson(request);
      const input = validateRuleInput(body);
      const rule = {
        id: crypto.randomUUID(),
        instrumentId: input.instrumentId,
        symbol: input.symbol,
        type: input.type,
        threshold: input.threshold,
        enabled: true
      };
      state.rules = [...state.rules, rule];
      state = await store.save(state);
      return sendJson(response, state);
    }

    if (url.pathname.startsWith("/api/rules/") && request.method === "DELETE") {
      const id = decodeURIComponent(url.pathname.slice("/api/rules/".length));
      state.rules = state.rules.filter((rule) => rule.id !== id);
      ruleState.delete(id);
      state = await store.save(state);
      return sendJson(response, state);
    }

    if (url.pathname === "/api/events" && request.method === "GET") {
      return openEventStream(request, response);
    }

    return serveStatic(url.pathname, response);
  } catch (error) {
    const status = isClientError(error) ? 400 : 500;
    return sendJson(response, { error: error.message }, status);
  }
});

await refreshQuotes();
setInterval(refreshQuotes, Number(process.env.REFRESH_MS || 5000)).unref();

server.listen(PORT, () => {
  console.log(`MarketWatch running at http://localhost:${PORT}`);
});

async function refreshQuotes() {
  lastQuotes = await fetchQuotes(state.watchlist);
  const result = evaluateRules(state.rules, lastQuotes, ruleState);
  ruleState = result.state;

  broadcast("quotes", { quotes: lastQuotes });
  for (const alert of result.alerts) {
    broadcast("alert", alert);
  }
}

function openEventStream(request, response) {
  response.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive"
  });
  response.write("\n");
  clients.add(response);
  request.on("close", () => clients.delete(response));
}

function broadcast(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of clients) {
    client.write(payload);
  }
}

async function serveStatic(pathname, response) {
  const safePath = normalize(pathname === "/" ? "/index.html" : pathname).replace(/^(\.\.[/\\])+/, "");
  const filePath = join(PUBLIC_DIR, safePath);
  const fileStat = await stat(filePath).catch(() => null);
  if (!fileStat?.isFile()) {
    response.writeHead(404);
    response.end("Not found");
    return;
  }

  response.writeHead(200, { "content-type": contentType(filePath) });
  createReadStream(filePath).pipe(response);
}

function contentType(filePath) {
  return {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml"
  }[extname(filePath)] || "application/octet-stream";
}

async function readJson(request) {
  const chunks = [];
  for await (const chunk of request) {
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

function sendJson(response, data, status = 200) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(data));
}

function upsertWatchSymbol(watchlist, rawSymbol, instrumentId) {
  const next = watchlist.filter((item) => normalizeSymbol(item).instrumentId !== instrumentId);
  return [...next, String(rawSymbol).trim()];
}

function isClientError(error) {
  return /Unsupported symbol|Unsupported rule type|threshold must be a number/.test(error.message);
}
