import crypto from "node:crypto";

export function parseWhatsAppMessages(payload = {}) {
  const messages = [];
  for (const entry of payload.entry || []) {
    for (const change of entry.changes || []) {
      for (const message of change.value?.messages || []) {
        if (message.type !== "text" || !message.text?.body) continue;
        messages.push({
          channel: "whatsapp",
          sender: normalizeWhatsAppSender(message.from),
          messageId: message.id || null,
          timestamp: message.timestamp || null,
          text: message.text.body
        });
      }
    }
  }
  return messages;
}

export function verifyMetaSignature({ rawBody = "", signatureHeader = "", appSecret = "" } = {}) {
  if (!rawBody || !signatureHeader || !appSecret) return false;
  if (!signatureHeader.startsWith("sha256=")) return false;
  const expected = `sha256=${crypto.createHmac("sha256", appSecret).update(rawBody).digest("hex")}`;
  const expectedBuffer = Buffer.from(expected);
  const actualBuffer = Buffer.from(signatureHeader);
  if (expectedBuffer.length !== actualBuffer.length) return false;
  return crypto.timingSafeEqual(expectedBuffer, actualBuffer);
}

export async function handleWhatsAppWebhook({
  method = "POST",
  query = {},
  headers = {},
  rawBody = "",
  appSecret = "",
  verifyToken = "",
  dispatchMessage
} = {}) {
  if (method === "GET") {
    return verifyChallenge({ query, verifyToken });
  }

  if (method !== "POST") {
    return { statusCode: 405, body: "method not allowed" };
  }

  const signatureHeader = headerValue(headers, "x-hub-signature-256");
  if (appSecret && !verifyMetaSignature({ rawBody, signatureHeader, appSecret })) {
    return { statusCode: 401, body: "invalid signature" };
  }

  let payload;
  try {
    payload = JSON.parse(rawBody || "{}");
  } catch {
    return { statusCode: 400, body: "invalid json" };
  }

  const messages = parseWhatsAppMessages(payload);
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

function verifyChallenge({ query, verifyToken }) {
  const mode = query["hub.mode"] || query.mode;
  const token = query["hub.verify_token"] || query.verify_token;
  const challenge = query["hub.challenge"] || query.challenge;
  if (mode === "subscribe" && token && token === verifyToken) {
    return { statusCode: 200, body: String(challenge || "") };
  }
  return { statusCode: 403, body: "forbidden" };
}

function normalizeWhatsAppSender(sender = "") {
  const text = String(sender);
  if (text.startsWith("whatsapp:")) return text;
  if (text.startsWith("+")) return `whatsapp:${text}`;
  return `whatsapp:+${text}`;
}

function headerValue(headers, name) {
  const target = name.toLowerCase();
  for (const [key, value] of Object.entries(headers || {})) {
    if (key.toLowerCase() === target) return value;
  }
  return "";
}
