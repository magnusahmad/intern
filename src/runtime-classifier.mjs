import { heuristicClassifyItems } from "./classifier.mjs";
import { createCodexClassifier } from "./codex-classifier.mjs";
import { createHostBroker } from "./host-broker.mjs";
import { createHermesCodexClassifier } from "./hermes-codex-classifier.mjs";

export function selectRuntimeClassifier({
  mode = "heuristic",
  repoPath,
  internRepoPath,
  codexConfig = {},
  hermesConfig = {},
  execFile,
  codexExecFile,
  hermesExecFile,
  hostBrokerPolicy
} = {}) {
  const hostBroker = hostBrokerPolicy ? createHostBroker({ policy: hostBrokerPolicy, execFile }) : null;
  if (!mode || mode === "heuristic") return heuristicClassifyItems;
  if (mode === "codex") {
    if (!repoPath) throw new Error("Codex classifier requires repoPath");
    return createCodexClassifier({
      repoPath,
      codexConfig,
      execFile: hostBroker?.codexExecFile || execFile || codexExecFile
    });
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
      codexExecFile: hostBroker?.codexExecFile || codexExecFile || execFile,
      hermesExecFile: hostBroker?.hermesExecFile || hermesExecFile
    });
  }
  throw new Error(`Unknown classifier: ${mode}`);
}
