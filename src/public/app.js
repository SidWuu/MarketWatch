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
  ruleForm: document.querySelector("#ruleForm"),
  ruleSymbol: document.querySelector("#ruleSymbol"),
  ruleType: document.querySelector("#ruleType"),
  ruleThreshold: document.querySelector("#ruleThreshold"),
  ruleList: document.querySelector("#ruleList"),
  eventList: document.querySelector("#eventList"),
  refreshButton: document.querySelector("#refreshButton"),
  notifyButton: document.querySelector("#notifyButton"),
  clearEvents: document.querySelector("#clearEvents")
};

await loadState();
connectEvents();

els.refreshButton.addEventListener("click", loadQuotes);
els.notifyButton.addEventListener("click", requestNotifications);
els.clearEvents.addEventListener("click", () => {
  state.events = [];
  renderEvents();
});

els.watchForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const symbol = els.watchSymbol.value.trim();
  if (!symbol) return;
  await api("/api/watchlist", { method: "POST", body: { symbol } });
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
  renderRuleOptions();
  renderRules();
  renderEvents();
}

function renderQuotes() {
  const warning = state.quotes.find((quote) => quote.warning)?.warning;
  const source = state.quotes[0]?.source || "loading";
  const updatedAt = state.quotes[0]?.updatedAt ? new Date(state.quotes[0].updatedAt).toLocaleTimeString() : "";
  els.sourceLine.textContent = warning || `${source} · ${updatedAt}`;

  els.quoteRows.innerHTML = state.quotes
    .map((quote) => {
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
            <button class="remove-button" data-remove-watch="${quote.symbol}" title="移除">-</button>
          </td>
        </tr>
      `;
    })
    .join("");

  document.querySelectorAll("[data-remove-watch]").forEach((button) => {
    button.addEventListener("click", async () => {
      await api(`/api/watchlist/${encodeURIComponent(button.dataset.removeWatch)}`, { method: "DELETE" });
      await loadState();
    });
  });
}

function renderRuleOptions() {
  els.ruleSymbol.innerHTML = state.quotes
    .map((quote) => `<option value="${quote.symbol}">${quote.name} ${quote.symbol}</option>`)
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

  const quoteNames = new Map(state.quotes.map((quote) => [quote.symbol, quote.name]));
  els.ruleList.innerHTML = state.rules
    .map((rule) => {
      const type = state.ruleTypes.find((item) => item.value === rule.type);
      return `
        <div class="rule-item">
          <div>
            <strong>${escapeHtml(quoteNames.get(rule.symbol) || rule.symbol)}</strong>
            <div class="meta">${escapeHtml(type?.label || rule.type)} · ${rule.threshold}</div>
          </div>
          <button data-remove-rule="${rule.id}" title="删除规则">-</button>
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

function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
