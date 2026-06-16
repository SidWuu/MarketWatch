export function getDeepSeekConfig(env = process.env) {
  return {
    enabled: Boolean(env.DEEPSEEK_API_KEY),
    apiKey: env.DEEPSEEK_API_KEY || "",
    model: env.DEEPSEEK_MODEL || "deepseek-chat",
    endpoint: env.DEEPSEEK_ENDPOINT || "https://api.deepseek.com/chat/completions"
  };
}

export async function requestAgentBriefing(context, options = {}) {
  const config = options.config || getDeepSeekConfig();
  if (!config.enabled) {
    return {
      provider: "local",
      content: createLocalMarketBriefing(context)
    };
  }

  const fetchImpl = options.fetchImpl || fetch;
  const response = await fetchImpl(config.endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${config.apiKey}`
    },
    body: JSON.stringify({
      model: config.model,
      messages: [
        {
          role: "system",
          content: "你是 MarketWatch 的只读盯盘助手。只能解释行情、规则和风险状态，不得生成实盘下单指令。"
        },
        {
          role: "user",
          content: buildBriefingPrompt(context)
        }
      ],
      temperature: 0.2
    })
  });

  if (!response.ok) {
    return {
      provider: "deepseek",
      content: createLocalMarketBriefing(context),
      warning: `DeepSeek responded ${response.status}; returned local briefing`
    };
  }

  const payload = await response.json();
  return {
    provider: "deepseek",
    content: payload.choices?.[0]?.message?.content || createLocalMarketBriefing(context)
  };
}

export function createLocalMarketBriefing({ quotes = [], rules = [] }) {
  const sorted = [...quotes].sort((a, b) => Math.abs(b.pctChange || 0) - Math.abs(a.pctChange || 0));
  const top = sorted.slice(0, 3).map((quote) => `${quote.name}(${quote.symbol}) ${formatPct(quote.pctChange)}`).join("，") || "暂无行情";
  return `只读摘要：涨幅靠前/波动靠前：${top}。当前提醒规则 ${rules.length} 条。`;
}

function buildBriefingPrompt(context) {
  const quotes = (context.quotes || []).map((quote) => ({
    symbol: quote.symbol,
    name: quote.name,
    pctChange: quote.pctChange,
    amount: quote.amount,
    speed: quote.speed
  }));
  return JSON.stringify({
    task: "生成盯盘摘要、异动解释、需要关注的提醒规则建议。不要建议实盘下单。",
    quotes,
    rules: context.rules || [],
    riskControls: context.riskControls || {}
  });
}

function formatPct(value) {
  if (!Number.isFinite(value)) return "-";
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
}
