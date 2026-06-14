import assert from "node:assert/strict";
import test from "node:test";
import { checkLaunchdPreflight } from "../src/launchd-preflight.mjs";

const config = {
  runtime: {
    macos_sandbox: {
      node_command: "/opt/homebrew/bin/node"
    }
  }
};

test("test_launchd_preflight_requires_full_disk_access_when_node_probe_is_denied", () => {
  const homePath = "/Users/example";
  const result = checkLaunchdPreflight({
    repoPath: "/Users/example/Documents/Projects/ao1-intern",
    kbPath: "/Users/example/Documents/Projects/ao1-kb",
    config,
    platform: "darwin",
    homePath,
    accessProbe: ({ targets }) => ({ ok: false, targets, error: { code: "EPERM" } })
  });

  assert.equal(result.status, "manual-action-required");
  assert.equal(result.ready, false);
  assert.match(result.blockers.join("\n"), /Full Disk Access/);
  assert.match(result.blockers.join("\n"), /launchd-spawned Node/);
  assert.match(result.manualActions.join("\n"), /\/opt\/homebrew\/bin\/node/);
  assert.deepEqual(result.accessProbe.targets, [
    "/Users/example/Documents/Projects/ao1-intern/src/cli.mjs",
    "/Users/example/Documents/Projects/ao1-kb/index.md"
  ]);
  assert.deepEqual(result.protectedPaths, [
    "/Users/example/Documents/Projects/ao1-intern",
    "/Users/example/Documents/Projects/ao1-kb"
  ]);
});

test("test_launchd_preflight_uses_launchd_node_probe_for_protected_paths", () => {
  let probeInput = null;
  const result = checkLaunchdPreflight({
    repoPath: "/Users/example/Documents/Projects/ao1-intern",
    kbPath: "/Users/example/Documents/Projects/ao1-kb",
    config,
    platform: "darwin",
    homePath: "/Users/example",
    accessProbe: (input) => {
      probeInput = input;
      return { ok: true, probeKind: input.probeKind, targets: input.targets };
    }
  });

  assert.equal(result.status, "passed");
  assert.equal(probeInput.probeKind, "launchd-node-read");
  assert.equal(probeInput.nodeCommand, "/opt/homebrew/bin/node");
  assert.deepEqual(probeInput.targets, [
    "/Users/example/Documents/Projects/ao1-intern/src/cli.mjs",
    "/Users/example/Documents/Projects/ao1-kb/index.md"
  ]);
});

test("test_launchd_preflight_passes_for_documents_repos_when_node_probe_can_read", () => {
  const result = checkLaunchdPreflight({
    repoPath: "/Users/example/Documents/Projects/ao1-intern",
    kbPath: "/Users/example/Documents/Projects/ao1-kb",
    config,
    platform: "darwin",
    homePath: "/Users/example",
    accessProbe: ({ nodeCommand, targets }) => ({ ok: true, nodeCommand, targets })
  });

  assert.equal(result.status, "passed");
  assert.equal(result.ready, true);
  assert.equal(result.accessProbe.ok, true);
  assert.deepEqual(result.protectedPaths, [
    "/Users/example/Documents/Projects/ao1-intern",
    "/Users/example/Documents/Projects/ao1-kb"
  ]);
});

test("test_launchd_preflight_passes_for_unprotected_paths", () => {
  let accessProbeCalled = false;
  const result = checkLaunchdPreflight({
    repoPath: "/Users/example/Projects/ao1-intern",
    kbPath: "/Users/example/Projects/ao1-kb",
    config,
    platform: "darwin",
    homePath: "/Users/example",
    accessProbe: () => {
      accessProbeCalled = true;
      return { ok: false };
    }
  });

  assert.equal(result.status, "passed");
  assert.equal(result.ready, true);
  assert.equal(accessProbeCalled, false);
  assert.deepEqual(result.blockers, []);
  assert.deepEqual(result.manualActions, []);
});

test("test_launchd_preflight_is_nonblocking_off_macos", () => {
  const result = checkLaunchdPreflight({
    repoPath: "/Users/example/Documents/Projects/ao1-intern",
    kbPath: "/Users/example/Documents/Projects/ao1-kb",
    config,
    platform: "linux",
    homePath: "/Users/example"
  });

  assert.equal(result.status, "passed");
  assert.equal(result.ready, true);
});
