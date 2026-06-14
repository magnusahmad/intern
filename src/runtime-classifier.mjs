import { heuristicClassifyItems } from "./classifier.mjs";
import { createCodexClassifier } from "./codex-classifier.mjs";

export function selectRuntimeClassifier({
  mode = "heuristic",
  repoPath,
  codexConfig = {},
  execFile
} = {}) {
  if (!mode || mode === "heuristic") return heuristicClassifyItems;
  if (mode === "codex") {
    if (!repoPath) throw new Error("Codex classifier requires repoPath");
    return createCodexClassifier({ repoPath, codexConfig, execFile });
  }
  throw new Error(`Unknown classifier: ${mode}`);
}
