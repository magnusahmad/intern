#!/usr/bin/env node
import path from "node:path";
import { fileLatestSync } from "./filing.mjs";
import { generateScheduleArtifacts } from "./scheduler.mjs";
import { readJson } from "./fs-util.mjs";
import { selectRuntimeClassifier } from "./runtime-classifier.mjs";
import { writePolicyArtifacts } from "./policy.mjs";
import { probeRuntime } from "./runtime-probe.mjs";

const [command, ...rest] = process.argv.slice(2);
const args = parseArgs(rest);

try {
  if (command === "file-latest-sync") {
    const kbPath = required(args.kb, "--kb");
    const config = loadConfig(args.config);
    const classifier = selectRuntimeClassifier({
      mode: args.classifier || config.classifier || "heuristic",
      repoPath: args.codex_repo ? path.resolve(args.codex_repo) : kbPath,
      codexConfig: config.codex_exec || {}
    });
    const result = fileLatestSync({
      kbPath,
      repoPath: process.cwd(),
      runId: args.run_id || null,
      commit: args.commit !== "false",
      classifier
    });
    console.log(JSON.stringify(result, null, 2));
  } else if (command === "schedule-artifacts") {
    const kbPath = required(args.kb, "--kb");
    const result = generateScheduleArtifacts({
      kbPath,
      repoPath: process.cwd(),
      outDir: args.out_dir ? path.resolve(args.out_dir) : undefined
    });
    console.log(JSON.stringify(result, null, 2));
  } else if (command === "policy-artifacts") {
    const permissionsPath = path.resolve(args.permissions || "config/permissions.example.json");
    const result = writePolicyArtifacts({
      manifest: readJson(permissionsPath),
      outDir: args.out_dir ? path.resolve(args.out_dir) : path.join(process.cwd(), ".ao1-intern", "policies")
    });
    console.log(JSON.stringify(result, null, 2));
  } else if (command === "runtime-probe") {
    const config = loadConfig(args.config);
    const result = probeRuntime({ commands: config.runtime?.commands || {} });
    console.log(JSON.stringify(result, null, 2));
  } else {
    usage();
    process.exit(command ? 1 : 0);
  }
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

function parseArgs(tokens) {
  const parsed = {};
  for (let i = 0; i < tokens.length; i += 1) {
    const token = tokens[i];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2).replaceAll("-", "_");
    const next = tokens[i + 1];
    if (!next || next.startsWith("--")) {
      parsed[key] = true;
    } else {
      parsed[key] = next;
      i += 1;
    }
  }
  return parsed;
}

function required(value, name) {
  if (!value) throw new Error(`Missing ${name}`);
  return path.resolve(value);
}

function loadConfig(configPath) {
  if (!configPath) return {};
  return readJson(path.resolve(configPath));
}

function usage() {
  console.log(`Usage:
  npm run intern -- file-latest-sync --kb /path/to/kb [--run-id <id>] [--classifier heuristic|codex] [--config <path>]
  npm run intern -- schedule-artifacts --kb /path/to/kb [--out-dir <path>]
  npm run intern -- policy-artifacts [--permissions <path>] [--out-dir <path>]
  npm run intern -- runtime-probe [--config <path>]`);
}
