import assert from "node:assert/strict";
import crypto from "node:crypto";
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
