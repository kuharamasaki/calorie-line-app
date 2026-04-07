function getTokyoDateParts(date = new Date(), timeZone = "Asia/Tokyo") {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  });

  const parts = formatter.formatToParts(date);
  const map = Object.fromEntries(parts.filter((part) => part.type !== "literal").map((part) => [part.type, part.value]));

  return {
    year: Number(map.year),
    month: Number(map.month),
    day: Number(map.day),
    hour: Number(map.hour),
    minute: Number(map.minute),
    second: Number(map.second)
  };
}

function getWeekStartKey(date = new Date(), timeZone = "Asia/Tokyo") {
  const { year, month, day } = getTokyoDateParts(date, timeZone);
  const utcDate = new Date(Date.UTC(year, month - 1, day));
  const dayOfWeek = utcDate.getUTCDay();
  const daysSinceMonday = (dayOfWeek + 6) % 7;
  utcDate.setUTCDate(utcDate.getUTCDate() - daysSinceMonday);
  return utcDate.toISOString().slice(0, 10);
}

function getDateKey(date = new Date(), timeZone = "Asia/Tokyo") {
  const { year, month, day } = getTokyoDateParts(date, timeZone);
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function getLastDateKeys(days, date = new Date(), timeZone = "Asia/Tokyo") {
  const { year, month, day } = getTokyoDateParts(date, timeZone);
  const baseDate = new Date(Date.UTC(year, month - 1, day));
  const result = [];

  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const current = new Date(baseDate);
    current.setUTCDate(current.getUTCDate() - offset);
    result.push(current.toISOString().slice(0, 10));
  }

  return result;
}

module.exports = {
  getDateKey,
  getLastDateKeys,
  getTokyoDateParts,
  getWeekStartKey
};
