#!/usr/bin/env node
import path from "node:path";
import { fileLatestSync } from "./filing.mjs";
import { generateScheduleArtifacts } from "./scheduler.mjs";
import { readJson } from "./fs-util.mjs";
import { selectRuntimeClassifier } from "./runtime-classifier.mjs";
import { generateHostBrokerPolicy, writePolicyArtifacts } from "./policy.mjs";
import { probeRuntime } from "./runtime-probe.mjs";
import { runScheduledRuntimeSmoke, scheduledRuntimeEnv } from "./runtime-smoke.mjs";

const [command, ...rest] = process.argv.slice(2);
const args = parseArgs(rest);

try {
  if (command === "file-latest-sync") {
    const kbPath = required(args.kb, "--kb");
    const config = loadConfig(args.config);
    const permissionsManifest = loadPermissionsManifest(config, args);
    const hostBrokerPolicy = buildHostBrokerPolicy(config, args);
    const classifier = selectRuntimeClassifier({
      mode: args.classifier || config.classifier || "heuristic",
      repoPath: args.codex_repo ? path.resolve(args.codex_repo) : kbPath,
      internRepoPath: process.cwd(),
      codexConfig: config.codex_exec || {},
      hermesConfig: config.hermes || {},
      hostBrokerPolicy
    });
    const result = fileLatestSync({
      kbPath,
      repoPath: process.cwd(),
      runId: args.run_id || null,
      commit: args.commit !== "false",
      commitPolicy: args.commit_policy || config.filing?.commit_policy || "per-run",
      permissionsManifest,
      classifier
    });
    console.log(JSON.stringify(result, null, 2));
  } else if (command === "schedule-artifacts") {
    const kbPath = required(args.kb, "--kb");
    const configPath = args.config ? path.resolve(args.config) : undefined;
    const config = configPath ? readJson(configPath) : {};
    const result = generateScheduleArtifacts({
      kbPath,
      repoPath: process.cwd(),
      configPath,
      config,
      outDir: args.out_dir ? path.resolve(args.out_dir) : undefined
    });
    console.log(JSON.stringify(result, null, 2));
  } else if (command === "policy-artifacts") {
    const permissionsPath = path.resolve(args.permissions || "config/permissions.example.json");
    const config = args.config ? readJson(path.resolve(args.config)) : {};
    const result = writePolicyArtifacts({
      manifest: readJson(permissionsPath),
      config,
      outDir: args.out_dir ? path.resolve(args.out_dir) : path.join(process.cwd(), ".ao1-intern", "policies")
    });
    console.log(JSON.stringify(result, null, 2));
  } else if (command === "runtime-probe") {
    const config = loadConfig(args.config);
    const result = probeRuntime({ commands: config.runtime?.commands || {} });
    console.log(JSON.stringify(result, null, 2));
  } else if (command === "scheduled-runtime-smoke") {
    const config = loadConfig(args.config);
    const kbPath = required(args.kb || config.kb_path, "--kb");
    const permissionsPath = path.resolve(config.permissions_path || args.permissions || "config/permissions.example.json");
    const result = runScheduledRuntimeSmoke({
      config,
      manifest: readJson(permissionsPath),
      kbPath,
      repoPath: process.cwd(),
      env: scheduledRuntimeEnv(process.env, config)
    });
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

function buildHostBrokerPolicy(config, args = {}) {
  if (config.runtime?.execution_boundary !== "host-broker") return null;
  const permissionsPath = path.resolve(args.permissions || config.permissions_path || "config/permissions.example.json");
  return generateHostBrokerPolicy({
    manifest: readJson(permissionsPath),
    config
  });
}

function loadPermissionsManifest(config, args) {
  const permissionsPath = args.permissions || config.permissions_path;
  if (!permissionsPath) return null;
  return readJson(path.resolve(permissionsPath));
}

function usage() {
  console.log(`Usage:
  npm run intern -- file-latest-sync --kb /path/to/kb [--run-id <id>] [--classifier heuristic|codex] [--config <path>] [--permissions <path>] [--commit-policy per-run|manual]
  npm run intern -- schedule-artifacts --kb /path/to/kb [--config <path>] [--out-dir <path>]
  npm run intern -- policy-artifacts [--permissions <path>] [--config <path>] [--out-dir <path>]
  npm run intern -- runtime-probe [--config <path>]
  npm run intern -- scheduled-runtime-smoke --config <path> [--kb /path/to/kb]`);
}
