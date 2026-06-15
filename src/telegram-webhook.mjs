export function parseTelegramMessages(payload = {}) {
  const message = payload.message || payload.edited_message || null;
  if (!message?.text || !message.from?.id || !message.chat?.id) return [];
  return [{
    channel: "telegram",
    sender: `telegram:${message.from.id}`,
    chatId: message.chat.id,
    messageId: message.message_id || null,
    timestamp: String(message.date || ""),
    text: message.text
  }];
}

export function verifyTelegramSecretToken({ headerValue = "", secretToken = "" } = {}) {
  if (!secretToken) return true;
  return String(headerValue) === String(secretToken);
}

export async function handleTelegramWebhook({
  method = "POST",
  headers = {},
  rawBody = "",
  secretToken = "",
  dispatchMessage
} = {}) {
  if (method !== "POST") {
    return { statusCode: 405, body: "method not allowed" };
  }

  const header = headerValue(headers, "x-telegram-bot-api-secret-token");
  if (!verifyTelegramSecretToken({ headerValue: header, secretToken })) {
    return { statusCode: 401, body: "invalid secret token" };
  }

  let payload;
  try {
    payload = JSON.parse(rawBody || "{}");
  } catch {
    return { statusCode: 400, body: "invalid json" };
  }

  const messages = parseTelegramMessages(payload);
  const responses = [];
  for (const message of messages) {
    if (!dispatchMessage) continue;
    responses.push(await dispatchMessage(message));
  }

  return {
    statusCode: 200,
    body: JSON.stringify({
      status: "received",
      messages: messages.length,
      responses: responses.length
    })
  };
}

function headerValue(headers, name) {
  const target = name.toLowerCase();
  for (const [key, value] of Object.entries(headers || {})) {
    if (key.toLowerCase() === target) return Array.isArray(value) ? value[0] : value;
  }
  return "";
}
