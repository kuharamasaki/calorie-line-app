const path = require("path");
const os = require("os");
require("dotenv").config();

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

const projectRoot = path.resolve(__dirname, "..");

function getDefaultDatabasePath() {
  if (process.env.DATABASE_PATH) {
    if (process.env.DATABASE_PATH === ":memory:") {
      return ":memory:";
    }

    return path.resolve(projectRoot, process.env.DATABASE_PATH);
  }

  if (process.platform === "win32" && process.env.LOCALAPPDATA) {
    return path.join(process.env.LOCALAPPDATA, "calorie-line-app", "calorie-line.sqlite");
  }

  return path.join(os.homedir(), ".calorie-line-app", "calorie-line.sqlite");
}

module.exports = {
  port: Number(process.env.PORT || 3000),
  timezone: process.env.APP_TIMEZONE || "Asia/Tokyo",
  lineChannelAccessToken: requireEnv("LINE_CHANNEL_ACCESS_TOKEN"),
  lineChannelSecret: requireEnv("LINE_CHANNEL_SECRET"),
  openAiApiKey: requireEnv("OPENAI_API_KEY"),
  openAiModel: process.env.OPENAI_MODEL || "gpt-4.1-mini",
  databaseUrl: process.env.DATABASE_URL || "",
  databasePath: getDefaultDatabasePath()
};
