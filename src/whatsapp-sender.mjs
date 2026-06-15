export async function sendWhatsAppText({
  to,
  text,
  config = {},
  secretProvider,
  fetchFn = globalThis.fetch
} = {}) {
  if (!fetchFn) throw new Error("No fetch implementation available");
  if (!secretProvider) throw new Error("Missing secretProvider");
  const tokenRef = required(config.access_token_ref, "chat.whatsapp.access_token_ref");
  const phoneNumberId = required(config.phone_number_id, "chat.whatsapp.phone_number_id");
  const token = secretProvider.resolve(tokenRef);
  const baseUrl = (config.graph_api_base_url || "https://graph.facebook.com").replace(/\/$/, "");
  const version = config.graph_api_version || "v23.0";
  const url = `${baseUrl}/${version}/${phoneNumberId}/messages`;
  const response = await fetchFn(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: normalizeRecipient(to),
      type: "text",
      text: {
        preview_url: false,
        body: String(text || "")
      }
    })
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`WhatsApp send failed with ${response.status}: ${body.error?.message || "unknown error"}`);
  }
  return {
    status: "sent",
    messageId: body.messages?.[0]?.id || null
  };
}

function normalizeRecipient(value = "") {
  return String(value)
    .replace(/^whatsapp:/, "")
    .replace(/^\+/, "")
    .replace(/\D/g, "");
}

function required(value, label) {
  if (!value) throw new Error(`Missing ${label}`);
  return value;
}
