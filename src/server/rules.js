const RULE_DEFINITIONS = {
  "price-above": {
    label: "价格上破",
    severity: "danger",
    predicate: (quote, threshold) => quote.price >= threshold,
    describe: (quote, threshold) => `${quote.name} 最新价 ${quote.price} 上破 ${threshold}`
  },
  "price-below": {
    label: "价格下破",
    severity: "warning",
    predicate: (quote, threshold) => quote.price <= threshold,
    describe: (quote, threshold) => `${quote.name} 最新价 ${quote.price} 下破 ${threshold}`
  },
  "pct-change-above": {
    label: "涨幅超过",
    severity: "danger",
    predicate: (quote, threshold) => quote.pctChange >= threshold,
    describe: (quote, threshold) => `${quote.name} 涨跌幅 ${quote.pctChange}% 超过 ${threshold}%`
  },
  "pct-change-below": {
    label: "跌幅超过",
    severity: "warning",
    predicate: (quote, threshold) => quote.pctChange <= -Math.abs(threshold),
    describe: (quote, threshold) => `${quote.name} 涨跌幅 ${quote.pctChange}% 跌破 -${Math.abs(threshold)}%`
  },
  "speed-above": {
    label: "涨速超过",
    severity: "danger",
    predicate: (quote, threshold) => quote.speed >= threshold,
    describe: (quote, threshold) => `${quote.name} 涨速 ${quote.speed}% 超过 ${threshold}%`
  },
  "amount-above": {
    label: "成交额超过",
    severity: "info",
    predicate: (quote, threshold) => quote.amount >= threshold,
    describe: (quote, threshold) => `${quote.name} 成交额 ${formatAmount(quote.amount)} 超过 ${formatAmount(threshold)}`
  }
};

export function listRuleTypes() {
  return Object.entries(RULE_DEFINITIONS).map(([value, definition]) => ({
    value,
    label: definition.label
  }));
}

export function evaluateRules(rules, quotes, previousState = new Map()) {
  const quotesByInstrumentId = new Map(quotes.map((quote) => [quote.instrumentId ?? quote.symbol, quote]));
  const nextState = new Map(previousState);
  const alerts = [];

  for (const rule of rules) {
    if (!rule.enabled) {
      nextState.delete(rule.id);
      continue;
    }

    const quote = quotesByInstrumentId.get(rule.instrumentId ?? rule.symbol);
    const definition = RULE_DEFINITIONS[rule.type];
    const threshold = Number(rule.threshold);
    if (!quote || !definition || !Number.isFinite(threshold)) {
      nextState.delete(rule.id);
      continue;
    }

    const active = definition.predicate(quote, threshold);
    const wasActive = nextState.get(rule.id) === true;

    if (active && !wasActive) {
      alerts.push({
        id: `${rule.id}-${Date.now()}`,
        ruleId: rule.id,
        instrumentId: quote.instrumentId,
        symbol: quote.symbol,
        name: quote.name,
        message: definition.describe(quote, threshold),
        severity: definition.severity,
        quote,
        createdAt: new Date().toISOString()
      });
    }

    if (active) {
      nextState.set(rule.id, true);
    } else {
      nextState.delete(rule.id);
    }
  }

  return { alerts, state: nextState };
}

function formatAmount(value) {
  if (value >= 100000000) {
    return `${(value / 100000000).toFixed(2)}亿`;
  }
  if (value >= 10000) {
    return `${(value / 10000).toFixed(2)}万`;
  }
  return String(value);
}
