const express = require("express");
const { verifyLineSignature } = require("./line");

function createLineBotServer(options) {
  const {
    channelSecret,
    onEvent,
    onError,
    healthMessage = "LINE bot is running.",
    webhookPath = "/webhook"
  } = options;

  if (typeof onEvent !== "function") {
    throw new TypeError("createLineBotServer requires an onEvent handler.");
  }

  const app = express();

  app.get("/", (_req, res) => {
    res.json({
      ok: true,
      message: healthMessage
    });
  });

  app.post(webhookPath, express.raw({ type: "*/*", limit: "10mb" }), async (req, res) => {
    const signature = req.get("x-line-signature");
    const isValid = verifyLineSignature(req.body, signature, channelSecret);

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
        await onEvent(event);
      } catch (error) {
        if (typeof onError === "function") {
          await onError(error, event);
          continue;
        }

        console.error("Failed to handle LINE event:", error);
      }
    }
  });

  return app;
}

module.exports = {
  createLineBotServer
};
