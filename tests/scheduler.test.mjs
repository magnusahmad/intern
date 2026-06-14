import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { generateScheduleArtifacts, observerCronForKb } from "../src/scheduler.mjs";
import { fileLatestSync } from "../src/filing.mjs";
import { makeTempRepo, writeKbFixture } from "./helpers.mjs";

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
  assert.match(fs.readFileSync(result.installPath, "utf8"), /Manual installation only/);
  assert.match(fs.readFileSync(result.installPath, "utf8"), /crontab/);
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
