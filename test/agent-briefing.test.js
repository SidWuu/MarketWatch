import assert from "node:assert/strict";
import test from "node:test";

import { createLocalMarketBriefing, getDeepSeekConfig, requestAgentBriefing } from "../src/server/agent-briefing.js";

const quotes = [
  { instrumentId: "0.300750", symbol: "300750", name: "宁德时代", pctChange: 3.2, amount: 1200000000 },
  { instrumentId: "1.600519", symbol: "600519", name: "贵州茅台", pctChange: -1.1, amount: 800000000 }
];

test("creates a deterministic local read-only briefing without an API key", async () => {
  const briefing = await requestAgentBriefing({ quotes, rules: [] }, {
    config: getDeepSeekConfig({})
  });

  assert.equal(briefing.provider, "local");
  assert.match(briefing.content, /宁德时代/);
  assert.match(briefing.content, /只读摘要/);
});

test("builds local briefing from top movers", () => {
  const briefing = createLocalMarketBriefing({ quotes, rules: [] });

  assert.match(briefing, /涨幅靠前/);
  assert.match(briefing, /宁德时代/);
});

test("calls DeepSeek chat completions when configured", async () => {
  const calls = [];
  const briefing = await requestAgentBriefing({ quotes, rules: [] }, {
    config: getDeepSeekConfig({ DEEPSEEK_API_KEY: "key", DEEPSEEK_MODEL: "deepseek-chat" }),
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return {
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: "DeepSeek briefing" } }] })
      };
    }
  });

  assert.equal(briefing.provider, "deepseek");
  assert.equal(briefing.content, "DeepSeek briefing");
  assert.equal(calls[0].url, "https://api.deepseek.com/chat/completions");
  assert.equal(calls[0].options.headers.authorization, "Bearer key");
});
