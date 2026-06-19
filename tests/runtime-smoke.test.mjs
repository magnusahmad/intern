import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { runScheduledRuntimeSmoke, scheduledRuntimeEnv } from "../src/runtime-smoke.mjs";

const config = JSON.parse(fs.readFileSync("config/ao1-intern.example.json", "utf8"));
const manifest = JSON.parse(fs.readFileSync("config/permissions.example.json", "utf8"));

test("test_scheduled_runtime_smoke_runs_hermes_through_host_broker", () => {
  const calls = [];
  const result = runScheduledRuntimeSmoke({
    config,
    manifest,
    kbPath: "/Users/magnus/Documents/Projects/ao1-kb",
    repoPath: "/Users/magnus/Documents/Projects/ao1-intern",
    env: {
      HOME: "/Users/magnus",
      PATH: "/opt/homebrew/bin:/usr/bin:/bin"
    },
    execFile: (command, args, options) => {
      calls.push({ command, args, options });
      assert.deepEqual(options.env, {
        HOME: "/Users/magnus",
        PATH: "/opt/homebrew/bin:/usr/bin:/bin"
      });
      return "AO1_HERMES_SCHEDULE_SMOKE_OK\n";
    }
  });

  assert.equal(result.hermes.status, "ok");
  assert.equal(calls[0].command, "/Users/magnus/.local/bin/hermes");
});

test("test_scheduled_runtime_smoke_rejects_unexpected_hermes_output", () => {
  assert.throws(() => runScheduledRuntimeSmoke({
    config,
    manifest,
    kbPath: "/Users/magnus/Documents/Projects/ao1-kb",
    repoPath: "/Users/magnus/Documents/Projects/ao1-intern",
    env: scheduledRuntimeEnv({ HOME: "/Users/magnus", PATH: "/opt/homebrew/bin:/usr/bin:/bin" }),
    execFile: () => "unexpected"
  }), /scheduled runtime smoke/i);
});

test("test_scheduled_runtime_env_includes_configured_ca_bundle", () => {
  assert.deepEqual(scheduledRuntimeEnv({
    HOME: "/Users/magnus",
    PATH: "/opt/homebrew/bin:/usr/bin:/bin"
  }, config), {
    HOME: "/Users/magnus",
    PATH: "/opt/homebrew/bin:/usr/bin:/bin",
    SSL_CERT_FILE: "/opt/homebrew/etc/openssl@3/cert.pem"
  });
});
