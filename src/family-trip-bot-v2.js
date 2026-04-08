const config = require("./config");
const { createLineBotServer } = require("./create-line-bot-server");
const { initDb } = require("./db");
const { getMessageContent, replyMessage, getGroupMemberProfile } = require("./line");
const { createOpenAiClient, scoreTravelPhoto } = require("./photo-scoring-v3");

async function main() {
  const openai = createOpenAiClient(config.openAiApiKey);
  const store = await initDb({
    databaseUrl: config.databaseUrl,
    databasePath: config.databasePath
  });

  const app = createLineBotServer({
    channelSecret: config.lineChannelSecret,
    healthMessage: `${config.appName} is running.`,
    onEvent: handleEvent,
    onError: async (error, event) => {
      console.error("Failed to handle LINE event:", error);

      if (event.replyToken) {
        await safeReply(event.replyToken, "処理中にエラーが発生しました。もう一度お試しください。");
      }
    }
  });

  app.listen(config.port, () => {
    console.log(`Server listening on port ${config.port}`);
  });

  async function safeReply(replyToken, text) {
    try {
      await replyMessage(
        replyToken,
        [
          {
            type: "text",
            text: String(text).slice(0, 5000)
          }
        ],
        config.lineChannelAccessToken
      );
    } catch (error) {
      console.error("Failed to send LINE reply:", error);
    }
  }

  async function handleEvent(event) {
    if (!event.replyToken) {
      return;
    }

    if (event.source?.type !== "group" || !event.source.groupId || !event.source.userId) {
      await safeReply(event.replyToken, "このbotは家族3人が参加するLINEグループで使ってください。");
      return;
    }

    const groupId = event.source.groupId;
    const userId = event.source.userId;
    const displayName = await getDisplayName(groupId, userId);

    await store.upsertGroupMember({
      groupId,
      userId,
      displayName
    });

    if (event.type !== "message") {
      await safeReply(event.replyToken, buildHelpText());
      return;
    }

    if (event.message?.type === "text") {
      await handleTextMessage(event, {
        groupId,
        userId,
        displayName
      });
      return;
    }

    if (event.message?.type !== "image") {
      await safeReply(event.replyToken, "写真を送ると採点します。`ランキング`、`リセット`、`承認` も使えます。");
      return;
    }

    await handleImageMessage(event, {
      groupId,
      userId,
      displayName
    });
  }

  async function getDisplayName(groupId, userId) {
    try {
      const profile = await getGroupMemberProfile(groupId, userId, config.lineChannelAccessToken);
      return profile.displayName || "参加者";
    } catch (error) {
      console.error("Failed to fetch LINE display name:", error);
      return "参加者";
    }
  }

  async function handleTextMessage(event, actor) {
    const text = String(event.message.text || "").trim();

    if (isResetRequest(text)) {
      await store.createResetRequest({
        groupId: actor.groupId,
        requestedByUserId: actor.userId,
        requestedByName: actor.displayName
      });

      await safeReply(
        event.replyToken,
        `${actor.displayName} さんがランキングのリセットを申請しました。\n別の参加者が「承認」と送るとTOP3をリセットします。`
      );
      return;
    }

    if (isResetApproval(text)) {
      const result = await store.approveReset({
        groupId: actor.groupId,
        approvedByUserId: actor.userId,
        approvedByName: actor.displayName
      });

      if (result.status === "missing") {
        await safeReply(event.replyToken, "現在、承認待ちのリセット申請はありません。");
        return;
      }

      if (result.status === "self_approval_blocked") {
        await safeReply(event.replyToken, "リセット申請した本人は承認できません。別の参加者が「承認」と送ってください。");
        return;
      }

      await safeReply(
        event.replyToken,
        `リセット完了。\n申請者: ${result.request.requestedByName}\n承認者: ${actor.displayName}\nランキングTOP3を初期化しました。`
      );
      return;
    }

    if (isRankingRequest(text)) {
      const ranking = await store.getTopRankings(actor.groupId, 3);
      await safeReply(event.replyToken, formatRankingText(ranking));
      return;
    }

    await safeReply(event.replyToken, buildHelpText());
  }

  async function handleImageMessage(event, actor) {
    const { buffer, contentType } = await getMessageContent(event.message.id, config.lineChannelAccessToken);
    const photo = await scoreTravelPhoto(
      openai,
      config.openAiModel,
      buffer,
      contentType,
      new Date(event.timestamp || Date.now())
    );

    await store.savePhotoEntry({
      groupId: actor.groupId,
      userId: actor.userId,
      displayName: actor.displayName,
      messageId: event.message.id,
      title: photo.title,
      score: photo.score,
      shotAtText: photo.shotAtText,
      locationText: photo.locationText,
      summary: photo.summary
    });

    const ranking = await store.getTopRankings(actor.groupId, 3);
    const position = await store.getRankingPosition(actor.groupId, event.message.id);
    const joinedReasons = photo.reasons.map((reason) => `・${reason}`).join("\n");
    const bonusLine = photo.bonusTags.length ? `ボーナス: ${photo.bonusTags.join(" / ")}` : "";
    const lines = [
      `タイトル: ${photo.title}`,
      `スコア: ${photo.score}点`,
      `ひとこと: ${photo.reaction}`,
      bonusLine,
      `講評: ${photo.summary}`,
      "採点ポイント",
      joinedReasons
    ];

    if (position > 0 && position <= 3) {
      lines.push(`TOP3入りです。現在 ${position} 位。`);
      lines.push("");
      lines.push(formatRankingText(ranking));
    } else {
      lines.push("今回はTOP3まであと少し。次の一枚も楽しみです。");
    }

    await safeReply(event.replyToken, lines.filter(Boolean).join("\n"));
  }
}

function buildHelpText() {
  return [
    "旅行写真を送ると採点してTOP3を判定します。",
    "使えるコマンド:",
    "・ランキング",
    "・リセット",
    "・承認"
  ].join("\n");
}

function isRankingRequest(text) {
  return /^(ランキング|top3|順位)$/i.test(text);
}

function isResetRequest(text) {
  return text === "リセット";
}

function isResetApproval(text) {
  return /^(承認|ok|OK)$/i.test(text);
}

function formatRankingText(ranking) {
  if (!ranking.length) {
    return "ランキングTOP3はまだありません。写真を送ってスタートしましょう。";
  }

  const medal = ["🥇", "🥈", "🥉"];
  const lines = ["ランキングTOP3"];

  ranking.forEach((entry, index) => {
    lines.push(`${medal[index] || `${index + 1}.`} ${entry.title}`);
    lines.push(`   ${entry.displayName}さん  ${entry.score}点`);
  });

  return lines.join("\n");
}

main().catch((error) => {
  console.error("Application failed to start:", error);
  process.exit(1);
});
