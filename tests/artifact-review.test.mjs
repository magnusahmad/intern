import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { execFileSync } from "node:child_process";
import { reviewArtifacts } from "../src/artifact-review.mjs";
import { writePolicyArtifacts } from "../src/policy.mjs";
import { generateScheduleArtifacts } from "../src/scheduler.mjs";
import { makeTempRepo, writeKbFixture } from "./helpers.mjs";

const manifest = JSON.parse(fs.readFileSync("config/permissions.example.json", "utf8"));
const config = JSON.parse(fs.readFileSync("config/ao1-intern.example.json", "utf8"));

test("test_review_artifacts_reports_manual_install_readiness", () => {
  const { intern, kb } = makeTempRepo();
  writeKbFixture(kb);
  writePolicyArtifacts({
    manifest: manifestForTempRepo({ intern, kb }),
    config,
    outDir: path.join(intern, ".ao1-intern", "policies")
  });
  generateScheduleArtifacts({
    kbPath: kb,
    repoPath: intern,
    configPath: path.join(intern, "config", "ao1-intern.example.json"),
    config
  });

  const result = reviewArtifacts({ repoPath: intern, kbPath: kb, config });

  assert.equal(result.status, "passed");
  assert.equal(result.checks.every((check) => check.status === "passed"), true);
  assert.equal(result.checks.some((check) => check.name === "schedule artifact: com.ao1.intern.observer.plist"), true);
  assert.equal(result.checks.some((check) => check.name === "observer LaunchAgent sandbox profile"), true);
  assert.equal(result.checks.some((check) => check.name === "observer LaunchAgent direct sandbox command"), true);
  assert.equal(result.checks.some((check) => check.name === "observer LaunchAgent environment"), true);
  assert.equal(result.checks.some((check) => check.name === "observer LaunchAgent schedule"), true);
  assert.equal(result.checks.some((check) => check.name === "schedule install documents macOS TCC"), true);
  assert.deepEqual(result.manualNextSteps, [
    "Review generated artifacts with a human before installing them.",
    "Start or install the OpenShell gateway LaunchAgent manually.",
    "Install the reviewed scheduler manually.",
    "Observe the first unattended dogfood run."
  ]);
});

test("test_review_artifacts_fails_closed_when_artifacts_drift", () => {
  const { intern, kb } = makeTempRepo();
  writeKbFixture(kb);
  writePolicyArtifacts({
    manifest: manifestForTempRepo({ intern, kb }),
    config,
    outDir: path.join(intern, ".ao1-intern", "policies")
  });
  generateScheduleArtifacts({
    kbPath: kb,
    repoPath: intern,
    configPath: path.join(intern, "config", "ao1-intern.example.json"),
    config
  });
  const brokerPolicyPath = path.join(intern, ".ao1-intern", "policies", "host-broker-policy.json");
  const brokerPolicy = JSON.parse(fs.readFileSync(brokerPolicyPath, "utf8"));
  brokerPolicy.filesystem.kb_write_enabled = true;
  brokerPolicy.tools.codex.sandbox = "workspace-write";
  fs.writeFileSync(brokerPolicyPath, `${JSON.stringify(brokerPolicy, null, 2)}\n`);

  const result = reviewArtifacts({ repoPath: intern, kbPath: kb, config });

  assert.equal(result.status, "failed");
  assert.equal(result.checks.some((check) => check.status === "failed" && /KB write/.test(check.detail)), true);
  assert.equal(result.checks.some((check) => check.status === "failed" && /read-only/.test(check.detail)), true);
});

test("test_review_artifacts_cli_exits_nonzero_on_failed_review", () => {
  const { intern, kb } = makeTempRepo();
  writeKbFixture(kb);
  writePolicyArtifacts({
    manifest: manifestForTempRepo({ intern, kb }),
    config,
    outDir: path.join(intern, ".ao1-intern", "policies")
  });
  generateScheduleArtifacts({
    kbPath: kb,
    repoPath: intern,
    configPath: path.join(intern, "config", "ao1-intern.example.json"),
    config
  });
  fs.writeFileSync(path.join(intern, ".ao1-intern", "policies", "host-broker-policy.json"), "{}\n");

  assert.throws(() => execFileSync(process.execPath, [
    path.resolve("src/cli.mjs"),
    "review-artifacts",
    "--kb",
    kb
  ], {
    cwd: intern,
    encoding: "utf8"
  }), /Command failed/);
});

function manifestForTempRepo({ intern, kb }) {
  return {
    ...manifest,
    kb: {
      ...manifest.kb,
      read: [kb],
      write: [],
      kb_write_enabled: false
    },
    ao1_repos: {
      read: [kb, intern]
    },
    intern_repo: {
      read: [intern],
      write: [
        path.join(intern, "runs"),
        path.join(intern, ".ao1-intern")
      ]
    }
  };
}
