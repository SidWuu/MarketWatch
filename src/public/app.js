const state = {
  quotes: [],
  rules: [],
  watchlist: [],
  ruleTypes: [],
  events: []
};

const els = {
  sourceLine: document.querySelector("#sourceLine"),
  quoteRows: document.querySelector("#quoteRows"),
  watchForm: document.querySelector("#watchForm"),
  watchSymbol: document.querySelector("#watchSymbol"),
  watchGroup: document.querySelector("#watchGroup"),
  ruleForm: document.querySelector("#ruleForm"),
  ruleSymbol: document.querySelector("#ruleSymbol"),
  ruleType: document.querySelector("#ruleType"),
  ruleThreshold: document.querySelector("#ruleThreshold"),
  ruleList: document.querySelector("#ruleList"),
  agentBriefing: document.querySelector("#agentBriefing"),
  agentBriefingButton: document.querySelector("#agentBriefingButton"),
  eventList: document.querySelector("#eventList"),
  paperCash: document.querySelector("#paperCash"),
  paperEquity: document.querySelector("#paperEquity"),
  paperMarketValue: document.querySelector("#paperMarketValue"),
  positionList: document.querySelector("#positionList"),
  autoExecutionToggle: document.querySelector("#autoExecutionToggle"),
  killSwitchButton: document.querySelector("#killSwitchButton"),
  refreshButton: document.querySelector("#refreshButton"),
  notifyButton: document.querySelector("#notifyButton"),
  clearEvents: document.querySelector("#clearEvents")
};

await loadState();
connectEvents();

els.refreshButton.addEventListener("click", loadQuotes);
els.notifyButton.addEventListener("click", requestNotifications);
els.autoExecutionToggle.addEventListener("change", updateAutoExecution);
els.killSwitchButton.addEventListener("click", toggleKillSwitch);
els.agentBriefingButton.addEventListener("click", loadAgentBriefing);
els.clearEvents.addEventListener("click", () => {
  state.events = [];
  renderEvents();
});

els.watchForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const symbol = els.watchSymbol.value.trim();
  if (!symbol) return;
  await api("/api/watchlist", { method: "POST", body: { symbol, groupId: els.watchGroup.value } });
  els.watchSymbol.value = "";
  await loadState();
});

els.ruleForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  await api("/api/rules", {
    method: "POST",
    body: {
      symbol: els.ruleSymbol.value,
      type: els.ruleType.value,
      threshold: els.ruleThreshold.value
    }
  });
  els.ruleThreshold.value = "";
  await loadState();
});

async function loadState() {
  const data = await api("/api/state");
  Object.assign(state, data);
  renderAll();
}

async function loadQuotes() {
  const data = await api("/api/quotes");
  state.quotes = data.quotes;
  renderQuotes();
}

function connectEvents() {
  const stream = new EventSource("/api/events");
  stream.addEventListener("quotes", (event) => {
    state.quotes = JSON.parse(event.data).quotes;
    renderQuotes();
  });
  stream.addEventListener("alert", (event) => {
    const alert = JSON.parse(event.data);
    state.events.unshift(alert);
    state.events = state.events.slice(0, 60);
    renderEvents();
    notify(alert);
  });
}

function renderAll() {
  renderQuotes();
  renderWatchGroups();
  renderRuleOptions();
  renderRules();
  renderAccount();
  renderEvents();
}

function renderQuotes() {
  const warning = state.quotes.find((quote) => quote.warning)?.warning;
  const source = state.quotes[0]?.source || "loading";
  const quality = summarizeQuality(state.quotes);
  const updatedAt = state.quotes[0]?.updatedAt ? new Date(state.quotes[0].updatedAt).toLocaleTimeString() : "";
  els.sourceLine.textContent = warning || `${source} · ${quality} · ${updatedAt}`;

  const quoteById = new Map(state.quotes.map((quote) => [quote.instrumentId, quote]));
  const groupedIds = new Set();
  const rows = [];

  for (const group of state.watchGroups || []) {
    const quotes = group.symbols
      .map((symbol) => {
        const id = normalizeInstrumentId(symbol);
        return quoteById.get(id);
      })
      .filter(Boolean);
    if (quotes.length === 0) continue;
    rows.push(`<tr class="group-row"><td colspan="6">${escapeHtml(group.name)}</td></tr>`);
    for (const quote of quotes) {
      groupedIds.add(quote.instrumentId);
      rows.push(renderQuoteRow(quote));
    }
  }

  const ungrouped = state.quotes.filter((quote) => !groupedIds.has(quote.instrumentId));
  if (ungrouped.length > 0) {
    rows.push(`<tr class="group-row"><td colspan="6">未分组</td></tr>`);
    for (const quote of ungrouped) {
      rows.push(renderQuoteRow(quote));
    }
  }

  els.quoteRows.innerHTML = rows.join("");

  document.querySelectorAll("[data-remove-watch]").forEach((button) => {
    button.addEventListener("click", async () => {
      await api(`/api/watchlist/${encodeURIComponent(button.dataset.removeWatch)}`, { method: "DELETE" });
      await loadState();
    });
  });
}

function renderQuoteRow(quote) {
      const tone = quote.pctChange > 0 ? "up" : quote.pctChange < 0 ? "down" : "flat";
      return `
        <tr>
          <td>
            <div class="name">
              <strong>${escapeHtml(quote.name)}</strong>
              <span>${quote.symbol} · ${escapeHtml(quote.sector || "")}</span>
            </div>
          </td>
          <td>${quote.price}</td>
          <td class="${tone}">${formatPct(quote.pctChange)}</td>
          <td class="${quote.speed > 0 ? "up" : quote.speed < 0 ? "down" : "flat"}">${formatPct(quote.speed)}</td>
          <td>${formatAmount(quote.amount)}</td>
          <td>
            <button class="remove-button" data-remove-watch="${quote.instrumentId}" title="移除">-</button>
          </td>
        </tr>
      `;
}

function renderWatchGroups() {
  els.watchGroup.innerHTML = (state.watchGroups || [])
    .map((group) => `<option value="${group.id}">${escapeHtml(group.name)}</option>`)
    .join("");
}

function renderAccount() {
  const trading = state.trading || {};
  const account = trading.paperAccount || {};
  const risk = trading.riskControls || {};

  els.paperCash.textContent = formatAmount(account.cash);
  els.paperEquity.textContent = formatAmount(account.totalEquity);
  els.paperMarketValue.textContent = formatAmount(account.totalMarketValue);
  els.autoExecutionToggle.checked = risk.autoExecutionEnabled === true;
  els.killSwitchButton.classList.toggle("active", risk.killSwitchEnabled === true);
  els.killSwitchButton.title = risk.killSwitchEnabled ? "关闭紧急停止" : "开启紧急停止";

  if (!account.positions || account.positions.length === 0) {
    els.positionList.innerHTML = `<div class="empty compact">暂无持仓</div>`;
    return;
  }

  els.positionList.innerHTML = account.positions
    .map((position) => {
      const pnlTone = position.unrealizedPnl > 0 ? "up" : position.unrealizedPnl < 0 ? "down" : "flat";
      return `
        <div class="position-item">
          <div>
            <strong>${escapeHtml(position.name || position.symbol)}</strong>
            <span class="meta">${position.symbol} · ${position.quantity} 股</span>
          </div>
          <div>
            <strong>${formatAmount(position.marketValue)}</strong>
            <span class="${pnlTone}">${formatAmount(position.unrealizedPnl)}</span>
          </div>
        </div>
      `;
    })
    .join("");
}

function renderRuleOptions() {
  els.ruleSymbol.innerHTML = state.quotes
    .map((quote) => `<option value="${quote.instrumentId}">${quote.name} ${quote.symbol}</option>`)
    .join("");
  els.ruleType.innerHTML = state.ruleTypes
    .map((type) => `<option value="${type.value}">${type.label}</option>`)
    .join("");
}

function renderRules() {
  if (state.rules.length === 0) {
    els.ruleList.innerHTML = `<div class="empty">暂无提醒规则</div>`;
    return;
  }

  const quoteNames = new Map(state.quotes.map((quote) => [quote.instrumentId, quote.name]));
  els.ruleList.innerHTML = state.rules
    .map((rule) => {
      const type = state.ruleTypes.find((item) => item.value === rule.type);
      return `
        <div class="rule-item">
          <div>
            <strong>${escapeHtml(quoteNames.get(rule.instrumentId) || rule.symbol)}</strong>
            <div class="meta">${escapeHtml(type?.label || rule.type)} · ${rule.threshold}</div>
            <div class="rule-edit">
              <select data-rule-symbol="${rule.id}">
                ${state.quotes.map((quote) => `<option value="${quote.instrumentId}" ${quote.instrumentId === rule.instrumentId ? "selected" : ""}>${escapeHtml(quote.name)} ${quote.symbol}</option>`).join("")}
              </select>
              <select data-rule-type="${rule.id}">
                ${state.ruleTypes.map((item) => `<option value="${item.value}" ${item.value === rule.type ? "selected" : ""}>${escapeHtml(item.label)}</option>`).join("")}
              </select>
              <input data-rule-threshold="${rule.id}" inputmode="decimal" value="${rule.threshold}" />
              <label class="checkline"><input data-rule-enabled="${rule.id}" type="checkbox" ${rule.enabled ? "checked" : ""} />启用</label>
            </div>
          </div>
          <div class="rule-actions">
            <button data-save-rule="${rule.id}" title="保存规则">存</button>
            <button data-remove-rule="${rule.id}" title="删除规则">-</button>
          </div>
        </div>
      `;
    })
    .join("");

  document.querySelectorAll("[data-remove-rule]").forEach((button) => {
    button.addEventListener("click", async () => {
      await api(`/api/rules/${encodeURIComponent(button.dataset.removeRule)}`, { method: "DELETE" });
      await loadState();
    });
  });
  document.querySelectorAll("[data-save-rule]").forEach((button) => {
    button.addEventListener("click", async () => {
      const id = button.dataset.saveRule;
      await api(`/api/rules/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: {
          symbol: document.querySelector(`[data-rule-symbol="${id}"]`).value,
          type: document.querySelector(`[data-rule-type="${id}"]`).value,
          threshold: document.querySelector(`[data-rule-threshold="${id}"]`).value,
          enabled: document.querySelector(`[data-rule-enabled="${id}"]`).checked
        }
      });
      await loadState();
    });
  });
}

function renderEvents() {
  if (state.events.length === 0) {
    els.eventList.innerHTML = `<div class="empty">暂无异动事件</div>`;
    return;
  }

  els.eventList.innerHTML = state.events
    .map((event) => `
      <div class="event-item" data-severity="${event.severity}">
        <strong>${escapeHtml(event.message)}</strong>
        <span class="meta">${new Date(event.createdAt).toLocaleTimeString()}</span>
      </div>
    `)
    .join("");
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    method: options.method || "GET",
    headers: options.body ? { "content-type": "application/json" } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error || `Request failed: ${response.status}`);
  }
  return data;
}

async function updateAutoExecution() {
  await api("/api/trading/risk-controls", {
    method: "PATCH",
    body: { autoExecutionEnabled: els.autoExecutionToggle.checked }
  });
  await loadState();
}

async function toggleKillSwitch() {
  const enabled = !(state.trading?.riskControls?.killSwitchEnabled === true);
  await api("/api/trading/kill-switch", {
    method: "POST",
    body: { enabled }
  });
  await loadState();
}

async function loadAgentBriefing() {
  els.agentBriefing.textContent = "生成中";
  const briefing = await api("/api/agent/briefing");
  els.agentBriefing.textContent = briefing.warning
    ? `${briefing.content}\n${briefing.warning}`
    : briefing.content;
}

async function requestNotifications() {
  if (!("Notification" in window)) return;
  await Notification.requestPermission();
}

function notify(alert) {
  if (!("Notification" in window) || Notification.permission !== "granted") {
    return;
  }
  new Notification(alert.name, { body: alert.message });
}

function formatPct(value) {
  if (!Number.isFinite(value)) return "-";
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function formatAmount(value) {
  if (!Number.isFinite(value)) return "-";
  if (value >= 100000000) return `${(value / 100000000).toFixed(2)}亿`;
  if (value >= 10000) return `${(value / 10000).toFixed(2)}万`;
  return String(value);
}

function summarizeQuality(quotes) {
  if (!quotes.length) return "loading";
  const labels = {
    realtime: "实时",
    delayed: "延迟",
    demo: "演示",
    missing: "缺失",
    anomaly: "异常"
  };
  const counts = quotes.reduce((result, quote) => {
    const key = quote.quality || "unknown";
    result[key] = (result[key] || 0) + 1;
    return result;
  }, {});
  return Object.entries(counts)
    .map(([key, count]) => `${labels[key] || key}${count}`)
    .join(" / ");
}

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function normalizeInstrumentId(symbol) {
  const text = String(symbol).trim().toLowerCase();
  if (/^[01]\.\d{6}$/.test(text)) return text;
  if (/^sh\d{6}$/.test(text)) return `1.${text.slice(2)}`;
  if (/^sz\d{6}$/.test(text)) return `0.${text.slice(2)}`;
  if (/^[69]\d{5}$/.test(text)) return `1.${text}`;
  return `0.${text}`;
}
