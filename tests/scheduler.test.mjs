import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { generateScheduleArtifacts, observerCronForKb } from "../src/scheduler.mjs";
import { fileLatestSync } from "../src/filing.mjs";
import { makeTempRepo, writeKbFixture, gitCommitCount } from "./helpers.mjs";

const runtimeConfig = JSON.parse(fs.readFileSync("config/ao1-intern.example.json", "utf8"));

test("test_schedule_parity_with_kb_cron", () => {
  const { kb } = makeTempRepo();
  writeKbFixture(kb);
  assert.equal(observerCronForKb(kb), "0 8,11,14,17,20 * * *");
});

test("test_scheduler_install_outputs_manual_instructions_without_mutating_crontab", () => {
  const { intern, kb } = makeTempRepo();
  writeKbFixture(kb);
  const before = safeCrontab();
  const result = generateScheduleArtifacts({
    kbPath: kb,
    repoPath: intern,
    configPath: path.join(intern, "config", "ao1-intern.example.json")
  });
  const after = safeCrontab();

  assert.equal(after, before);
  assert.match(fs.readFileSync(result.cronPath, "utf8"), /file-latest-sync --kb/);
  assert.match(fs.readFileSync(result.cronPath, "utf8"), /--config/);
  assert.match(fs.readFileSync(result.cronPath, "utf8"), /HOME=/);
  assert.match(fs.readFileSync(result.cronPath, "utf8"), /PATH=/);
  const install = fs.readFileSync(result.installPath, "utf8");
  assert.match(install, /Manual installation only/);
  assert.match(install, /merge/i);
  assert.match(install, /crontab -l/);
  assert.doesNotMatch(install, new RegExp(`crontab ${escapeRegExp(result.cronPath)}`));
});

test("test_scheduler_wraps_default_runtime_with_macos_sandbox_profile", () => {
  const { intern, kb } = makeTempRepo();
  writeKbFixture(kb);
  const result = generateScheduleArtifacts({
    kbPath: kb,
    repoPath: intern,
    configPath: path.join(intern, "config", "ao1-intern.example.json"),
    config: runtimeConfig
  });
  const cron = fs.readFileSync(result.cronPath, "utf8");

  assert.match(cron, /SSL_CERT_FILE=/);
  assert.match(cron, /sandbox-exec -f/);
  assert.match(cron, /\.ao1-intern\/policies\/host-broker\.sb/);
  assert.match(cron, /\/opt\/homebrew\/bin\/npm'? run intern -- file-latest-sync/);
  assert.match(fs.readFileSync(result.installPath, "utf8"), /policy-artifacts/);
});

test("test_manual_trigger_processes_latest_sync_without_cron", () => {
  const { intern, kb } = makeTempRepo();
  writeKbFixture(kb);
  const result = execFileSync(process.execPath, [path.resolve("src/cli.mjs"), "file-latest-sync", "--kb", kb, "--commit", "false"], {
    cwd: intern,
    encoding: "utf8"
  });
  assert.match(result, /"status": "filed"/);
});

test("test_manual_trigger_honors_commit_policy_manual", () => {
  const { intern, kb } = makeTempRepo();
  writeKbFixture(kb);
  const result = execFileSync(process.execPath, [
    path.resolve("src/cli.mjs"),
    "file-latest-sync",
    "--kb",
    kb,
    "--commit-policy",
    "manual"
  ], {
    cwd: intern,
    encoding: "utf8"
  });

  assert.match(result, /"status": "filed"/);
  assert.match(result, /"manual-commit-policy"/);
  assert.equal(gitCommitCount(intern), 0);
});

test("test_scheduler_lock_prevents_overlapping_runs", () => {
  const { intern, kb } = makeTempRepo();
  writeKbFixture(kb);
  const lockDir = path.join(intern, ".ao1-intern", "locks");
  fs.mkdirSync(lockDir, { recursive: true });
  fs.writeFileSync(path.join(lockDir, "scheduler.lock"), "123\n");
  const result = fileLatestSync({ kbPath: kb, repoPath: intern, commit: false });
  assert.equal(result.status, "already-running");
});

function safeCrontab() {
  try {
    return execFileSync("crontab", ["-l"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return "";
  }
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
