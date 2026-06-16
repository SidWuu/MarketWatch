const FAST_REFRESH_MS = 5000;
const SLOW_REFRESH_MS = 60000;

export function getCnMarketSession(now = new Date()) {
  const local = toChinaTimeParts(now);
  const minutes = local.hour * 60 + local.minute;
  const isWeekday = local.weekday >= 1 && local.weekday <= 5;
  const isMorning = minutes >= 9 * 60 + 30 && minutes <= 11 * 60 + 30;
  const isAfternoon = minutes >= 13 * 60 && minutes <= 15 * 60;
  const isOpen = isWeekday && (isMorning || isAfternoon);

  return {
    market: "CN_A",
    isOpen,
    phase: isOpen ? "OPEN" : "CLOSED",
    checkedAt: now.toISOString()
  };
}

export function getRefreshDelayMs(now = new Date()) {
  return getCnMarketSession(now).isOpen ? FAST_REFRESH_MS : SLOW_REFRESH_MS;
}

function toChinaTimeParts(now) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Shanghai",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  });
  const parts = Object.fromEntries(formatter.formatToParts(now).map((part) => [part.type, part.value]));
  return {
    weekday: weekdayNumber(parts.weekday),
    hour: Number(parts.hour),
    minute: Number(parts.minute)
  };
}

function weekdayNumber(shortName) {
  return {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6
  }[shortName];
}
