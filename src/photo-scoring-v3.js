const OpenAI = require("openai");

function buildPrompt() {
  return [
    "You judge travel photos for a Japanese family LINE bot.",
    "Return strict JSON only.",
    "Required keys: title, score, shotAtText, locationText, summary, reaction, reasons, bonusTags.",
    "title: short appealing Japanese title in Japanese, 8 to 20 characters.",
    "score: integer from 30 to 100.",
    "Do not force the average score to 75.",
    "Do not default to middle scores when uncertain. If a photo is weak, score low. If it is strong, score high.",
    "Use the score bands intentionally: 30-44 weak, 45-59 below average, 60-74 decent, 75-89 strong, 90-100 exceptional.",
    "shotAtText: if you can infer a likely shooting date or time from the image, describe it shortly in Japanese; otherwise return '不明'.",
    "locationText: infer the likely place or situation in Japanese; if unknown return '場所不明'.",
    "summary: one short Japanese sentence describing what is impressive, memorable, or emotionally strong about the photo.",
    "reaction: one short playful upbeat Japanese sentence for the chat reply.",
    "reasons: array of 4 short Japanese reasons for scoring.",
    "bonusTags: array of short Japanese tags that explain bonus judgments, such as 猫ボーナス, 子どもボーナス, 旅行感ボーナス, 面白瞬間ボーナス, 笑顔ボーナス.",
    "Judge with both a professional photography perspective and a unique playful perspective.",
    "Professional perspective should consider composition, framing, subject separation, depth, moment capture, emotional storytelling, timing, exposure, white balance, contrast, color harmony, highlight control, shadow detail, sharpness, motion blur, noise, background clutter, and eye direction.",
    "Playful perspective should strongly reward cat photos, children, funny moments, travel-ness, rare scenes, family chemistry, delicious food with people, surprise, and future-memory value.",
    "If a cat is adorable or human interaction with a cat is memorable, add a strong bonus.",
    "If children are expressive, joyful, or central to the travel memory, add a strong bonus.",
    "If the image strongly feels like travel, sightseeing, adventure, or a precious trip memory, add a strong bonus.",
    "If the timing is funny, rare, unexpected, or laugh-out-loud charming, add a strong bonus.",
    "Subtract points when blur is distracting, expressions are weak, eyes are closed, faces are too dark, composition is awkward, the background is messy, or image quality is poor.",
    "Use very high scores only when the image is genuinely standout or unforgettable."
  ].join(" ");
}

function normalizePhotoScore(raw, fallbackTimestamp) {
  const reasons = Array.isArray(raw.reasons)
    ? raw.reasons.filter(Boolean).slice(0, 4)
    : [];
  const bonusTags = Array.isArray(raw.bonusTags)
    ? raw.bonusTags.filter(Boolean).slice(0, 4)
    : [];

  return {
    title: String(raw.title || "家族旅行のベストショット").trim(),
    score: Math.max(30, Math.min(100, Math.round(Number(raw.score) || 78))),
    shotAtText: normalizeShotAtText(raw.shotAtText, fallbackTimestamp),
    locationText: normalizeLocationText(raw.locationText),
    summary: String(raw.summary || "旅の空気と楽しさがしっかり写った一枚です。").trim(),
    reaction: String(raw.reaction || "これは思い出アルバムの主役候補です。").trim(),
    reasons: reasons.length > 0 ? reasons : ["構図と空気感、思い出としての強さを総合して採点しました。"],
    bonusTags
  };
}

function normalizeShotAtText(value, fallbackTimestamp) {
  const text = String(value || "").trim();

  if (text && text !== "不明") {
    return text;
  }

  if (!(fallbackTimestamp instanceof Date) || Number.isNaN(fallbackTimestamp.getTime())) {
    return "不明";
  }

  return `不明（投稿日時 ${formatJapanDateTime(fallbackTimestamp)}）`;
}

function normalizeLocationText(value) {
  const text = String(value || "").trim();
  return text || "場所不明";
}

function formatJapanDateTime(date) {
  return new Intl.DateTimeFormat("ja-JP", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(date);
}

function createOpenAiClient(apiKey) {
  return new OpenAI({ apiKey });
}

async function scoreTravelPhoto(client, model, imageBuffer, mimeType, fallbackTimestamp) {
  const base64Image = imageBuffer.toString("base64");

  const completion = await client.chat.completions.create({
    model,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: buildPrompt()
      },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: "この旅行写真を採点して、指定したJSONだけを返してください。"
          },
          {
            type: "image_url",
            image_url: {
              url: `data:${mimeType};base64,${base64Image}`
            }
          }
        ]
      }
    ]
  });

  const content = completion.choices[0]?.message?.content;

  if (!content) {
    throw new Error("OpenAI response did not include any content.");
  }

  const parsed = JSON.parse(content);
  return normalizePhotoScore(parsed, fallbackTimestamp);
}

module.exports = {
  createOpenAiClient,
  scoreTravelPhoto
};
