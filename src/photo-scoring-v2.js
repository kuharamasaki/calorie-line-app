const OpenAI = require("openai");

function buildPrompt() {
  return [
    "You judge travel photos for a Japanese family LINE bot.",
    "Return strict JSON only.",
    "Required keys: title, score, shotAtText, locationText, summary, reaction, reasons.",
    "title: short appealing Japanese title in Japanese, 8 to 20 characters.",
    "score: integer from 50 to 100.",
    "Do not force the average score to 75. Use the full range more naturally.",
    "shotAtText: if you can infer a likely shooting date or time from the image, describe it shortly in Japanese; otherwise return '不明'.",
    "locationText: infer the likely place or situation in Japanese; if unknown return '場所不明'.",
    "summary: one short Japanese sentence describing what is impressive, memorable, or emotionally strong about the photo.",
    "reaction: one short playful upbeat Japanese sentence for the chat reply.",
    "reasons: array of 4 short Japanese reasons for scoring.",
    "Judge with both a professional photography perspective and a unique playful perspective.",
    "Professional perspective should consider composition, framing, subject separation, depth, moment capture, emotional storytelling, timing, exposure, white balance, contrast, color harmony, highlight control, shadow detail, sharpness, motion blur, noise, background clutter, and eye direction.",
    "Playful perspective should consider rarity, humor, family chemistry, travel-story value, surprise, memorability, cat bonus, child bonus, food temptation, face-in-hole panel charm, and whether the photo feels like a future favorite memory.",
    "Add points when people appear together, smiles are natural, the scene feels alive, scenery is beautiful, timing is excellent, animals and people interact well, or the image captures a precious travel experience.",
    "Subtract points when blur is distracting, expressions are weak, eyes are closed, faces are too dark, composition is awkward, the background is messy, or image quality is poor.",
    "Use very high scores only when the image is genuinely standout or unforgettable."
  ].join(" ");
}

function normalizePhotoScore(raw, fallbackTimestamp) {
  const reasons = Array.isArray(raw.reasons)
    ? raw.reasons.filter(Boolean).slice(0, 4)
    : [];

  return {
    title: String(raw.title || "家族旅行のベストショット").trim(),
    score: Math.max(50, Math.min(100, Math.round(Number(raw.score) || 78))),
    shotAtText: normalizeShotAtText(raw.shotAtText, fallbackTimestamp),
    locationText: normalizeLocationText(raw.locationText),
    summary: String(raw.summary || "旅の空気と楽しさがしっかり写った一枚です。").trim(),
    reaction: String(raw.reaction || "これは思い出アルバムの主役候補です。").trim(),
    reasons: reasons.length > 0 ? reasons : ["構図と空気感、思い出としての強さを総合して採点しました。"]
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
