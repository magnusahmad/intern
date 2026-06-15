import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { validatePermission } from "../src/permissions.mjs";
import { assertNoSecretsInFiles, assertNoSecretsInText, FakeSecretProvider, keychainServiceForRef } from "../src/secrets.mjs";

const manifest = JSON.parse(fs.readFileSync("config/permissions.example.json", "utf8"));

test("test_permission_manifest_blocks_undeclared_access", () => {
  assert.equal(validatePermission(manifest, { type: "file-read", path: "/Users/magnus/Documents/Projects/ao1-kb/.ao1/raw/x.json" }), true);
  assert.equal(validatePermission(manifest, { type: "file-read", path: "/Users/magnus/Documents/Private/not-ao1.txt" }), false);
  assert.equal(validatePermission(manifest, { type: "file-write", path: "/Users/magnus/Documents/Projects/ao1-intern/runs/x.md" }), true);
  assert.equal(validatePermission(manifest, { type: "file-write", kbWrite: true, path: "/Users/magnus/Documents/Projects/ao1-kb/product/x.md" }), false);
  assert.equal(validatePermission(manifest, { type: "network", target: "github.com:read" }), true);
  assert.equal(validatePermission(manifest, { type: "network", target: "slack.com:write" }), false);
  assert.equal(validatePermission(manifest, { type: "tool", tool: "codex-exec" }), true);
  assert.equal(validatePermission(manifest, { type: "tool", tool: "shell-unrestricted" }), true);
  assert.equal(validatePermission(manifest, { type: "tool", tool: "unreviewed-tool" }), false);
});

test("test_committed_config_contains_no_secret_values", () => {
  assertNoSecretsInFiles(["config/permissions.example.json", "config/ao1-intern.example.json"]);
  assert.throws(() => assertNoSecretsInText('{"api_key":"sk-test_abcdefghijklmnopqrstuvwxyz"}'), /Secret-like/);
});

test("test_runtime_env_resolves_secret_refs_without_persisting_values", () => {
  const provider = new FakeSecretProvider({
    "keychain://ao1-intern/model-provider": "sk-test_abcdefghijklmnopqrstuvwxyz"
  });
  assert.equal(provider.resolve("keychain://ao1-intern/model-provider"), "sk-test_abcdefghijklmnopqrstuvwxyz");
  assertNoSecretsInFiles(["config/ao1-intern.example.json"]);
});

test("test_keychain_refs_map_to_generic_password_services", () => {
  assert.equal(
    keychainServiceForRef("keychain://ao1-intern/telegram-bot-token"),
    "ao1-intern/telegram-bot-token"
  );
  assert.throws(() => keychainServiceForRef("env://TELEGRAM_BOT_TOKEN"), /Unsupported secret ref/);
});
