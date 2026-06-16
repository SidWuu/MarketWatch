import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import { pathToFileURL } from "node:url";

import { requestAgentBriefing } from "./agent-briefing.js";
import { appendAuditEvent } from "./audit-log.js";
import { listAgentToolPolicies, requireAgentPermission } from "./agent-tools.js";
import { getCnMarketSession, getRefreshDelayMs } from "./market-session.js";
import { fetchQuotes, normalizeSymbol } from "./market-data.js";
import { sendBarkAlert } from "./notifications.js";
import { evaluateRiskControls, updateRiskControls } from "./risk-controls.js";
import { evaluateRules, listRuleTypes } from "./rules.js";
import { JsonStore } from "./store.js";
import { cancelPaperOrder, createOrderDraft, executePaperOrder, normalizeOrderInput, summarizeAccount } from "./trading.js";
import { validateRuleInput, validateRulePatchInput, validateWatchSymbol } from "./validation.js";

const DEFAULT_PORT = Number(process.env.PORT || 4177);

export async function createMarketWatchServer(options = {}) {
  const publicDir = options.publicDir || join(process.cwd(), "src", "public");
  const store = options.store || new JsonStore();
  const fetchQuotesImpl = options.fetchQuotesImpl || fetchQuotes;
  const refreshMs = options.refreshMs ?? Number(process.env.REFRESH_MS || 0);
  const alertCooldownMs = options.alertCooldownMs ?? Number(process.env.ALERT_COOLDOWN_MS || 300000);

  let state = await store.load();
  let lastQuotes = [];
  let ruleState = new Map();
  let marketSession = getCnMarketSession();
  let refreshTimer = null;
  const clients = new Set();

  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, `http://${request.headers.host}`);

      if (url.pathname === "/api/quotes" && request.method === "GET") {
        return sendJson(response, { quotes: lastQuotes, source: lastQuotes[0]?.source || "loading", marketSession });
      }

      if (url.pathname === "/api/state" && request.method === "GET") {
        return sendJson(response, {
          ...state,
          ruleTypes: listRuleTypes(),
          quotes: lastQuotes,
          trading: {
            ...state.trading,
            paperAccount: summarizeAccount(state.trading.paperAccount, lastQuotes)
          },
          marketSession,
          agentToolPolicies: listAgentToolPolicies()
        });
      }

      if (url.pathname === "/api/watchlist" && request.method === "POST") {
        const body = await readJson(request);
        const identity = validateWatchSymbol(body.symbol);
        state.watchlist = upsertWatchSymbol(state.watchlist, body.symbol, identity.instrumentId);
        state.watchGroups = updateWatchGroupsForSymbol(state.watchGroups, body.groupId || "watch", body.symbol, identity.instrumentId);
        state = await store.save(state);
        await refreshQuotes();
        return sendJson(response, state);
      }

      if (url.pathname.startsWith("/api/watchlist/") && request.method === "DELETE") {
        const instrumentId = decodeURIComponent(url.pathname.slice("/api/watchlist/".length));
        state.watchlist = state.watchlist.filter((item) => normalizeSymbol(item).instrumentId !== instrumentId);
        state.watchGroups = state.watchGroups.map((group) => ({
          ...group,
          symbols: group.symbols.filter((item) => normalizeSymbol(item).instrumentId !== instrumentId)
        }));
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

      if (url.pathname.startsWith("/api/rules/") && request.method === "PATCH") {
        const id = decodeURIComponent(url.pathname.slice("/api/rules/".length));
        const body = await readJson(request);
        const patch = validateRulePatchInput(body);
        const index = state.rules.findIndex((rule) => rule.id === id);
        if (index === -1) {
          return sendJson(response, { error: `Rule not found: ${id}` }, 404);
        }
        state.rules[index] = {
          ...state.rules[index],
          ...patch
        };
        ruleState.delete(id);
        state = await store.save(state);
        return sendJson(response, state);
      }

      if (url.pathname === "/api/events" && request.method === "GET") {
        return openEventStream(request, response);
      }

      if (url.pathname === "/api/trading/audit-log.ndjson" && request.method === "GET") {
        return sendNdjson(response, state.trading.auditLog || [], "audit-log.ndjson");
      }

      if (url.pathname === "/api/trading/account" && request.method === "GET") {
        return sendJson(response, {
          account: summarizeAccount(state.trading.paperAccount, lastQuotes),
          riskControls: state.trading.riskControls,
          auditLog: state.trading.auditLog
        });
      }

      if (url.pathname === "/api/trading/risk-controls" && request.method === "GET") {
        return sendJson(response, { riskControls: state.trading.riskControls });
      }

      if (url.pathname === "/api/trading/risk-controls" && request.method === "PATCH") {
        const body = await readJson(request);
        state.trading.riskControls = updateRiskControls(state.trading.riskControls, body);
        state = appendAuditEvent(state, {
          actor: "UI",
          action: "RISK_CONTROLS_UPDATE",
          payload: body,
          result: state.trading.riskControls
        });
        state = await store.save(state);
        return sendJson(response, { riskControls: state.trading.riskControls });
      }

      if (url.pathname === "/api/trading/kill-switch" && request.method === "POST") {
        const body = await readJson(request);
        state.trading.riskControls = updateRiskControls(state.trading.riskControls, {
          killSwitchEnabled: body.enabled === true
        });
        state = appendAuditEvent(state, {
          actor: "UI",
          action: "KILL_SWITCH_SET",
          payload: { enabled: body.enabled === true },
          result: state.trading.riskControls
        });
        state = await store.save(state);
        return sendJson(response, { riskControls: state.trading.riskControls });
      }

      if (url.pathname === "/api/trading/order-drafts" && request.method === "POST") {
        requireAgentPermission("order.draft");
        const body = await readJson(request);
        const input = normalizeOrderInput({ ...body, source: body.source || "AGENT" });
        const quote = findQuote(input.instrumentId);
        const draft = createOrderDraft(input, quote);
        state.trading.paperAccount.orderDrafts = [draft, ...(state.trading.paperAccount.orderDrafts || [])];
        state = appendAuditEvent(state, {
          actor: draft.source,
          action: "ORDER_DRAFT_CREATE",
          payload: draft,
          result: { status: draft.status }
        });
        state = await store.save(state);
        return sendJson(response, { draft, account: summarizeAccount(state.trading.paperAccount, lastQuotes) }, 201);
      }

      if (url.pathname === "/api/trading/orders" && request.method === "POST") {
        const body = await readJson(request);
        const input = normalizeOrderInput(body);
        if (input.source === "AGENT" && body.confirm !== true) {
          return sendJson(response, { error: "Agent orders require explicit confirmation" }, 409);
        }

        const quote = findQuote(input.instrumentId);
        const risk = evaluateRiskControls({
          account: state.trading.paperAccount,
          order: { ...input, confirm: body.confirm === true },
          quote,
          controls: state.trading.riskControls
        });
        if (!risk.allowed) {
          const riskOrder = {
            id: crypto.randomUUID(),
            ...input,
            status: "REJECTED",
            filledQuantity: 0,
            avgFillPrice: null,
            rejectReason: risk.reason,
            createdAt: new Date().toISOString()
          };
          state.trading.paperAccount.orders = [riskOrder, ...(state.trading.paperAccount.orders || [])];
          state = appendAuditEvent(state, {
            actor: input.source,
            action: "RISK_REJECT",
            payload: input,
            result: riskOrder
          });
          state = await store.save(state);
          return sendJson(response, { order: riskOrder, account: summarizeAccount(state.trading.paperAccount, lastQuotes) }, 409);
        }

        const result = executePaperOrder(state.trading.paperAccount, input, quote);
        state.trading.paperAccount = result.account;
        state = appendAuditEvent(state, {
          actor: input.source,
          action: "PAPER_ORDER_EXECUTE",
          payload: input,
          result: result.order
        });
        state = await store.save(state);
        return sendJson(response, { order: result.order, account: summarizeAccount(state.trading.paperAccount, lastQuotes) });
      }

      if (url.pathname.startsWith("/api/trading/orders/") && request.method === "DELETE") {
        const orderId = decodeURIComponent(url.pathname.slice("/api/trading/orders/".length));
        const body = await readJson(request);
        const result = cancelPaperOrder(state.trading.paperAccount, orderId, body.reason || "USER_REQUEST");
        state.trading.paperAccount = result.account;
        state = appendAuditEvent(state, {
          actor: String(body.actor || "UI").toUpperCase(),
          action: "PAPER_ORDER_CANCEL",
          payload: { orderId, reason: body.reason || "USER_REQUEST" },
          result: result.order
        });
        state = await store.save(state);
        return sendJson(response, { order: result.order, account: summarizeAccount(state.trading.paperAccount, lastQuotes) });
      }

      if (url.pathname === "/api/agent/tools" && request.method === "GET") {
        return sendJson(response, { tools: listAgentToolPolicies() });
      }

      if (url.pathname === "/api/agent/briefing" && request.method === "GET") {
        const briefing = await requestAgentBriefing({
          quotes: lastQuotes,
          rules: state.rules,
          riskControls: state.trading.riskControls
        });
        return sendJson(response, briefing);
      }

      return serveStatic(url.pathname, response);
    } catch (error) {
      const status = isClientError(error) ? 400 : 500;
      return sendJson(response, { error: error.message }, status);
    }
  });

  async function refreshQuotes() {
    marketSession = getCnMarketSession();
    lastQuotes = await fetchQuotesImpl(state.watchlist);
    const result = evaluateRules(state.rules, lastQuotes, ruleState, { cooldownMs: alertCooldownMs });
    ruleState = result.state;

    broadcast("quotes", { quotes: lastQuotes });
    for (const alert of result.alerts) {
      broadcast("alert", alert);
      sendBarkAlert(alert).catch((error) => {
        console.error(`Bark notification failed: ${error.message}`);
      });
    }
  }

  function scheduleNextRefresh() {
    const delay = refreshMs > 0 ? refreshMs : getRefreshDelayMs();
    refreshTimer = setTimeout(async () => {
      await refreshQuotes();
      scheduleNextRefresh();
    }, delay);
    refreshTimer.unref();
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
    const filePath = join(publicDir, safePath);
    const fileStat = await stat(filePath).catch(() => null);
    if (!fileStat?.isFile()) {
      response.writeHead(404);
      response.end("Not found");
      return;
    }

    response.writeHead(200, { "content-type": contentType(filePath) });
    createReadStream(filePath).pipe(response);
  }

  function findQuote(instrumentId) {
    return lastQuotes.find((quote) => quote.instrumentId === instrumentId);
  }

  async function listen(port = DEFAULT_PORT) {
    await refreshQuotes();
    scheduleNextRefresh();
    await new Promise((resolve) => server.listen(port, resolve));
    return server;
  }

  async function close() {
    if (refreshTimer) {
      clearTimeout(refreshTimer);
    }
    for (const client of clients) {
      client.end();
    }
    await new Promise((resolve, reject) => {
      server.close((error) => {
        if (error && error.code !== "ERR_SERVER_NOT_RUNNING") {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }

  return { server, listen, close, refresh: refreshQuotes };
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

function sendNdjson(response, rows, filename) {
  response.writeHead(200, {
    "content-type": "application/x-ndjson; charset=utf-8",
    "content-disposition": `attachment; filename="${filename}"`
  });
  response.end(rows.map((row) => JSON.stringify(row)).join("\n") + (rows.length ? "\n" : ""));
}

function upsertWatchSymbol(watchlist, rawSymbol, instrumentId) {
  const next = watchlist.filter((item) => normalizeSymbol(item).instrumentId !== instrumentId);
  return [...next, String(rawSymbol).trim()];
}

function isClientError(error) {
  return /Unsupported symbol|Unsupported rule type|threshold must be a number|Unsupported order|quantity must|limitPrice must|Agent tool is denied/.test(error.message);
}

function updateWatchGroupsForSymbol(groups, groupId, rawSymbol, instrumentId) {
  const target = groups.some((group) => group.id === groupId) ? groupId : "watch";
  return groups.map((group) => {
    const withoutSymbol = group.symbols.filter((item) => normalizeSymbol(item).instrumentId !== instrumentId);
    if (group.id !== target) {
      return { ...group, symbols: withoutSymbol };
    }
    return { ...group, symbols: [...withoutSymbol, String(rawSymbol).trim()] };
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const app = await createMarketWatchServer();
  await app.listen(DEFAULT_PORT);
  console.log(`MarketWatch running at http://localhost:${DEFAULT_PORT}`);
}
