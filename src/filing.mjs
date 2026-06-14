import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { safeSlug, writeJson, readJson } from "./fs-util.mjs";
import { findLatestSyncRun, hasNewCuratedItems, loadRunManifest } from "./kb-sync.mjs";
import { loadKbRules } from "./kb-rules.mjs";
import { heuristicClassifyItems, validateClassifiedItems } from "./classifier.mjs";

export function fileLatestSync({
  kbPath,
  repoPath = process.cwd(),
  stateDir = path.join(repoPath, ".ao1-intern"),
  runsDir = path.join(repoPath, "runs"),
  runId = null,
  commit = true,
  classifier = heuristicClassifyItems
}) {
  const checkpointPath = path.join(stateDir, "checkpoint.json");
  const lock = acquireLock(stateDir);
  if (!lock.acquired) {
    return { status: "already-running", runId: null, outputs: [] };
  }

  try {
    const checkpoint = loadCheckpoint(checkpointPath);
    const { sync, curate } = findLatestSyncRun(kbPath, runId);

    if (checkpoint.filed_runs?.[sync.run_id]) {
      return { status: "already-filed", runId: sync.run_id, outputs: [] };
    }

    if (!hasNewCuratedItems(curate)) {
      checkpoint.filed_runs[sync.run_id] = {
        status: "no-curatable-items",
        at: new Date().toISOString()
      };
      writeJson(checkpointPath, checkpoint);
      return { status: "no-curatable-items", runId: sync.run_id, outputs: [] };
    }

    const rules = loadKbRules(kbPath);
    const { manifestPath, manifest, items } = loadRunManifest(kbPath, sync);
    const classified = validateClassifiedItems(classifier({ items, rules, manifest, sync, curate }));
    if (!classified.length) {
      checkpoint.filed_runs[sync.run_id] = {
        status: "no-curatable-items",
        at: new Date().toISOString(),
        manifest_path: manifestPath
      };
      writeJson(checkpointPath, checkpoint);
      return { status: "no-curatable-items", runId: sync.run_id, outputs: [] };
    }

    const grouped = groupByConcept(classified);
    const date = sync.run_id.slice(0, 10);
    const outputRoot = path.join(runsDir, date, sync.run_id);
    fs.mkdirSync(outputRoot, { recursive: true });
    const outputs = [];
    for (const [conceptPath, conceptItems] of grouped.entries()) {
      const file = path.join(outputRoot, `${safeSlug(conceptPath.replace(/\.md$/, ""))}.md`);
      fs.writeFileSync(file, renderConceptMarkdown({ conceptPath, items: conceptItems, sync, curate, manifest, manifestPath, rules }));
      outputs.push(file);
    }

    checkpoint.filed_runs[sync.run_id] = {
      status: "filed",
      at: new Date().toISOString(),
      outputs: outputs.map((file) => path.relative(repoPath, file)),
      manifest_path: manifestPath
    };
    writeJson(checkpointPath, checkpoint);

    let commitResult = null;
    if (commit) {
      commitResult = commitOutputs(repoPath, outputs);
    }

    return { status: "filed", runId: sync.run_id, outputs, commit: commitResult };
  } finally {
    releaseLock(lock);
  }
}

function acquireLock(stateDir) {
  const lockDir = path.join(stateDir, "locks");
  const lockPath = path.join(lockDir, "scheduler.lock");
  fs.mkdirSync(lockDir, { recursive: true });
  try {
    const fd = fs.openSync(lockPath, "wx");
    fs.writeFileSync(fd, `${process.pid}\n`);
    fs.closeSync(fd);
    return { acquired: true, path: lockPath };
  } catch (error) {
    if (error.code === "EEXIST") return { acquired: false, path: lockPath };
    throw error;
  }
}

function releaseLock(lock) {
  if (!lock.acquired) return;
  try {
    fs.unlinkSync(lock.path);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

function loadCheckpoint(file) {
  if (!fs.existsSync(file)) return { filed_runs: {} };
  const parsed = readJson(file);
  return { filed_runs: {}, ...parsed };
}

function groupByConcept(items) {
  const grouped = new Map();
  for (const item of items) {
    const existing = grouped.get(item.conceptPath) || [];
    existing.push(item);
    grouped.set(item.conceptPath, existing);
  }
  return grouped;
}

function renderConceptMarkdown({ conceptPath, items, sync, curate, manifest, manifestPath, rules }) {
  const sources = items.map(({ item }) => `${item.source || "unknown"}:${item.source_item_id || item.title || "unknown"}`);
  const related = conceptPath.split("/").slice(0, -1).join("/") || "shared";
  const body = [
    `# ${titleFromConcept(conceptPath)}`,
    "",
    "Owner: AO1",
    `Last reviewed: ${new Date().toISOString().slice(0, 10)}`,
    `Sources: ${sources.join(", ")}`,
    `Related: ${related}`,
    "",
    `Target concept: ${conceptPath}`,
    `Sync run: ${sync.run_id}`,
    `Raw manifest: ${manifestPath}`,
    `Connector: ${manifest.connector_id}`,
    `Curation reason: ${curate?.reason || "unknown"}`,
    "",
    "## Summary",
    "",
    ...items.flatMap((entry) => [`- ${entry.summary}`, `  - Classification: ${entry.classification}`, `  - Kept because ${entry.keptReason || "the classifier selected it."}`]),
    "",
    "## Evidence",
    "",
    ...items.map(({ item }) => `- ${item.source_item_id || item.title}: ${item.source_url || "no source URL"}`),
    "",
    "## KB Rules Consulted",
    "",
    ...rules.files.map((entry) => `- ${entry.name}`),
    "",
    "## Routing Notes",
    "",
    "This file is staged in the Intern repo for review. The intended destination is the AO1 KB once `kb_write_enabled` is approved."
  ];
  return `${body.join("\n")}\n`;
}

function titleFromConcept(conceptPath) {
  return conceptPath
    .split("/")
    .at(-1)
    .replace(/\.md$/, "")
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function commitOutputs(repoPath, files) {
  if (!fs.existsSync(path.join(repoPath, ".git"))) {
    return { status: "skipped", reason: "not-a-git-repo" };
  }
  const relFiles = files.map((file) => path.relative(repoPath, file));
  execFileSync("git", ["add", ...relFiles], { cwd: repoPath, stdio: "pipe" });
  const status = execFileSync("git", ["status", "--short", ...relFiles], { cwd: repoPath, encoding: "utf8" });
  if (!status.trim()) return { status: "skipped", reason: "no-changes" };
  execFileSync("git", ["commit", "-m", `File AO1 intern sync ${path.basename(path.dirname(files[0]))}`], { cwd: repoPath, stdio: "pipe" });
  return { status: "committed" };
}
