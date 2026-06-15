import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
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
  assert.match(markdown, /product\/ideas\.md/);
  assert.match(markdown, /shared\/source-map\/index\.md/);
  assert.match(markdown, /intended destination is the AO1 KB/);
  assert.doesNotMatch(markdown, /ao1-intern:curatable/);

  const second = fileLatestSync({ kbPath: kb, repoPath: intern });
  assert.equal(second.status, "already-filed");
  assert.equal(second.outputs.length, 0);
  assert.equal(gitCommitCount(intern), 1);

  const checkpoint = JSON.parse(fs.readFileSync(path.join(intern, ".ao1-intern", "checkpoint.json"), "utf8"));
  assert.equal(checkpoint.filed_runs[runId].status, "filed");
});

test("test_filed_record_links_back_to_source_evidence", () => {
  const { intern, kb } = makeTempRepo();
  const { runId } = writeKbFixture(kb);

  const result = fileLatestSync({ kbPath: kb, repoPath: intern, commit: false });

  assert.equal(result.status, "filed");
  const markdown = fs.readFileSync(result.outputs[0], "utf8");
  assert.match(markdown, new RegExp(`Sync run: ${runId}`));
  assert.match(markdown, /Raw manifest: .*\/manifest\.json/);
  assert.match(markdown, /Connector: local-files/);
  assert.match(markdown, /Curation reason: scheduled-resync/);
  assert.match(markdown, /## Evidence/);
  assert.match(markdown, /notes\/nemoclaw\.md: file:\/\/\/notes\/nemoclaw\.md/);

  const checkpoint = JSON.parse(fs.readFileSync(path.join(intern, ".ao1-intern", "checkpoint.json"), "utf8"));
  assert.match(checkpoint.filed_runs[runId].manifest_path, /\/manifest\.json$/);
  assert.deepEqual(checkpoint.filed_runs[runId].outputs, [
    path.relative(intern, result.outputs[0])
  ]);
});

test("test_filed_items_are_committed_automatically", () => {
  const { intern, kb } = makeTempRepo();
  const { runId } = writeKbFixture(kb);

  const result = fileLatestSync({ kbPath: kb, repoPath: intern });

  assert.equal(result.status, "filed");
  assert.equal(result.commit.status, "committed");
  assert.equal(gitCommitCount(intern), 1);
  assert.equal(
    execFileSync("git", ["log", "-1", "--pretty=%s"], { cwd: intern, encoding: "utf8" }).trim(),
    `File AO1 intern sync ${runId}`
  );
  assert.equal(execFileSync("git", ["status", "--short", ...result.outputs.map((file) => path.relative(intern, file))], {
    cwd: intern,
    encoding: "utf8"
  }).trim(), "");
});

test("test_filed_markdown_follows_kb_rules", () => {
  const { intern, kb } = makeTempRepo();
  writeKbFixture(kb);

  const result = fileLatestSync({ kbPath: kb, repoPath: intern, commit: false });

  assert.equal(result.status, "filed");
  const markdown = fs.readFileSync(result.outputs[0], "utf8");
  assert.match(markdown, /Owner: AO1/);
  assert.match(markdown, /Last reviewed:/);
  assert.match(markdown, /Sources: local-files:notes\/nemoclaw\.md/);
  assert.match(markdown, /Related: product\/ideas/);
  assert.match(markdown, /Target concept: product\/ideas\/intern-agent-governance\.md/);
  assert.match(markdown, /## KB Rules Consulted/);
  assert.match(markdown, /- AGENTS\.md/);
  assert.match(markdown, /- README\.md/);
  assert.match(markdown, /- index\.md/);
  assert.match(markdown, /- product\/ideas\.md/);
  assert.match(markdown, /- shared\/source-map\/index\.md/);
  assert.doesNotMatch(markdown, /ao1-intern:curatable/);
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

test("test_latest_filing_uses_latest_curated_nonempty_manifest_from_batch", () => {
  const { intern, kb } = makeTempRepo();
  writeKbFixture(kb, { runId: "2026-06-15T150000-982Z", added: 0 });
  const curatedRunId = "2026-06-15T165357-834Z";
  const emptyRunId = "2026-06-15T165741-786Z";
  const uncuratedRunId = "2026-06-15T180001-984Z";
  writeRawRun(kb, {
    connectorId: "whatsapp",
    runId: curatedRunId,
    item: {
      source: "whatsapp",
      source_item_id: "message-1",
      source_url: "whatsapp://chat/message-1",
      content_type: "text",
      title: "Mobile-to-CLI Intern follow-up",
      curatable: true,
      body_text: "AO1 should use Telegram to control the Intern instead of making users run npm commands."
    }
  });
  writeRawRun(kb, {
    connectorId: "whatsapp",
    runId: emptyRunId,
    itemCount: 0,
    itemPaths: []
  });
  writeRawRun(kb, {
    connectorId: "local-files",
    runId: uncuratedRunId,
    item: {
      source: "local-files",
      source_item_id: "docs/status.md",
      source_url: "file:///docs/status.md",
      content_type: "md",
      title: "Later uncurated sync",
      curatable: true,
      body_text: "This later sync has not been curated yet."
    }
  });
  fs.writeFileSync(path.join(kb, ".ao1", "job-history.jsonl"), [
    JSON.stringify({ type: "sync", connector_id: "local-files", run_id: "2026-06-15T150000-982Z", item_count: 1, at: "2026-06-15T15:00:01.115Z" }),
    JSON.stringify({ type: "curate", reason: "scheduled-resync", manifest_count: 1, added: 0, pruned: 1, at: "2026-06-15T15:00:01.181Z" }),
    JSON.stringify({ type: "sync", connector_id: "whatsapp", run_id: curatedRunId, item_count: 1, at: "2026-06-15T16:54:28.279Z" }),
    JSON.stringify({ type: "sync", connector_id: "whatsapp", run_id: emptyRunId, item_count: 0, at: "2026-06-15T16:58:13.104Z" }),
    JSON.stringify({ type: "curate", reason: "manual-curate", manifest_count: 2, added: 2, pruned: 9, at: "2026-06-15T16:59:56.269Z" }),
    JSON.stringify({ type: "sync", connector_id: "local-files", run_id: uncuratedRunId, item_count: 1, at: "2026-06-15T18:00:02.140Z" })
  ].join("\n") + "\n");

  const result = fileLatestSync({ kbPath: kb, repoPath: intern, commit: false });

  assert.equal(result.status, "filed");
  assert.equal(result.runId, curatedRunId);
  assert.equal(result.outputs.length, 1);
  assert.match(fs.readFileSync(result.outputs[0], "utf8"), /Telegram to control the Intern/);
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

function writeRawRun(kb, { connectorId, runId, item, itemCount = 1, itemPaths = ["items/item.json"] }) {
  const runDir = path.join(kb, ".ao1", "raw", "clients", "ao1", "connectors", connectorId, "runs", runId);
  fs.mkdirSync(path.join(runDir, "items"), { recursive: true });
  fs.writeFileSync(path.join(runDir, "manifest.json"), JSON.stringify({
    client_id: "ao1",
    connector_id: connectorId,
    run_id: runId,
    status: "succeeded",
    item_count: itemCount,
    item_paths: itemPaths
  }, null, 2));
  if (item) {
    fs.writeFileSync(path.join(runDir, "items", "item.json"), JSON.stringify(item, null, 2));
  }
}
