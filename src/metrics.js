const SPARKLINE_BLOCKS = [".", ":", "-", "=", "+", "*", "#", "@"];

function buildSparkline(values) {
  const maxValue = Math.max(...values, 0);

  if (maxValue === 0) {
    return values.map(() => SPARKLINE_BLOCKS[0]).join("");
  }

  return values
    .map((value) => {
      const ratio = value / maxValue;
      const index = Math.min(SPARKLINE_BLOCKS.length - 1, Math.round(ratio * (SPARKLINE_BLOCKS.length - 1)));
      return SPARKLINE_BLOCKS[index];
    })
    .join("");
}

function formatDateLabel(dateKey) {
  return dateKey.slice(5).replace("-", "/");
}

function buildSevenDayTrendText(dailyTotals) {
  const values = dailyTotals.map((item) => item.totalCalories);
  const sparkline = buildSparkline(values);
  const today = dailyTotals[dailyTotals.length - 1];
  const lines = dailyTotals.map((item) => `${formatDateLabel(item.dateKey)} ${String(item.totalCalories).padStart(4, " ")} kcal`);

  return {
    todayTotal: today?.totalCalories || 0,
    sparkline,
    detailText: ["直近7日間の推移", ...lines, `グラフ: ${sparkline}`].join("\n")
  };
}

function isTrendRequest(text = "") {
  return /(グラフ|推移|7日|履歴|週間)/.test(text);
}

module.exports = {
  buildSevenDayTrendText,
  isTrendRequest
};
