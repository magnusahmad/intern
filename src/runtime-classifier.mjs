import { heuristicClassifyItems } from "./classifier.mjs";
import { createCodexClassifier } from "./codex-classifier.mjs";
import { createHermesCodexClassifier } from "./hermes-codex-classifier.mjs";

export function selectRuntimeClassifier({
  mode = "heuristic",
  repoPath,
  internRepoPath,
  codexConfig = {},
  hermesConfig = {},
  execFile,
  codexExecFile,
  hermesExecFile
} = {}) {
  if (!mode || mode === "heuristic") return heuristicClassifyItems;
  if (mode === "codex") {
    if (!repoPath) throw new Error("Codex classifier requires repoPath");
    return createCodexClassifier({ repoPath, codexConfig, execFile: execFile || codexExecFile });
  }
  if (mode === "hermes-codex") {
    if (!repoPath) throw new Error("Hermes/Codex classifier requires repoPath");
    return createHermesCodexClassifier({
      repoPath,
      codexConfig,
      hermesConfig: {
        cwd: internRepoPath,
        ...hermesConfig
      },
      codexExecFile: codexExecFile || execFile,
      hermesExecFile
    });
  }
  throw new Error(`Unknown classifier: ${mode}`);
}
