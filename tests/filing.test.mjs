import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileLatestSync } from "../src/filing.mjs";
import { makeTempRepo, writeKbFixture, gitCommitCount } from "./helpers.mjs";

test("test_latest_sync_report_is_filed_once", () => {
  const { intern, kb } = makeTempRepo();
  const { runId } = writeKbFixture(kb);

  const result = fileLatestSync({ kbPath: kb, repoPath: intern });
  assert.equal(result.status, "filed");
  assert.equal(result.outputs.length, 1);
  assert.equal(gitCommitCount(intern), 1);

  const markdown = fs.readFileSync(result.outputs[0], "utf8");
  assert.match(markdown, /Owner: AO1/);
  assert.match(markdown, /Last reviewed:/);
  assert.match(markdown, /Sources: local-files:notes\/nemoclaw\.md/);
  assert.match(markdown, /Target concept: product\/ideas\/intern-agent-governance\.md/);
  assert.match(markdown, /KB Rules Consulted/);
  assert.match(markdown, /AGENTS\.md/);
  assert.match(markdown, /intended destination is the AO1 KB/);
  assert.doesNotMatch(markdown, /ao1-intern:curatable/);

  const second = fileLatestSync({ kbPath: kb, repoPath: intern });
  assert.equal(second.status, "already-filed");
  assert.equal(second.outputs.length, 0);
  assert.equal(gitCommitCount(intern), 1);

  const checkpoint = JSON.parse(fs.readFileSync(path.join(intern, ".ao1-intern", "checkpoint.json"), "utf8"));
  assert.equal(checkpoint.filed_runs[runId].status, "filed");
});

test("test_commit_policy_per_run_commits_each_successful_filing_run", () => {
  const { intern, kb } = makeTempRepo();
  writeKbFixture(kb, { runId: "2026-06-14T150003-175Z" });

  const first = fileLatestSync({ kbPath: kb, repoPath: intern, commitPolicy: "per-run" });
  assert.equal(first.status, "filed");
  assert.equal(first.commit.status, "committed");
  assert.equal(gitCommitCount(intern), 1);

  writeKbFixture(kb, { runId: "2026-06-15T080003-211Z" });
  const second = fileLatestSync({ kbPath: kb, repoPath: intern, commitPolicy: "per-run" });
  assert.equal(second.status, "filed");
  assert.equal(second.commit.status, "committed");
  assert.equal(gitCommitCount(intern), 2);

  const repeated = fileLatestSync({ kbPath: kb, repoPath: intern, commitPolicy: "per-run" });
  assert.equal(repeated.status, "already-filed");
  assert.equal(gitCommitCount(intern), 2);
});

test("test_commit_policy_manual_leaves_filed_outputs_uncommitted", () => {
  const { intern, kb } = makeTempRepo();
  writeKbFixture(kb);

  const result = fileLatestSync({ kbPath: kb, repoPath: intern, commitPolicy: "manual" });

  assert.equal(result.status, "filed");
  assert.equal(result.commit.status, "skipped");
  assert.equal(result.commit.reason, "manual-commit-policy");
  assert.equal(gitCommitCount(intern), 0);
  assert.equal(fs.existsSync(result.outputs[0]), true);
});

test("test_commit_policy_rejects_unknown_values", () => {
  const { intern, kb } = makeTempRepo();
  writeKbFixture(kb);

  assert.throws(() => fileLatestSync({
    kbPath: kb,
    repoPath: intern,
    commitPolicy: "daily"
  }), /Unsupported commit policy/);
});

test("test_no_filing_when_no_new_curatable_manifest_items", () => {
  const { intern, kb } = makeTempRepo();
  const { runId } = writeKbFixture(kb, { added: 0 });

  const result = fileLatestSync({ kbPath: kb, repoPath: intern });
  assert.equal(result.status, "no-curatable-items");
  assert.deepEqual(result.outputs, []);
  assert.equal(fs.existsSync(path.join(intern, "runs")), false);
  assert.equal(gitCommitCount(intern), 0);

  const checkpoint = JSON.parse(fs.readFileSync(path.join(intern, ".ao1-intern", "checkpoint.json"), "utf8"));
  assert.equal(checkpoint.filed_runs[runId].status, "no-curatable-items");
});

test("test_kb_write_back_is_disabled_without_permission_switch", () => {
  const { intern, kb } = makeTempRepo();
  writeKbFixture(kb);
  const target = path.join(kb, "product", "ideas", "intern-agent-governance.md");

  const result = fileLatestSync({
    kbPath: kb,
    repoPath: intern,
    commit: false,
    permissionsManifest: kbWriteManifest(kb, { enabled: false })
  });

  assert.equal(result.status, "filed");
  assert.deepEqual(result.kbWrites, []);
  assert.equal(fs.existsSync(target), false);
});

test("test_kb_write_back_requires_declared_kb_write_root", () => {
  const { intern, kb } = makeTempRepo();
  writeKbFixture(kb);

  assert.throws(() => fileLatestSync({
    kbPath: kb,
    repoPath: intern,
    commit: false,
    permissionsManifest: kbWriteManifest(kb, { enabled: true, writeRoots: [] })
  }), /Permission denied/);
});

test("test_kb_write_back_writes_concept_markdown_when_permission_switch_enabled", () => {
  const { intern, kb } = makeTempRepo();
  const { runId } = writeKbFixture(kb);
  const target = path.join(kb, "product", "ideas", "intern-agent-governance.md");
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, "# Existing Governance\n\nKeep this reviewed context.\n");

  const result = fileLatestSync({
    kbPath: kb,
    repoPath: intern,
    commit: false,
    permissionsManifest: kbWriteManifest(kb, { enabled: true })
  });

  assert.equal(result.status, "filed");
  assert.equal(result.kbWrites.length, 1);
  assert.equal(result.kbWrites[0].relativePath, "product/ideas/intern-agent-governance.md");
  assert.equal(result.kbWrites[0].mode, "appended");

  const kbMarkdown = fs.readFileSync(target, "utf8");
  assert.match(kbMarkdown, /Keep this reviewed context/);
  assert.match(kbMarkdown, new RegExp(`Intern Filing: ${runId}`));
  assert.match(kbMarkdown, /AO1 should test NemoClaw and OpenShell/);
  assert.match(kbMarkdown, /kb_write_enabled/);
  assert.doesNotMatch(kbMarkdown, /staged in the Intern repo/);
  assert.doesNotMatch(kbMarkdown, /ao1-intern:curatable/);

  const checkpoint = JSON.parse(fs.readFileSync(path.join(intern, ".ao1-intern", "checkpoint.json"), "utf8"));
  assert.deepEqual(checkpoint.filed_runs[runId].kb_writes, ["product/ideas/intern-agent-governance.md"]);
});

function kbWriteManifest(kb, { enabled, writeRoots = [kb] } = {}) {
  return {
    kb: {
      read: [kb],
      write: writeRoots,
      kb_write_enabled: enabled
    },
    ao1_repos: { read: [] },
    intern_repo: { read: [], write: [] },
    network: { allow: [] },
    tools: { allow: [], deny: [] }
  };
}
