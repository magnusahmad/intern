import fs from "node:fs";
import path from "node:path";
import { readJson, readJsonLines } from "./fs-util.mjs";

export function loadKbConfig(kbPath) {
  return readJson(path.join(kbPath, ".ao1", "config.json"));
}

export function loadJobHistory(kbPath) {
  return readJsonLines(path.join(kbPath, ".ao1", "job-history.jsonl"));
}

export function findLatestSyncRun(kbPath, requestedRunId = null) {
  const history = loadJobHistory(kbPath);
  const syncs = history.filter((entry) => entry.type === "sync");
  const sync = requestedRunId
    ? syncs.find((entry) => entry.run_id === requestedRunId)
    : syncs.at(-1);

  if (!sync) {
    throw new Error(requestedRunId ? `No sync run found for ${requestedRunId}` : "No sync runs found");
  }

  const syncIndex = history.indexOf(sync);
  const nextSyncIndex = history.findIndex((entry, index) => index > syncIndex && entry.type === "sync");
  const endIndex = nextSyncIndex === -1 ? history.length : nextSyncIndex;
  const following = history.slice(syncIndex + 1, endIndex);
  const curate = following.find((entry) => entry.type === "curate") || null;

  return { sync, curate };
}

export function getKbCron(kbPath) {
  return loadKbConfig(kbPath).schedule?.cron;
}

export function loadRunManifest(kbPath, sync) {
  const config = loadKbConfig(kbPath);
  const manifestPath = path.join(
    kbPath,
    ".ao1",
    "raw",
    "clients",
    config.client_id,
    "connectors",
    sync.connector_id,
    "runs",
    sync.run_id,
    "manifest.json"
  );

  const manifest = readJson(manifestPath);
  const runDir = path.dirname(manifestPath);
  const items = manifest.item_paths.map((itemPath) => {
    const itemFile = path.join(runDir, itemPath);
    return { file: itemFile, item: readJson(itemFile) };
  });

  return { manifestPath, manifest, items };
}

export function hasNewCuratedItems(curate) {
  return Number(curate?.added || 0) > 0;
}

export function latestReportText(kbPath) {
  const report = path.join(kbPath, ".ao1", "reports", "latest-agent-report.md");
  return fs.existsSync(report) ? fs.readFileSync(report, "utf8") : "";
}
