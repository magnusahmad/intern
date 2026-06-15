import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable, Writable } from "node:stream";
import test from "node:test";
import {
  handleInternChatMessage,
  parseInternChatIntent
} from "../src/chat-control.mjs";
import {
  handleTelegramWebhook,
  parseTelegramMessages,
  verifyTelegramSecretToken
} from "../src/telegram-webhook.mjs";
import { createTelegramBridgeServer } from "../src/telegram-bridge.mjs";
import { runTelegramPollingCycle } from "../src/telegram-poller.mjs";
import { sendTelegramText } from "../src/telegram-sender.mjs";

const CHAT_CONFIG = {
  chat: {
    telegram: {
      allowed_senders: ["telegram:123456789"]
    }
  }
};

test("test_chat_intent_routes_review_latest_artefacts_to_kb_filing_skill", async () => {
  const calls = [];
  const response = await handleInternChatMessage({
    message: {
      channel: "telegram",
      sender: "telegram:123456789",
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

test("test_chat_control_blocks_unapproved_telegram_senders", async () => {
  const response = await handleInternChatMessage({
    message: {
      channel: "telegram",
      sender: "telegram:999999999",
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
      channel: "telegram",
      sender: "telegram:123456789",
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
  assert.equal(parseInternChatIntent("try the more recent ones"), "review-latest-sync");
  assert.equal(parseInternChatIntent("what did you write?"), "summarize-last-filing");
  assert.equal(parseInternChatIntent("where did you put it?"), "summarize-last-filing");
  assert.equal(parseInternChatIntent("review generated schedule artifacts"), "review-generated-artifacts");
  assert.equal(parseInternChatIntent("status"), "runtime-status");
  assert.equal(parseInternChatIntent("help"), "help");
  assert.equal(parseInternChatIntent("delete everything"), "unknown");
});

test("test_chat_can_explain_last_filing_outputs_without_rerunning_filing", async () => {
  const repoPath = fs.mkdtempSync(path.join(os.tmpdir(), "ao1-intern-chat-"));
  const runId = "2026-06-15T165357-834Z";
  const outputRel = `runs/2026-06-15/${runId}/product-ideas-intern-agent-governance.md`;
  fs.mkdirSync(path.dirname(path.join(repoPath, outputRel)), { recursive: true });
  fs.writeFileSync(path.join(repoPath, outputRel), [
    "# Intern Agent Governance",
    "",
    "Target concept: product/ideas/intern-agent-governance.md",
    `Sync run: ${runId}`,
    "",
    "## Summary",
    "",
    "- AO1 should use Telegram to control the Intern instead of making users run npm commands.",
    "  - Classification: product/brand",
    "  - Kept because It updates the Intern user interface direction.",
    "",
    "## Evidence",
    "",
    "- message-1: whatsapp://chat/message-1"
  ].join("\n"));
  fs.mkdirSync(path.join(repoPath, ".ao1-intern"), { recursive: true });
  fs.writeFileSync(path.join(repoPath, ".ao1-intern", "checkpoint.json"), JSON.stringify({
    filed_runs: {
      [runId]: {
        status: "filed",
        at: "2026-06-15T17:10:00.000Z",
        outputs: [outputRel],
        kb_writes: []
      }
    }
  }, null, 2));

  const response = await handleInternChatMessage({
    message: {
      channel: "telegram",
      sender: "telegram:123456789",
      text: "what did you write?"
    },
    config: CHAT_CONFIG,
    repoPath,
    fileLatestSyncFn: () => {
      throw new Error("should not rerun filing");
    }
  });

  assert.equal(response.status, "ok");
  assert.equal(response.intent, "summarize-last-filing");
  assert.match(response.reply, new RegExp(runId));
  assert.match(response.reply, new RegExp(outputRel));
  assert.match(response.reply, /product\/ideas\/intern-agent-governance\.md/);
  assert.match(response.reply, /Telegram to control the Intern/);
  assert.match(response.reply, /KB writes: none/);
});

test("test_telegram_webhook_parses_text_messages_for_chat_dispatch", async () => {
  const payload = {
    update_id: 123,
    message: {
      message_id: 42,
      from: { id: 123456789, is_bot: false, first_name: "Magnus", username: "magnus" },
      chat: { id: 123456789, type: "private" },
      date: 1781517600,
      text: "review latest artifacts"
    }
  };

  assert.deepEqual(parseTelegramMessages(payload), [{
    channel: "telegram",
    sender: "telegram:123456789",
    chatId: 123456789,
    messageId: 42,
    timestamp: "1781517600",
    text: "review latest artifacts"
  }]);
});

test("test_telegram_webhook_verifies_secret_token_before_dispatch", async () => {
  const rawBody = JSON.stringify({ update_id: 1, message: { message_id: 1, from: { id: 123456789 }, chat: { id: 123456789 }, text: "status" } });
  const dispatched = [];

  const result = await handleTelegramWebhook({
    method: "POST",
    headers: { "x-telegram-bot-api-secret-token": "secret-token" },
    rawBody,
    secretToken: "secret-token",
    dispatchMessage: async (message) => {
      dispatched.push(message);
      return { reply: "Intern is healthy." };
    }
  });

  assert.equal(result.statusCode, 200);
  assert.equal(dispatched.length, 1);
  assert.equal(dispatched[0].sender, "telegram:123456789");
  assert.equal(verifyTelegramSecretToken({ headerValue: "secret-token", secretToken: "secret-token" }), true);
  assert.equal(verifyTelegramSecretToken({ headerValue: "bad", secretToken: "secret-token" }), false);
});

test("test_telegram_sender_posts_text_replies_without_persisting_tokens", async () => {
  const calls = [];
  const result = await sendTelegramText({
    chatId: 123456789,
    text: "AO1 Intern runtime is ready.",
    config: {
      bot_api_base_url: "https://api.telegram.test",
      bot_token_ref: "keychain://ao1-intern/telegram-bot-token"
    },
    secretProvider: {
      resolve: (ref) => {
        assert.equal(ref, "keychain://ao1-intern/telegram-bot-token");
        return "123456:TEST_TOKEN";
      }
    },
    fetchFn: async (url, options) => {
      calls.push({ url, options });
      return {
        ok: true,
        status: 200,
        json: async () => ({ ok: true, result: { message_id: 77 } })
      };
    }
  });

  assert.equal(result.status, "sent");
  assert.equal(result.messageId, 77);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.telegram.test/bot123456:TEST_TOKEN/sendMessage");
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    chat_id: 123456789,
    text: "AO1 Intern runtime is ready.",
    disable_web_page_preview: true
  });
});

test("test_telegram_bridge_verifies_secret_token_and_dispatches_chat_replies", async () => {
  const rawBody = JSON.stringify({
    update_id: 123,
    message: {
      message_id: 42,
      from: { id: 123456789, is_bot: false, first_name: "Magnus" },
      chat: { id: 123456789, type: "private" },
      text: "status"
    }
  });
  const sent = [];
  const server = createTelegramBridgeServer({
    config: {
      kb_path: "/tmp/ao1-kb",
      chat: {
        telegram: {
          webhook_path: "/webhook",
          allowed_senders: ["telegram:123456789"],
          webhook_secret_ref: "keychain://ao1-intern/telegram-webhook-secret"
        }
      }
    },
    repoPath: "/tmp/ao1-intern",
    secretProvider: {
      resolve: (ref) => ({
        "keychain://ao1-intern/telegram-webhook-secret": "secret-token"
      })[ref]
    },
    chatHandler: async (message) => {
      assert.equal(message.text, "status");
      return { status: "ok", reply: "AO1 Intern runtime is ready." };
    },
    sendTextFn: async ({ chatId, text }) => {
      sent.push({ chatId, text });
      return { status: "sent", messageId: 77 };
    }
  });

  const posted = await invokeServer(server, {
    method: "POST",
    url: "/webhook",
    headers: {
      "content-type": "application/json",
      "x-telegram-bot-api-secret-token": "secret-token"
    },
    body: rawBody
  });
  assert.equal(posted.statusCode, 200);
  assert.deepEqual(sent, [{
    chatId: 123456789,
    text: "AO1 Intern runtime is ready."
  }]);
});

test("test_telegram_polling_cycle_fetches_updates_dispatches_and_replies", async () => {
  const calls = [];
  const sent = [];
  const result = await runTelegramPollingCycle({
    config: {
      bot_api_base_url: "https://api.telegram.test",
      bot_token_ref: "keychain://ao1-intern/telegram-bot-token",
      poll_timeout_seconds: 0
    },
    secretProvider: {
      resolve: (ref) => {
        assert.equal(ref, "keychain://ao1-intern/telegram-bot-token");
        return "123456:TEST_TOKEN";
      }
    },
    offset: 10,
    fetchFn: async (url, options) => {
      calls.push({ url, options });
      return {
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          result: [{
            update_id: 12,
            message: {
              message_id: 42,
              from: { id: 123456789 },
              chat: { id: 123456789 },
              date: 1781517600,
              text: "status"
            }
          }]
        })
      };
    },
    dispatchMessage: async (message) => {
      assert.equal(message.sender, "telegram:123456789");
      return { status: "ok", reply: "AO1 Intern runtime is ready." };
    },
    sendTextFn: async ({ chatId, text }) => {
      sent.push({ chatId, text });
      return { status: "sent", messageId: 77 };
    }
  });

  assert.equal(result.nextOffset, 13);
  assert.equal(result.messages, 1);
  assert.equal(calls[0].url, "https://api.telegram.test/bot123456:TEST_TOKEN/getUpdates");
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    offset: 10,
    timeout: 0,
    allowed_updates: ["message", "edited_message"]
  });
  assert.deepEqual(sent, [{
    chatId: 123456789,
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
