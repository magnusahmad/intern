#!/usr/bin/env node
import path from "node:path";
import { fileLatestSync } from "./filing.mjs";
import { generateScheduleArtifacts } from "./scheduler.mjs";

const [command, ...rest] = process.argv.slice(2);
const args = parseArgs(rest);

try {
  if (command === "file-latest-sync") {
    const kbPath = required(args.kb, "--kb");
    const result = fileLatestSync({
      kbPath,
      repoPath: process.cwd(),
      runId: args.run_id || null,
      commit: args.commit !== "false"
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

function usage() {
  console.log(`Usage:
  npm run intern -- file-latest-sync --kb /path/to/kb [--run-id <id>]
  npm run intern -- schedule-artifacts --kb /path/to/kb [--out-dir <path>]`);
}
