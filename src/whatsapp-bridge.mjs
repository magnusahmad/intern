import http from "node:http";
import { handleInternChatMessage } from "./chat-control.mjs";
import { KeychainSecretProvider } from "./secrets.mjs";
import { handleWhatsAppWebhook } from "./whatsapp-webhook.mjs";
import { sendWhatsAppText } from "./whatsapp-sender.mjs";

export function createWhatsAppBridgeServer({
  config = {},
  repoPath = process.cwd(),
  kbPath = config.kb_path,
  secretProvider = new KeychainSecretProvider(),
  chatHandler,
  sendTextFn = sendWhatsAppText
} = {}) {
  const whatsapp = config.chat?.whatsapp || {};
  const webhookPath = whatsapp.webhook_path || "/webhook";

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
      const result = await handleWhatsAppWebhook({
        method: request.method,
        query: Object.fromEntries(requestUrl.searchParams.entries()),
        headers: request.headers,
        rawBody,
        verifyToken: resolveOptional(secretProvider, whatsapp.verify_token_ref),
        appSecret: resolveOptional(secretProvider, whatsapp.app_secret_ref),
        dispatchMessage: async (message) => {
          const chatResult = chatHandler
            ? await chatHandler(message)
            : await handleInternChatMessage({ message, config, kbPath, repoPath });
          if (chatResult?.reply && shouldReply({ chatResult, whatsapp })) {
            await sendTextFn({
              to: message.sender,
              text: chatResult.reply,
              config: whatsapp,
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

export function startWhatsAppBridge({
  config = {},
  repoPath = process.cwd(),
  kbPath = config.kb_path,
  secretProvider = new KeychainSecretProvider()
} = {}) {
  const whatsapp = config.chat?.whatsapp || {};
  const host = whatsapp.host || "127.0.0.1";
  const port = Number(whatsapp.port || 17671);
  const server = createWhatsAppBridgeServer({ config, repoPath, kbPath, secretProvider });
  return new Promise((resolve) => {
    server.listen(port, host, () => {
      resolve({
        server,
        host,
        port,
        url: `http://${host}:${port}${whatsapp.webhook_path || "/webhook"}`
      });
    });
  });
}

function shouldReply({ chatResult, whatsapp }) {
  if (chatResult.status === "denied" && whatsapp.reply_to_unauthorized === false) return false;
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
