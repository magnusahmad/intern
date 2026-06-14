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

test("test_launchd_preflight_requires_full_disk_access_for_documents_repos", () => {
  const homePath = "/Users/example";
  const result = checkLaunchdPreflight({
    repoPath: "/Users/example/Documents/Projects/ao1-intern",
    kbPath: "/Users/example/Documents/Projects/ao1-kb",
    config,
    platform: "darwin",
    homePath
  });

  assert.equal(result.status, "manual-action-required");
  assert.equal(result.ready, false);
  assert.match(result.blockers.join("\n"), /Full Disk Access/);
  assert.match(result.manualActions.join("\n"), /\/opt\/homebrew\/bin\/node/);
  assert.deepEqual(result.protectedPaths, [
    "/Users/example/Documents/Projects/ao1-intern",
    "/Users/example/Documents/Projects/ao1-kb"
  ]);
});

test("test_launchd_preflight_passes_for_unprotected_paths", () => {
  const result = checkLaunchdPreflight({
    repoPath: "/Users/example/Projects/ao1-intern",
    kbPath: "/Users/example/Projects/ao1-kb",
    config,
    platform: "darwin",
    homePath: "/Users/example"
  });

  assert.equal(result.status, "passed");
  assert.equal(result.ready, true);
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
