import assert from "node:assert/strict";
import test from "node:test";

import { getBarkConfig, sendBarkAlert } from "../src/server/notifications.js";

const alert = {
  name: "宁德时代",
  message: "宁德时代 涨幅超过 3%",
  severity: "danger"
};

test("skips Bark notification when device key is not configured", async () => {
  const result = await sendBarkAlert(alert, {
    config: getBarkConfig({}),
    fetchImpl: async () => {
      throw new Error("fetch should not be called");
    }
  });

  assert.deepEqual(result, { sent: false, reason: "Bark is not configured" });
});

test("sends Bark notification with configured endpoint and device key", async () => {
  const calls = [];
  const result = await sendBarkAlert(alert, {
    config: getBarkConfig({
      BARK_SERVER_URL: "https://bark.example.com",
      BARK_DEVICE_KEY: "device-key"
    }),
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return { ok: true, status: 200 };
    }
  });

  assert.equal(result.sent, true);
  assert.equal(calls[0].url, "https://bark.example.com/device-key");
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    title: "MarketWatch: 宁德时代",
    body: "宁德时代 涨幅超过 3%",
    group: "MarketWatch",
    level: "critical"
  });
});
