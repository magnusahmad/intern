// Hermes + Codex hybrid classifier — kept as minimal stub.
export function createHermesCodexClassifier({ repoPath, codexConfig, hermesConfig, codexExecFile, hermesExecFile }) {
  return function hermesCodexClassifier({ items, rules, manifest, sync, curate }) {
    throw new Error(
      "Hermes/Codex classifier is not available. " +
      "Use the heuristic classifier (default) or implement a real hybrid classifier."
    );
  };
}
