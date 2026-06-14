import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

export function makeTempRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "ao1-intern-test-"));
  const intern = path.join(root, "ao1-intern");
  const kb = path.join(root, "ao1-kb");
  fs.mkdirSync(intern, { recursive: true });
  fs.mkdirSync(kb, { recursive: true });
  execFileSync("git", ["init"], { cwd: intern, stdio: "pipe" });
  execFileSync("git", ["config", "user.email", "ao1-intern@example.com"], { cwd: intern });
  execFileSync("git", ["config", "user.name", "AO1 Intern Tests"], { cwd: intern });
  return { root, intern, kb };
}

export function writeKbFixture(kb, { runId = "2026-06-14T150003-175Z", added = 1, curatable = true } = {}) {
  fs.mkdirSync(path.join(kb, ".ao1", "raw", "clients", "ao1", "connectors", "local-files", "runs", runId, "items"), { recursive: true });
  fs.mkdirSync(path.join(kb, ".ao1", "reports"), { recursive: true });
  fs.writeFileSync(path.join(kb, "AGENTS.md"), [
    "# AGENTS.md",
    "",
    "- Keep prose economical and information-dense.",
    "- Use concept folders for AO1. Do not add department/team folders unless explicitly asked.",
    "- Preserve each curated page's owner, review date, sources, and related links."
  ].join("\n"));
  fs.writeFileSync(path.join(kb, "README.md"), [
    "# AO1 Knowledge Base",
    "",
    "## Page Standard",
    "",
    "Every curated page should include Owner, Last reviewed, Sources, and Related.",
    "Do not paste full transcripts, email threads, or message dumps into the KB."
  ].join("\n"));
  fs.writeFileSync(path.join(kb, "index.md"), "# AO1 Internal Knowledge Base\n\nRelated: [Product Ideas](product/ideas.md)\n");
  fs.writeFileSync(path.join(kb, ".ao1", "config.json"), JSON.stringify({
    client_id: "ao1",
    schedule: { cron: "0 8,11,14,17,20 * * *" }
  }, null, 2));
  fs.writeFileSync(path.join(kb, ".ao1", "job-history.jsonl"), [
    JSON.stringify({ type: "sync", connector_id: "local-files", run_id: runId, item_count: 1, at: "2026-06-14T15:00:03.306Z" }),
    JSON.stringify({ type: "curate", reason: "scheduled-resync", manifest_count: 1, added, pruned: added ? 0 : 1, at: "2026-06-14T15:00:03.377Z" })
  ].join("\n") + "\n");
  const runDir = path.join(kb, ".ao1", "raw", "clients", "ao1", "connectors", "local-files", "runs", runId);
  fs.writeFileSync(path.join(runDir, "manifest.json"), JSON.stringify({
    client_id: "ao1",
    connector_id: "local-files",
    run_id: runId,
    status: "succeeded",
    item_count: 1,
    item_paths: ["items/nemoclaw-note.json"]
  }, null, 2));
  fs.writeFileSync(path.join(runDir, "items", "nemoclaw-note.json"), JSON.stringify({
    source: "local-files",
    source_item_id: "notes/nemoclaw.md",
    source_url: "file:///notes/nemoclaw.md",
    content_type: "md",
    title: "NemoClaw Intern Governance",
    curatable,
    body_text: [
      "# NemoClaw Intern Governance",
      "",
      "ao1-intern:curatable",
      "",
      "AO1 should test NemoClaw and OpenShell as an Intern governance layer for Hermes and Codex orchestration.",
      "This is product/brand context, not raw sync noise."
    ].join("\n")
  }, null, 2));
  fs.writeFileSync(path.join(kb, ".ao1", "reports", "latest-agent-report.md"), `# Latest KB Agent Report\n\nRun: ${runId}\nCurated items: ${added}\n`);
  return { runId };
}

export function gitCommitCount(repo) {
  try {
    return Number(execFileSync("git", ["rev-list", "--count", "HEAD"], { cwd: repo, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim());
  } catch {
    return 0;
  }
}
