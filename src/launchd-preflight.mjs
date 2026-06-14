import os from "node:os";
import path from "node:path";

const PROTECTED_HOME_DIRS = ["Documents", "Desktop", "Downloads"];

export function checkLaunchdPreflight({
  repoPath,
  kbPath,
  config = {},
  platform = process.platform,
  homePath = os.homedir()
} = {}) {
  const nodeCommand = scheduledNodeCommand({ config });
  const resolvedRepoPath = repoPath ? path.resolve(repoPath) : process.cwd();
  const resolvedKbPath = kbPath ? path.resolve(kbPath) : null;
  const resolvedHome = path.resolve(homePath);

  if (platform !== "darwin") {
    return passed({ platform, nodeCommand });
  }

  const protectedRoots = PROTECTED_HOME_DIRS.map((entry) => path.join(resolvedHome, entry));
  const protectedPaths = unique([
    resolvedRepoPath,
    resolvedKbPath
  ].filter(Boolean).filter((candidate) => (
    protectedRoots.some((root) => isInside(root, candidate))
  )));

  if (protectedPaths.length === 0) {
    return passed({ platform, nodeCommand, protectedRoots });
  }

  return {
    status: "manual-action-required",
    ready: false,
    platform,
    nodeCommand,
    protectedRoots,
    protectedPaths,
    blockers: [
      `macOS Full Disk Access is required for ${nodeCommand} before launchd can read protected repo paths.`
    ],
    manualActions: [
      `Grant Full Disk Access to ${nodeCommand} in System Settings > Privacy & Security > Full Disk Access, then rerun launchd-preflight.`
    ]
  };
}

function passed({ platform, nodeCommand, protectedRoots = [] }) {
  return {
    status: "passed",
    ready: true,
    platform,
    nodeCommand,
    protectedRoots,
    protectedPaths: [],
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
