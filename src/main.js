const express = require("express");
const cron = require("node-cron");
const config = require("./config");
const { initDb } = require("./db");
const { verifyLineSignature, getMessageContent, replyMessage, pushMessage } = require("./line");
const { createOpenAiClient, estimateCaloriesFromImage } = require("./openai");
const { buildSevenDayTrendText, isTrendRequest } = require("./metrics");
const { getDateKey } = require("./week");

function getSourceTarget(source = {}) {
  if (source.userId) {
    return { sourceId: source.userId, sourceType: "user" };
  }

  if (source.groupId) {
    return { sourceId: source.groupId, sourceType: "group" };
  }

  if (source.roomId) {
    return { sourceId: source.roomId, sourceType: "room" };
  }

  return null;
}

async function main() {
  const app = express();
  const openai = createOpenAiClient(config.openAiApiKey);
  const store = await initDb({
    databaseUrl: config.databaseUrl,
    databasePath: config.databasePath,
    timezone: config.timezone
  });

  app.get("/", (_req, res) => {
    res.json({
      ok: true,
      message: "Calorie LINE bot is running."
    });
  });

  app.post("/webhook", express.raw({ type: "*/*", limit: "10mb" }), async (req, res) => {
    const signature = req.get("x-line-signature");
    const isValid = verifyLineSignature(req.body, signature, config.lineChannelSecret);

    if (!isValid) {
      return res.status(401).json({ error: "Invalid LINE signature." });
    }

    let body;
    try {
      body = JSON.parse(req.body.toString("utf8"));
    } catch (error) {
      console.error("Failed to parse webhook body:", error);
      return res.status(400).json({ error: "Invalid JSON body." });
    }

    res.status(200).end();

    for (const event of body.events || []) {
      try {
        await handleEvent(event);
      } catch (error) {
        console.error("Failed to handle LINE event:", error);

        if (event.replyToken) {
          await safeReply(event.replyToken, [
            {
              type: "text",
              text: "画像の解析中にエラーが起きました。少し時間をおいてもう一度送ってください。"
            }
          ]);
        }
      }
    }
  });

  cron.schedule(
    "0 0 * * 1",
    async () => {
      const activeWeek = await store.resetWeek();
      console.log(`Weekly calorie total reset for week starting ${activeWeek}`);
    },
    { timezone: config.timezone }
  );

  cron.schedule(
    "0 21 * * *",
    async () => {
      await sendDailyTrendReports();
    },
    { timezone: config.timezone }
  );

  app.listen(config.port, () => {
    console.log(`Server listening on port ${config.port}`);
  });

  async function safeReply(replyToken, messages) {
    try {
      await replyMessage(replyToken, messages, config.lineChannelAccessToken);
    } catch (error) {
      console.error("Failed to send LINE reply:", error);
    }
  }

  async function safePush(to, messages) {
    try {
      await pushMessage(to, messages, config.lineChannelAccessToken);
    } catch (error) {
      console.error(`Failed to push LINE message to ${to}:`, error);
    }
  }

  async function sendDailyTrendReports() {
    const reportDate = getDateKey(new Date(), config.timezone);
    const targets = await store.getNotificationTargets();

    for (const target of targets) {
      const shouldSend = await store.markDailyReportSent(target.sourceId, reportDate);

      if (!shouldSend) {
        continue;
      }

      const dailyTotals = await store.getDailyTotals(target.sourceId, 7);
      const trend = buildSevenDayTrendText(dailyTotals);
      const messageText = [
        "21:00のカロリーレポート",
        `今日の合計: ${trend.todayTotal} kcal`,
        trend.detailText
      ].join("\n");

      await safePush(target.sourceId, [
        {
          type: "text",
          text: messageText.slice(0, 5000)
        }
      ]);
    }
  }

  async function handleEvent(event) {
    const target = getSourceTarget(event.source);

    if (target) {
      await store.registerChatTarget(target);
    }

    if (event.type !== "message") {
      if (event.replyToken) {
        await safeReply(event.replyToken, [
          {
            type: "text",
            text: "料理の写真を送ってください。カロリーと必要な運動量、今週の累計を返します。"
          }
        ]);
      }
      return;
    }

    const sourceId = target?.sourceId || "unknown";

    if (event.message?.type === "text") {
      if (!isTrendRequest(event.message.text)) {
        await safeReply(event.replyToken, [
          {
            type: "text",
            text: "料理の写真を送るとカロリーを記録します。「グラフ」と送ると直近7日間の推移を表示します。毎日21:00に自動レポートも送ります。"
          }
        ]);
        return;
      }

      const dailyTotals = await store.getDailyTotals(sourceId, 7);
      const trend = buildSevenDayTrendText(dailyTotals);

      await safeReply(event.replyToken, [
        {
          type: "text",
          text: trend.detailText
        }
      ]);
      return;
    }

    if (event.message?.type !== "image") {
      await safeReply(event.replyToken, [
        {
          type: "text",
          text: "料理の写真を送るとカロリーを記録します。「グラフ」と送ると直近7日間の推移を表示します。毎日21:00に自動レポートも送ります。"
        }
      ]);
      return;
    }

    const { buffer, contentType } = await getMessageContent(event.message.id, config.lineChannelAccessToken);
    const estimate = await estimateCaloriesFromImage(openai, config.openAiModel, buffer, contentType);

    await store.logMeal({
      userId: sourceId,
      estimatedCalories: estimate.estimatedCalories,
      mealName: estimate.mealName,
      description: estimate.description,
      walkingMinutes: estimate.walkingMinutes,
      joggingMinutes: estimate.joggingMinutes
    });

    const weeklyTotal = await store.getWeeklyTotal(sourceId);
    const dailyTotals = await store.getDailyTotals(sourceId, 7);
    const trend = buildSevenDayTrendText(dailyTotals);

    const replyText = [
      `料理: ${estimate.mealName}`,
      `推定カロリー: ${estimate.estimatedCalories} kcal`,
      `運動目安: ウォーキング ${estimate.walkingMinutes}分 / ジョギング ${estimate.joggingMinutes}分`,
      `今日の累計: ${trend.todayTotal} kcal`,
      `今週の累計: ${weeklyTotal.totalCalories} kcal`,
      `7日推移: ${trend.sparkline}`,
      `補足: ${estimate.description}`,
      estimate.notes,
      "毎日21:00に直近7日間の推移を自動でお知らせします。",
      "「グラフ」と送ると日別の詳細を表示します。"
    ].join("\n");

    await safeReply(event.replyToken, [
      {
        type: "text",
        text: replyText.slice(0, 5000)
      }
    ]);
  }
}

main().catch((error) => {
  console.error("Application failed to start:", error);
  process.exit(1);
});
