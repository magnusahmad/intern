import { handleInternChatMessage } from "./chat-control.mjs";
import { KeychainSecretProvider } from "./secrets.mjs";
import { sendTelegramText } from "./telegram-sender.mjs";
import { parseTelegramMessages } from "./telegram-webhook.mjs";

export async function runTelegramPollingCycle({
  config = {},
  secretProvider = new KeychainSecretProvider(),
  offset = undefined,
  fetchFn = globalThis.fetch,
  dispatchMessage,
  sendTextFn = sendTelegramText
} = {}) {
  if (!fetchFn) throw new Error("No fetch implementation available");
  const token = secretProvider.resolve(required(config.bot_token_ref, "chat.telegram.bot_token_ref"));
  const baseUrl = (config.bot_api_base_url || "https://api.telegram.org").replace(/\/$/, "");
  const response = await fetchFn(`${baseUrl}/bot${token}/getUpdates`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      offset,
      timeout: Number(config.poll_timeout_seconds ?? 25),
      allowed_updates: ["message", "edited_message"]
    })
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || body.ok === false) {
    throw new Error(`Telegram getUpdates failed with ${response.status}: ${body.description || "unknown error"}`);
  }

  let nextOffset = offset;
  let messages = 0;
  for (const update of body.result || []) {
    if (Number.isFinite(update.update_id)) nextOffset = update.update_id + 1;
    for (const message of parseTelegramMessages(update)) {
      messages += 1;
      const chatResult = dispatchMessage ? await dispatchMessage(message) : null;
      if (chatResult?.reply) {
        await sendTextFn({
          chatId: message.chatId,
          text: chatResult.reply,
          config,
          secretProvider
        });
      }
    }
  }

  return {
    status: "ok",
    updates: body.result?.length || 0,
    messages,
    nextOffset
  };
}

export async function startTelegramPolling({
  config = {},
  repoPath = process.cwd(),
  kbPath = config.kb_path,
  secretProvider = new KeychainSecretProvider(),
  fetchFn = globalThis.fetch,
  once = false,
  onCycle = () => {}
} = {}) {
  let offset;
  do {
    const result = await runTelegramPollingCycle({
      config: config.chat?.telegram || {},
      secretProvider,
      offset,
      fetchFn,
      dispatchMessage: (message) => handleInternChatMessage({ message, config, kbPath, repoPath })
    });
    offset = result.nextOffset;
    onCycle(result);
  } while (!once);
  return { status: "stopped", offset };
}

function required(value, label) {
  if (value === undefined || value === null || value === "") throw new Error(`Missing ${label}`);
  return value;
}
