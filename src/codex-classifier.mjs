// Codex-based classifier — kept as minimal stub.
// The full implementation was part of the V1 dogfood KB classification pipeline.
// The interface is preserved so runtime-classifier.mjs can be updated to use it.
export function createCodexClassifier({ repoPath, codexConfig = {}, execFile }) {
  return function codexClassifier({ items, rules, manifest, sync, curate }) {
    throw new Error(
      "Codex classifier is not available. " +
      "Use the heuristic classifier (default) or implement a real Codex classifier."
    );
  };
}
