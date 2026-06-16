export function getBarkConfig(env = process.env) {
  const deviceKey = env.BARK_DEVICE_KEY || "";
  const serverUrl = (env.BARK_SERVER_URL || "https://api.day.app").replace(/\/+$/, "");
  return {
    enabled: Boolean(deviceKey),
    serverUrl,
    deviceKey
  };
}

export async function sendBarkAlert(alert, options = {}) {
  const config = options.config || getBarkConfig();
  if (!config.enabled) {
    return { sent: false, reason: "Bark is not configured" };
  }

  const fetchImpl = options.fetchImpl || fetch;
  const response = await fetchImpl(`${config.serverUrl}/${encodeURIComponent(config.deviceKey)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      title: `MarketWatch: ${alert.name || alert.symbol || "提醒"}`,
      body: alert.message,
      group: "MarketWatch",
      level: barkLevel(alert.severity)
    })
  });

  if (!response.ok) {
    return { sent: false, reason: `Bark responded ${response.status}` };
  }

  return { sent: true };
}

function barkLevel(severity) {
  if (severity === "danger") return "critical";
  if (severity === "warning") return "timeSensitive";
  return "active";
}
