const crypto = require("crypto");

function verifyLineSignature(bodyBuffer, signature, channelSecret) {
  const digest = crypto.createHmac("sha256", channelSecret).update(bodyBuffer).digest("base64");
  const expected = Buffer.from(digest);
  const received = Buffer.from(signature || "");

  if (expected.length !== received.length) {
    return false;
  }

  return crypto.timingSafeEqual(expected, received);
}

async function getMessageContent(messageId, accessToken) {
  const response = await fetch(`https://api-data.line.me/v2/bot/message/${messageId}/content`, {
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to download LINE image: ${response.status} ${text}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  const contentType = response.headers.get("content-type") || "image/jpeg";

  return { buffer, contentType };
}

async function replyMessage(replyToken, messages, accessToken) {
  const response = await fetch("https://api.line.me/v2/bot/message/reply", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      replyToken,
      messages
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to reply to LINE: ${response.status} ${text}`);
  }
}

async function pushMessage(to, messages, accessToken) {
  const response = await fetch("https://api.line.me/v2/bot/message/push", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      to,
      messages
    })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to push LINE message: ${response.status} ${text}`);
  }
}

async function getGroupMemberProfile(groupId, userId, accessToken) {
  const response = await fetch(`https://api.line.me/v2/bot/group/${groupId}/member/${userId}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`
    }
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to fetch LINE group member profile: ${response.status} ${text}`);
  }

  return response.json();
}

module.exports = {
  verifyLineSignature,
  getMessageContent,
  replyMessage,
  pushMessage,
  getGroupMemberProfile
};
