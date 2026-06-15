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
  const batches = curatedSyncBatches(history);

  if (requestedRunId) {
    for (const batch of batches) {
      const sync = batch.syncs.find((entry) => entry.run_id === requestedRunId);
      if (sync) return { sync, curate: batch.curate };
    }
    const sync = syncs.find((entry) => entry.run_id === requestedRunId);
    if (!sync) throw new Error(`No sync run found for ${requestedRunId}`);
    return { sync, curate: null };
  }

  for (let i = batches.length - 1; i >= 0; i -= 1) {
    const batch = batches[i];
    if (!hasNewCuratedItems(batch.curate)) continue;
    const sync = [...batch.syncs].reverse().find((entry) => Number(entry.item_count || 0) > 0) || batch.syncs.at(-1);
    if (sync) return { sync, curate: batch.curate };
  }

  const sync = syncs.at(-1);
  if (!sync) throw new Error("No sync runs found");
  const batch = batches.find((candidate) => candidate.syncs.includes(sync));
  return { sync, curate: batch?.curate || null };
}

function curatedSyncBatches(history) {
  const batches = [];
  let pendingSyncs = [];
  for (const entry of history) {
    if (entry.type === "sync") {
      pendingSyncs.push(entry);
    } else if (entry.type === "curate") {
      batches.push({ syncs: pendingSyncs, curate: entry });
      pendingSyncs = [];
    }
  }
  return batches;
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
