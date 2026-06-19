import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_TARGET_REPOS,
  resolveTargetRepo,
  normalizeTargetRepos
} from "../src/target-repos.mjs";

test("test_target_repo_resolver_matches_explicit_repo_names_and_aliases", () => {
  const memento = resolveTargetRepo({
    text: "Can you update the onboarding copy in memento and run tests?"
  });

  assert.equal(memento.status, "resolved");
  assert.equal(memento.target.id, "memento-ai");
  assert.equal(memento.target.cwd, "/Users/magnus/Documents/Projects/memento-ai");
  assert.equal(memento.target.agentsPath, "/Users/magnus/Documents/Projects/memento-ai/AGENTS.md");
  assert.equal(memento.target.preferredBackend, "codex");
  assert.equal(memento.target.matchedAlias, "memento");
  assert.equal(memento.target.kbContextPointers.some((entry) => entry.includes("/Users/magnus/Documents/Projects/ao1-kb")), true);

  const kb = resolveTargetRepo({ explicitTarget: "kb" });
  assert.equal(kb.status, "resolved");
  assert.equal(kb.target.id, "ao1-kb");
});

test("test_target_repo_resolver_reports_ambiguous_and_unknown_targets", () => {
  const ambiguous = resolveTargetRepo({
    text: "Compare the ao1 intern and ao1 kb instructions."
  });

  assert.equal(ambiguous.status, "ambiguous");
  assert.deepEqual(ambiguous.candidates.map((candidate) => candidate.id).sort(), ["ao1-intern", "ao1-kb"]);

  const unknown = resolveTargetRepo({
    text: "Update the warehouse scanner copy."
  });

  assert.equal(unknown.status, "unknown");
  assert.equal(unknown.candidates.length, 0);
});

test("test_target_repo_resolver_accepts_configured_repo_overrides", () => {
  const targets = normalizeTargetRepos({
    configuredTargets: [{
      id: "custom-app",
      name: "Custom App",
      cwd: "/tmp/custom-app",
      aliases: ["warehouse scanner"],
      preferred_backend: "claude",
      kb_context: ["/tmp/ao1-kb/custom.md"]
    }]
  });

  const resolved = resolveTargetRepo({
    text: "Update the warehouse scanner copy.",
    targets
  });

  assert.equal(DEFAULT_TARGET_REPOS.some((target) => target.id === "custom-app"), false);
  assert.equal(resolved.status, "resolved");
  assert.equal(resolved.target.id, "custom-app");
  assert.equal(resolved.target.preferredBackend, "claude");
  assert.deepEqual(resolved.target.kbContextPointers, ["/tmp/ao1-kb/custom.md"]);
});
