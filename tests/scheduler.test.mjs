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
  assert.match(fs.readFileSync(result.cronPath, "utf8"), /file-latest-sync/);
  assert.match(fs.readFileSync(result.cronPath, "utf8"), /--repo/);
  assert.match(fs.readFileSync(result.cronPath, "utf8"), /--kb/);
  assert.match(fs.readFileSync(result.cronPath, "utf8"), /--config/);
  assert.match(fs.readFileSync(result.cronPath, "utf8"), /HOME=/);
  assert.match(fs.readFileSync(result.cronPath, "utf8"), /PATH=/);
  const install = fs.readFileSync(result.installPath, "utf8");
  assert.match(install, /Manual installation only/);
  assert.match(install, /merge/i);
  assert.match(install, /crontab -l/);
  assert.doesNotMatch(install, new RegExp(`crontab ${escapeRegExp(result.cronPath)}`));
});

test("test_scheduler_outputs_reviewed_launchagent_without_installing_it", () => {
  const { intern, kb } = makeTempRepo();
  writeKbFixture(kb);
  const result = generateScheduleArtifacts({
    kbPath: kb,
    repoPath: intern,
    configPath: path.join(intern, "config", "ao1-intern.example.json"),
    config: runtimeConfig
  });
  const plist = fs.readFileSync(result.launchAgentPath, "utf8");

  assert.match(plist, /com\.ao1\.intern\.observer/);
  assert.match(plist, /StartCalendarInterval/);
  assert.match(plist, new RegExp(`<string>${escapeRegExp(runtimeConfig.runtime.macos_sandbox.launch_agent_working_directory)}</string>`));
  for (const hour of [8, 11, 14, 17, 20]) {
    assert.match(plist, new RegExp(`<integer>${hour}</integer>`));
  }
  assert.match(plist, /sandbox-exec/);
  assert.match(plist, new RegExp(escapeRegExp(runtimeConfig.runtime.macos_sandbox.launch_agent_profile_path)));
  assert.match(plist, /EnvironmentVariables/);
  assert.match(plist, /<key>HOME<\/key>/);
  assert.match(plist, /<key>PATH<\/key>/);
  assert.match(plist, /<key>SSL_CERT_FILE<\/key>/);
  assert.match(plist, /<key>TMPDIR<\/key>/);
  assert.match(plist, /<key>USER<\/key>/);
  assert.match(plist, /<key>LOGNAME<\/key>/);
  assert.match(plist, /<key>SHELL<\/key>/);
  assert.match(plist, /<string>\/usr\/bin\/sandbox-exec<\/string>/);
  assert.doesNotMatch(plist, /<array>\s*<string>\/bin\/zsh<\/string>/);
  assert.doesNotMatch(plist, /<string>-lc<\/string>/);
  assert.match(plist, /file-latest-sync/);
  assert.match(plist, /src\/cli\.mjs/);
  assert.match(plist, /--repo/);
  assert.match(plist, new RegExp(escapeRegExp(intern)));
  assert.doesNotMatch(plist, /cd &apos;/);
  assert.doesNotMatch(plist, /run intern/);
  assert.match(plist, /ao1-intern\.example\.json/);
  assert.match(plist, /\.ao1-intern\/logs\/observer\.out\.log/);
  assert.match(plist, /\.ao1-intern\/logs\/observer\.err\.log/);
  assert.match(fs.readFileSync(result.installPath, "utf8"), /launchctl bootstrap/);
  assert.match(fs.readFileSync(result.installPath, "utf8"), /launchd-preflight/);
  assert.match(fs.readFileSync(result.installPath, "utf8"), /one-shot launchd Node read probe/);
  assert.match(fs.readFileSync(result.installPath, "utf8"), /launch_agent_profile_path/);
  assert.match(fs.readFileSync(result.installPath, "utf8"), new RegExp(escapeRegExp(runtimeConfig.runtime.macos_sandbox.launch_agent_profile_path)));
  assert.match(fs.readFileSync(result.installPath, "utf8"), /Full Disk Access/);
  assert.match(fs.readFileSync(result.installPath, "utf8"), new RegExp(escapeRegExp(runtimeConfig.runtime.macos_sandbox.node_command)));
  assert.match(fs.readFileSync(result.installPath, "utf8"), /not run by the generator/);
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
  assert.match(cron, /sandbox-exec/);
  assert.match(cron, /-f/);
  assert.match(cron, new RegExp(escapeRegExp(runtimeConfig.runtime.macos_sandbox.launch_agent_profile_path)));
  assert.match(cron, /\/opt\/homebrew\/bin\/node/);
  assert.match(cron, /src\/cli\.mjs/);
  assert.match(cron, /file-latest-sync/);
  assert.match(cron, /--repo/);
  assert.match(cron, new RegExp(escapeRegExp(intern)));
  assert.doesNotMatch(cron, /run intern -- file-latest-sync/);
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

test("test_manual_trigger_accepts_explicit_repo_path_from_outside_repo", () => {
  const { intern, kb } = makeTempRepo();
  writeKbFixture(kb);
  const result = execFileSync(process.execPath, [
    path.resolve("src/cli.mjs"),
    "file-latest-sync",
    "--kb",
    kb,
    "--repo",
    intern,
    "--commit",
    "false"
  ], {
    cwd: path.dirname(intern),
    encoding: "utf8"
  });
  const parsed = JSON.parse(result);

  assert.equal(parsed.status, "filed");
  assert.equal(parsed.outputs.every((output) => output.startsWith(intern)), true);
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
