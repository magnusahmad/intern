import assert from "node:assert/strict";
import crypto from "node:crypto";
import { Readable, Writable } from "node:stream";
import test from "node:test";
import {
  handleInternChatMessage,
  parseInternChatIntent
} from "../src/chat-control.mjs";
import {
  handleWhatsAppWebhook,
  parseWhatsAppMessages,
  verifyMetaSignature
} from "../src/whatsapp-webhook.mjs";
import { createWhatsAppBridgeServer } from "../src/whatsapp-bridge.mjs";
import { sendWhatsAppText } from "../src/whatsapp-sender.mjs";

const CHAT_CONFIG = {
  chat: {
    whatsapp: {
      allowed_senders: ["whatsapp:+15551234567"]
    }
  }
};

test("test_chat_intent_routes_review_latest_artefacts_to_kb_filing_skill", async () => {
  const calls = [];
  const response = await handleInternChatMessage({
    message: {
      channel: "whatsapp",
      sender: "whatsapp:+15551234567",
      text: "review latest artefacts and update the kb"
    },
    config: CHAT_CONFIG,
    kbPath: "/tmp/ao1-kb",
    repoPath: "/tmp/ao1-intern",
    fileLatestSyncFn: (options) => {
      calls.push(options);
      return {
        status: "filed",
        runId: "2026-06-15T120000-000Z",
        outputs: ["/tmp/ao1-intern/runs/2026-06-15/file.md"],
        kbWrites: [{ relativePath: "product/ideas/intern-agent-governance.md", mode: "appended" }]
      };
    }
  });

  assert.equal(response.status, "ok");
  assert.equal(response.intent, "review-latest-sync");
  assert.equal(response.skill, "ao1-kb-filing");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].kbPath, "/tmp/ao1-kb");
  assert.equal(calls[0].repoPath, "/tmp/ao1-intern");
  assert.match(response.reply, /filed/i);
  assert.match(response.reply, /2026-06-15T120000-000Z/);
  assert.match(response.reply, /KB writes: 1/);
});

test("test_chat_control_blocks_unapproved_whatsapp_senders", async () => {
  const response = await handleInternChatMessage({
    message: {
      channel: "whatsapp",
      sender: "whatsapp:+19999999999",
      text: "review latest artifacts"
    },
    config: CHAT_CONFIG,
    kbPath: "/tmp/ao1-kb",
    repoPath: "/tmp/ao1-intern",
    fileLatestSyncFn: () => {
      throw new Error("should not run");
    }
  });

  assert.equal(response.status, "denied");
  assert.equal(response.intent, "unauthorized");
  assert.match(response.reply, /not authorized/i);
});

test("test_chat_intent_can_review_generated_policy_and_schedule_artifacts", async () => {
  const response = await handleInternChatMessage({
    message: {
      channel: "whatsapp",
      sender: "whatsapp:+15551234567",
      text: "review generated policy artifacts"
    },
    config: CHAT_CONFIG,
    kbPath: "/tmp/ao1-kb",
    repoPath: "/tmp/ao1-intern",
    reviewArtifactsFn: () => ({
      status: "passed",
      checks: [
        { name: "artifact secret scan", status: "passed" },
        { name: "host broker policy", status: "passed" }
      ]
    })
  });

  assert.equal(response.status, "ok");
  assert.equal(response.intent, "review-generated-artifacts");
  assert.equal(response.skill, "artifact-review");
  assert.match(response.reply, /passed/i);
  assert.match(response.reply, /2 checks/);
});

test("test_chat_intent_parser_keeps_operator_commands_small_and_predictable", () => {
  assert.equal(parseInternChatIntent("review latest artefacts"), "review-latest-sync");
  assert.equal(parseInternChatIntent("file latest sync"), "review-latest-sync");
  assert.equal(parseInternChatIntent("review generated schedule artifacts"), "review-generated-artifacts");
  assert.equal(parseInternChatIntent("status"), "runtime-status");
  assert.equal(parseInternChatIntent("help"), "help");
  assert.equal(parseInternChatIntent("delete everything"), "unknown");
});

test("test_whatsapp_webhook_parses_text_messages_for_chat_dispatch", async () => {
  const payload = {
    entry: [{
      changes: [{
        value: {
          messages: [{
            from: "15551234567",
            id: "wamid.test",
            timestamp: "1781517600",
            type: "text",
            text: { body: "review latest artifacts" }
          }]
        }
      }]
    }]
  };

  assert.deepEqual(parseWhatsAppMessages(payload), [{
    channel: "whatsapp",
    sender: "whatsapp:+15551234567",
    messageId: "wamid.test",
    timestamp: "1781517600",
    text: "review latest artifacts"
  }]);
});

test("test_whatsapp_webhook_verifies_meta_signature_before_dispatch", async () => {
  const rawBody = JSON.stringify({
    entry: [{
      changes: [{
        value: {
          messages: [{
            from: "15551234567",
            id: "wamid.test",
            type: "text",
            text: { body: "status" }
          }]
        }
      }]
    }]
  });
  const appSecret = "local-test-secret";
  const signature = `sha256=${crypto.createHmac("sha256", appSecret).update(rawBody).digest("hex")}`;
  const dispatched = [];

  const result = await handleWhatsAppWebhook({
    method: "POST",
    headers: { "x-hub-signature-256": signature },
    rawBody,
    appSecret,
    dispatchMessage: async (message) => {
      dispatched.push(message);
      return { reply: "Intern is healthy." };
    }
  });

  assert.equal(result.statusCode, 200);
  assert.equal(dispatched.length, 1);
  assert.equal(dispatched[0].sender, "whatsapp:+15551234567");
  assert.equal(verifyMetaSignature({ rawBody, signatureHeader: signature, appSecret }), true);
  assert.equal(verifyMetaSignature({ rawBody, signatureHeader: "sha256=bad", appSecret }), false);
});

test("test_whatsapp_sender_posts_text_replies_without_persisting_tokens", async () => {
  const calls = [];
  const result = await sendWhatsAppText({
    to: "whatsapp:+15551234567",
    text: "AO1 Intern runtime is ready.",
    config: {
      graph_api_base_url: "https://graph.facebook.test",
      graph_api_version: "v99.0",
      phone_number_id: "123456789",
      access_token_ref: "keychain://ao1-intern/whatsapp-access-token"
    },
    secretProvider: {
      resolve: (ref) => {
        assert.equal(ref, "keychain://ao1-intern/whatsapp-access-token");
        return "test-access-token";
      }
    },
    fetchFn: async (url, options) => {
      calls.push({ url, options });
      return {
        ok: true,
        status: 200,
        json: async () => ({ messages: [{ id: "wamid.reply" }] })
      };
    }
  });

  assert.equal(result.status, "sent");
  assert.equal(result.messageId, "wamid.reply");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://graph.facebook.test/v99.0/123456789/messages");
  assert.equal(calls[0].options.headers.Authorization, "Bearer test-access-token");
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    messaging_product: "whatsapp",
    to: "15551234567",
    type: "text",
    text: { preview_url: false, body: "AO1 Intern runtime is ready." }
  });
});

test("test_whatsapp_bridge_verifies_challenge_and_dispatches_chat_replies", async () => {
  const rawBody = JSON.stringify({
    entry: [{
      changes: [{
        value: {
          messages: [{
            from: "15551234567",
            id: "wamid.test",
            type: "text",
            text: { body: "status" }
          }]
        }
      }]
    }]
  });
  const appSecret = "bridge-app-secret";
  const signature = `sha256=${crypto.createHmac("sha256", appSecret).update(rawBody).digest("hex")}`;
  const sent = [];
  const server = createWhatsAppBridgeServer({
    config: {
      kb_path: "/tmp/ao1-kb",
      chat: {
        whatsapp: {
          webhook_path: "/webhook",
          allowed_senders: ["whatsapp:+15551234567"],
          verify_token_ref: "keychain://ao1-intern/whatsapp-verify-token",
          app_secret_ref: "keychain://ao1-intern/whatsapp-app-secret"
        }
      }
    },
    repoPath: "/tmp/ao1-intern",
    secretProvider: {
      resolve: (ref) => ({
        "keychain://ao1-intern/whatsapp-verify-token": "verify-me",
        "keychain://ao1-intern/whatsapp-app-secret": appSecret
      })[ref]
    },
    chatHandler: async (message) => {
      assert.equal(message.text, "status");
      return { status: "ok", reply: "AO1 Intern runtime is ready." };
    },
    sendTextFn: async ({ to, text }) => {
      sent.push({ to, text });
      return { status: "sent", messageId: "wamid.reply" };
    }
  });

  const challenge = await invokeServer(server, {
    method: "GET",
    url: "/webhook?hub.mode=subscribe&hub.verify_token=verify-me&hub.challenge=abc123"
  });
  assert.equal(challenge.statusCode, 200);
  assert.equal(challenge.body, "abc123");

  const posted = await invokeServer(server, {
    method: "POST",
    url: "/webhook",
    headers: {
      "content-type": "application/json",
      "x-hub-signature-256": signature
    },
    body: rawBody
  });
  assert.equal(posted.statusCode, 200);
  assert.deepEqual(sent, [{
    to: "whatsapp:+15551234567",
    text: "AO1 Intern runtime is ready."
  }]);
});

function invokeServer(server, { method, url, headers = {}, body = "" }) {
  return new Promise((resolve, reject) => {
    const request = Readable.from(body ? [body] : []);
    request.method = method;
    request.url = url;
    request.headers = headers;

    const chunks = [];
    const response = new Writable({
      write(chunk, _encoding, callback) {
        chunks.push(Buffer.from(chunk));
        callback();
      }
    });
    response.writeHead = (statusCode, responseHeaders = {}) => {
      response.statusCode = statusCode;
      response.headers = responseHeaders;
    };
    response.end = (chunk) => {
      if (chunk) chunks.push(Buffer.from(chunk));
      resolve({
        statusCode: response.statusCode,
        headers: response.headers,
        body: Buffer.concat(chunks).toString("utf8")
      });
    };
    server.emit("request", request, response);
    request.on("error", reject);
    response.on("error", reject);
  });
}
