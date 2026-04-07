const OpenAI = require("openai");
const { WALKING_KCAL_PER_MINUTE, JOGGING_KCAL_PER_MINUTE } = require("./constants");

function buildPrompt() {
  return [
    "You estimate calories from meal photos for a Japanese LINE bot.",
    "Return strict JSON with keys: mealName, description, estimatedCalories, confidence, notes.",
    "mealName: short Japanese meal label.",
    "description: 1 short Japanese sentence about what is visible.",
    "estimatedCalories: integer kcal estimate for the whole meal.",
    "confidence: number between 0 and 1.",
    "notes: short Japanese disclaimer mentioning it is an estimate.",
    "If the image is not food, set mealName to '判別不可', description to a short reason, and estimatedCalories to 0."
  ].join(" ");
}

function normalizeEstimate(raw) {
  const estimatedCalories = Math.max(0, Math.round(Number(raw.estimatedCalories) || 0));
  const walkingMinutes = Math.ceil(estimatedCalories / WALKING_KCAL_PER_MINUTE);
  const joggingMinutes = Math.ceil(estimatedCalories / JOGGING_KCAL_PER_MINUTE);

  return {
    mealName: raw.mealName || "不明な料理",
    description: raw.description || "写真から料理を推定しました。",
    estimatedCalories,
    confidence: Math.max(0, Math.min(1, Number(raw.confidence) || 0)),
    notes: raw.notes || "写真からの推定値です。",
    walkingMinutes,
    joggingMinutes
  };
}

function createOpenAiClient(apiKey) {
  return new OpenAI({ apiKey });
}

async function estimateCaloriesFromImage(client, model, imageBuffer, mimeType) {
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
            text: "料理写真を解析してJSONだけ返してください。"
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
  return normalizeEstimate(parsed);
}

module.exports = {
  createOpenAiClient,
  estimateCaloriesFromImage
};
