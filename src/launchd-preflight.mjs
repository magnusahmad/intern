import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const PROTECTED_HOME_DIRS = ["Documents", "Desktop", "Downloads"];
const LAUNCHD_PROBE_MARKER = "AO1_LAUNCHD_NODE_READ_OK";

export function checkLaunchdPreflight({
  repoPath,
  kbPath,
  config = {},
  platform = process.platform,
  homePath = os.homedir(),
  fileAccessProbe = probeLaunchdFileReadAccess,
  accessProbe = probeLaunchdNodeReadAccess
} = {}) {
  const nodeCommand = scheduledNodeCommand({ config });
  const nodeResolvedPath = resolveRealPath(nodeCommand);
  const resolvedRepoPath = repoPath ? path.resolve(repoPath) : process.cwd();
  const resolvedKbPath = kbPath ? path.resolve(kbPath) : null;
  const resolvedHome = path.resolve(homePath);

  if (platform !== "darwin") {
    return passed({ platform, nodeCommand, nodeResolvedPath });
  }

  const protectedRoots = PROTECTED_HOME_DIRS.map((entry) => path.join(resolvedHome, entry));
  const protectedPaths = unique([
    resolvedRepoPath,
    resolvedKbPath
  ].filter(Boolean).filter((candidate) => (
    protectedRoots.some((root) => isInside(root, candidate))
  )));

  if (protectedPaths.length === 0) {
    return passed({ platform, nodeCommand, nodeResolvedPath, protectedRoots });
  }

  const targets = launchdAccessTargets({ repoPath: resolvedRepoPath, kbPath: resolvedKbPath });
  const probe = accessProbe({
    probeKind: "launchd-node-read",
    nodeCommand,
    nodeResolvedPath,
    targets
  });

  if (probe.ok) {
    return passed({
      platform,
      nodeCommand,
      nodeResolvedPath,
      protectedRoots,
      protectedPaths,
      accessProbe: probe
    });
  }
  const fileProbe = fileAccessProbe({
    probeKind: "launchd-file-read",
    targets
  });
  const failedProbe = {
    ...probe,
    fileProbe
  };

  return manualActionRequired({
    platform,
    nodeCommand,
    nodeResolvedPath,
    protectedRoots,
    protectedPaths,
    accessProbe: failedProbe,
    blocker: `macOS Full Disk Access is required for launchd-spawned Node (${nodeCommand}) before it can read protected repo paths.`
  });
}

function manualActionRequired({ platform, nodeCommand, nodeResolvedPath, protectedRoots, protectedPaths, accessProbe, blocker }) {
  return {
    status: "manual-action-required",
    ready: false,
    platform,
    nodeCommand,
    nodeResolvedPath,
    protectedRoots,
    protectedPaths,
    accessProbe,
    blockers: [blocker],
    manualActions: [
      `Grant Full Disk Access to ${formatNodeForManualAction({ nodeCommand, nodeResolvedPath })} in System Settings > Privacy & Security > Full Disk Access, then rerun launchd-preflight.`
    ]
  };
}

function passed({ platform, nodeCommand, nodeResolvedPath = null, protectedRoots = [], protectedPaths = [], accessProbe = null }) {
  return {
    status: "passed",
    ready: true,
    platform,
    nodeCommand,
    nodeResolvedPath,
    protectedRoots,
    protectedPaths,
    accessProbe,
    blockers: [],
    manualActions: []
  };
}

function scheduledNodeCommand({ config }) {
  return config.runtime?.macos_sandbox?.node_command || process.execPath || "node";
}

function isInside(parent, candidate) {
  const rel = path.relative(path.resolve(parent), path.resolve(candidate));
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function unique(values) {
  return [...new Set(values)];
}

function launchdAccessTargets({ repoPath, kbPath }) {
  return [
    path.join(repoPath, "src", "cli.mjs"),
    kbPath ? path.join(kbPath, "index.md") : null
  ].filter(Boolean);
}

export function probeLaunchdFileReadAccess({
  targets,
  launchctlCommand = "launchctl",
  timeoutMs = 3000
}) {
  const label = `com.ao1.intern.launchd-file-preflight.${process.pid}.${Date.now()}.${crypto.randomUUID()}`;
  const stdoutPath = path.join(os.tmpdir(), `${label}.out`);
  const stderrPath = path.join(os.tmpdir(), `${label}.err`);

  try {
    execFileSync(launchctlCommand, [
      "submit",
      "-l",
      label,
      "-o",
      stdoutPath,
      "-e",
      stderrPath,
      "--",
      "/bin/cat",
      ...targets
    ], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });
  } catch (error) {
    cleanupLaunchdProbe({ launchctlCommand, label });
    return {
      ok: false,
      probeKind: "launchd-file-read",
      label,
      targets,
      error: {
        phase: "submit",
        code: error.code || null,
        status: error.status ?? null,
        signal: error.signal || null,
        stderr: String(error.stderr || "").trim()
      },
      stderr: ""
    };
  }

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const state = readLaunchdState({ launchctlCommand, label });
    if (/last exit code = 0/.test(state)) {
      cleanupLaunchdProbe({ launchctlCommand, label, stdoutPath, stderrPath });
      return {
        ok: true,
        probeKind: "launchd-file-read",
        label,
        targets
      };
    }
    const stderr = readOptionalFile(stderrPath);
    if (stderr.trim()) {
      cleanupLaunchdProbe({ launchctlCommand, label, stdoutPath, stderrPath });
      return {
        ok: false,
        probeKind: "launchd-file-read",
        label,
        targets,
        stderr: stderr.trim(),
        launchdState: state
      };
    }
    sleepSync(200);
  }

  const launchdState = readLaunchdState({ launchctlCommand, label });
  cleanupLaunchdProbe({ launchctlCommand, label, stdoutPath, stderrPath });
  return {
    ok: false,
    probeKind: "launchd-file-read",
    label,
    targets,
    stderr: readOptionalFile(stderrPath).trim(),
    launchdState,
    error: {
      phase: "timeout",
      timeoutMs
    }
  };
}

export function probeLaunchdNodeReadAccess({
  nodeCommand,
  nodeResolvedPath = null,
  targets,
  launchctlCommand = "launchctl",
  timeoutMs = 8000
}) {
  const label = `com.ao1.intern.launchd-preflight.${process.pid}.${Date.now()}.${crypto.randomUUID()}`;
  const stdoutPath = path.join(os.tmpdir(), `${label}.out`);
  const stderrPath = path.join(os.tmpdir(), `${label}.err`);
  const script = [
    "const fs = require('node:fs');",
    "const targets = JSON.parse(process.argv[1]);",
    "for (const target of targets) {",
    "  fs.readFileSync(target);",
    "}",
    `process.stdout.write(${JSON.stringify(LAUNCHD_PROBE_MARKER)});`
  ].join("\n");

  try {
    execFileSync(launchctlCommand, [
      "submit",
      "-l",
      label,
      "-o",
      stdoutPath,
      "-e",
      stderrPath,
      "--",
      nodeCommand,
      "-e",
      script,
      JSON.stringify(targets)
    ], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });
  } catch (error) {
    cleanupLaunchdProbe({ launchctlCommand, label });
    return launchdProbeFailure({
      label,
      nodeCommand,
      nodeResolvedPath,
      targets,
      error: {
        phase: "submit",
        code: error.code || null,
        status: error.status ?? null,
        signal: error.signal || null,
        stderr: String(error.stderr || "").trim()
      }
    });
  }

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const stdout = readOptionalFile(stdoutPath);
    if (stdout.includes(LAUNCHD_PROBE_MARKER)) {
      cleanupLaunchdProbe({ launchctlCommand, label, stdoutPath, stderrPath });
      return {
        ok: true,
        probeKind: "launchd-node-read",
        label,
        nodeCommand,
        nodeResolvedPath,
        targets
      };
    }
    sleepSync(200);
  }

  const launchdState = readLaunchdState({ launchctlCommand, label });
  cleanupLaunchdProbe({ launchctlCommand, label });
  return launchdProbeFailure({
    label,
    nodeCommand,
    nodeResolvedPath,
    targets,
    stdoutPath,
    stderrPath,
    launchdState,
    error: {
      phase: "timeout",
      timeoutMs
    }
  });
}

function launchdProbeFailure({ label, nodeCommand, nodeResolvedPath, targets, stdoutPath = null, stderrPath = null, launchdState = null, error }) {
  return {
    ok: false,
    probeKind: "launchd-node-read",
    label,
    nodeCommand,
    nodeResolvedPath,
    targets,
    error,
    stdout: stdoutPath ? readOptionalFile(stdoutPath).trim() : "",
    stderr: stderrPath ? readOptionalFile(stderrPath).trim() : "",
    launchdState
  };
}

function readLaunchdState({ launchctlCommand, label }) {
  try {
    return execFileSync(launchctlCommand, ["print", `gui/${os.userInfo().uid}/${label}`], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });
  } catch (error) {
    return String(error.stderr || error.message || "").trim();
  }
}

function resolveRealPath(candidatePath) {
  try {
    return fs.realpathSync(candidatePath);
  } catch {
    return null;
  }
}

function formatNodeForManualAction({ nodeCommand, nodeResolvedPath }) {
  if (!nodeResolvedPath || nodeResolvedPath === nodeCommand) return nodeCommand;
  return `${nodeCommand} (${nodeResolvedPath})`;
}

function cleanupLaunchdProbe({ launchctlCommand, label, stdoutPath = null, stderrPath = null }) {
  try {
    execFileSync(launchctlCommand, ["remove", label], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    });
  } catch {
    // Best-effort cleanup; a completed submit job may already be gone.
  }
  for (const file of [stdoutPath, stderrPath].filter(Boolean)) {
    try {
      fs.rmSync(file, { force: true });
    } catch {
      // Best-effort temp-file cleanup.
    }
  }
}

function readOptionalFile(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}
