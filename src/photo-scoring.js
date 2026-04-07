const OpenAI = require("openai");

function buildPrompt() {
  return [
    "You judge travel photos for a Japanese family LINE bot.",
    "Return strict JSON only.",
    "Required keys: title, score, shotAtText, locationText, summary, reaction, reasons.",
    "title: short appealing Japanese title, 8 to 20 characters.",
    "score: integer from 50 to 100. Average around 75.",
    "shotAtText: if you can infer a likely shooting date or time from the image, describe it shortly in Japanese; otherwise return '不明'.",
    "locationText: infer the likely place or situation in Japanese; if unknown return '場所不明'.",
    "summary: one short Japanese sentence describing what is good or memorable about the photo.",
    "reaction: one short upbeat Japanese sentence for the chat reply.",
    "reasons: array of 3 short Japanese reasons for scoring.",
    "Add points when people appear together, people and animals appear together, composition is good, brightness, exposure and white balance are balanced, many smiles are visible, scenery is beautiful, the image is funny or rare, there is a face-in-hole panel photo, delicious food with people appears, people enjoy a valuable experience, cats with people appear, children appear, or a cat photo is charming.",
    "Subtract points when blur is noticeable, eyes are closed, expressions look dark, faces are too dark, or image quality is poor.",
    "Keep scores realistic and avoid giving 95+ unless the photo feels truly special."
  ].join(" ");
}

function normalizePhotoScore(raw, fallbackTimestamp) {
  const reasons = Array.isArray(raw.reasons)
    ? raw.reasons.filter(Boolean).slice(0, 3)
    : [];

  return {
    title: String(raw.title || "家族旅行の一枚").trim(),
    score: Math.max(50, Math.min(100, Math.round(Number(raw.score) || 75))),
    shotAtText: normalizeShotAtText(raw.shotAtText, fallbackTimestamp),
    locationText: normalizeLocationText(raw.locationText),
    summary: String(raw.summary || "楽しい旅行の雰囲気が伝わる写真です。").trim(),
    reaction: String(raw.reaction || "すてきな思い出の1枚です。").trim(),
    reasons: reasons.length > 0 ? reasons : ["構図や表情のバランスを見て採点しました。"]
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
