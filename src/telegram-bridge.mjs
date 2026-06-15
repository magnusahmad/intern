import http from "node:http";
import { handleInternChatMessage } from "./chat-control.mjs";
import { KeychainSecretProvider } from "./secrets.mjs";
import { handleTelegramWebhook } from "./telegram-webhook.mjs";
import { sendTelegramText } from "./telegram-sender.mjs";

export function createTelegramBridgeServer({
  config = {},
  repoPath = process.cwd(),
  kbPath = config.kb_path,
  secretProvider = new KeychainSecretProvider(),
  chatHandler,
  sendTextFn = sendTelegramText
} = {}) {
  const telegram = config.chat?.telegram || {};
  const webhookPath = telegram.webhook_path || "/webhook";

  return http.createServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url || "/", "http://127.0.0.1");
      if (requestUrl.pathname === "/health") {
        return writeJson(response, 200, { status: "ok" });
      }
      if (requestUrl.pathname !== webhookPath) {
        return writeText(response, 404, "not found");
      }

      const rawBody = request.method === "POST" ? await readRawBody(request) : "";
      const result = await handleTelegramWebhook({
        method: request.method,
        headers: request.headers,
        rawBody,
        secretToken: resolveOptional(secretProvider, telegram.webhook_secret_ref),
        dispatchMessage: async (message) => {
          const chatResult = chatHandler
            ? await chatHandler(message)
            : await handleInternChatMessage({ message, config, kbPath, repoPath });
          if (chatResult?.reply && shouldReply({ chatResult, telegram })) {
            await sendTextFn({
              chatId: message.chatId,
              text: chatResult.reply,
              config: telegram,
              secretProvider
            });
          }
          return chatResult;
        }
      });

      return writeText(response, result.statusCode, result.body);
    } catch (error) {
      return writeJson(response, 500, { status: "error", message: error.message });
    }
  });
}

export function startTelegramBridge({
  config = {},
  repoPath = process.cwd(),
  kbPath = config.kb_path,
  secretProvider = new KeychainSecretProvider()
} = {}) {
  const telegram = config.chat?.telegram || {};
  const host = telegram.host || "127.0.0.1";
  const port = Number(telegram.port || 17671);
  const server = createTelegramBridgeServer({ config, repoPath, kbPath, secretProvider });
  return new Promise((resolve) => {
    server.listen(port, host, () => {
      resolve({
        server,
        host,
        port,
        url: `http://${host}:${port}${telegram.webhook_path || "/webhook"}`
      });
    });
  });
}

function shouldReply({ chatResult, telegram }) {
  if (chatResult.status === "denied" && telegram.reply_to_unauthorized === false) return false;
  return true;
}

function resolveOptional(secretProvider, ref) {
  return ref ? secretProvider.resolve(ref) : "";
}

function readRawBody(request) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    request.on("error", reject);
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
  });
}

function writeJson(response, statusCode, body) {
  response.writeHead(statusCode, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

function writeText(response, statusCode, body = "") {
  response.writeHead(statusCode, { "Content-Type": "text/plain" });
  response.end(body);
}
