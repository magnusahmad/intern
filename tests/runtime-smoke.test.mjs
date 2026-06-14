import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { runScheduledRuntimeSmoke, scheduledRuntimeEnv } from "../src/runtime-smoke.mjs";

const config = JSON.parse(fs.readFileSync("config/ao1-intern.example.json", "utf8"));
const manifest = JSON.parse(fs.readFileSync("config/permissions.example.json", "utf8"));

test("test_scheduled_runtime_smoke_uses_cron_like_env_and_host_broker", () => {
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
      return command === "codex" ? "AO1_CODEX_SCHEDULE_SMOKE_OK\n" : "AO1_HERMES_SCHEDULE_SMOKE_OK\n";
    }
  });

  assert.equal(result.codex.status, "ok");
  assert.equal(result.hermes.status, "ok");
  assert.equal(calls[0].command, "codex");
  assert.equal(calls[1].command, "/Users/magnus/.local/bin/hermes");
});

test("test_scheduled_runtime_smoke_rejects_unexpected_model_output", () => {
  assert.throws(() => runScheduledRuntimeSmoke({
    config,
    manifest,
    kbPath: "/Users/magnus/Documents/Projects/ao1-kb",
    repoPath: "/Users/magnus/Documents/Projects/ao1-intern",
    env: scheduledRuntimeEnv({ HOME: "/Users/magnus", PATH: "/opt/homebrew/bin:/usr/bin:/bin" }),
    execFile: () => "unexpected"
  }), /scheduled runtime smoke/i);
});
