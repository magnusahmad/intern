export async function sendTelegramText({
  chatId,
  text,
  config = {},
  secretProvider,
  fetchFn = globalThis.fetch
} = {}) {
  if (!fetchFn) throw new Error("No fetch implementation available");
  if (!secretProvider) throw new Error("Missing secretProvider");
  const token = secretProvider.resolve(required(config.bot_token_ref, "chat.telegram.bot_token_ref"));
  const baseUrl = (config.bot_api_base_url || "https://api.telegram.org").replace(/\/$/, "");
  const response = await fetchFn(`${baseUrl}/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: required(chatId, "chatId"),
      text: String(text || ""),
      disable_web_page_preview: true
    })
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.ok === false) {
    throw new Error(`Telegram send failed with ${response.status}: ${body.description || "unknown error"}`);
  }
  return {
    status: "sent",
    messageId: body.result?.message_id || null
  };
}

function required(value, label) {
  if (value === undefined || value === null || value === "") throw new Error(`Missing ${label}`);
  return value;
}
