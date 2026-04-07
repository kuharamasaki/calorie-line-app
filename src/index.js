const express = require("express");
const cron = require("node-cron");
const config = require("./config");
const { initDb } = require("./db");
const { verifyLineSignature, getMessageContent, replyMessage } = require("./line");
const { createOpenAiClient, estimateCaloriesFromImage } = require("./openai");

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
        await handleEvent(event, { openai, store });
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

  async function handleEvent(event, { openai, store }) {
    if (event.type !== "message" || event.message?.type !== "image") {
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

    const userId = event.source?.userId || event.source?.groupId || "unknown";
    const { buffer, contentType } = await getMessageContent(event.message.id, config.lineChannelAccessToken);
    const estimate = await estimateCaloriesFromImage(openai, config.openAiModel, buffer, contentType);

    await store.logMeal({
      userId,
      estimatedCalories: estimate.estimatedCalories,
      mealName: estimate.mealName,
      description: estimate.description,
      walkingMinutes: estimate.walkingMinutes,
      joggingMinutes: estimate.joggingMinutes
    });

    const weeklyTotal = await store.getWeeklyTotal(userId);
    const replyText = [
      `料理: ${estimate.mealName}`,
      `推定カロリー: ${estimate.estimatedCalories} kcal`,
      `運動目安: ウォーキング ${estimate.walkingMinutes}分 / ジョギング ${estimate.joggingMinutes}分`,
      `今週の累計: ${weeklyTotal.totalCalories} kcal`,
      `補足: ${estimate.description}`,
      estimate.notes
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
