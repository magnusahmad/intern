import path from "node:path";
import { reviewArtifacts } from "./artifact-review.mjs";
import { fileLatestSync } from "./filing.mjs";
import { readJson } from "./fs-util.mjs";
import { generateHostBrokerPolicy } from "./policy.mjs";
import { probeRuntime } from "./runtime-probe.mjs";
import { selectRuntimeClassifier } from "./runtime-classifier.mjs";

const FILING_SKILL = "ao1-kb-filing";

export function parseInternChatIntent(text = "") {
  const normalized = String(text).toLowerCase().replace(/\s+/g, " ").trim();
  const mentionsArtifact = /\bartifacts?\b|\bartefacts?\b/.test(normalized);
  const mentionsGenerated = /\bgenerated\b|\bpolicy\b|\bschedule\b|\bsandbox\b|\blaunchagent\b/.test(normalized);

  if (/\bhelp\b|\bcommands?\b/.test(normalized)) return "help";
  if (/\bstatus\b|\bhealth\b|\bhealthy\b|\bready\b/.test(normalized)) return "runtime-status";
  if (mentionsArtifact && mentionsGenerated) return "review-generated-artifacts";
  if (
    /\bfile latest sync\b/.test(normalized) ||
    /\breview latest sync\b/.test(normalized) ||
    /\bupdate (the )?kb\b/.test(normalized) ||
    (mentionsArtifact && /\blatest\b|\breview\b/.test(normalized))
  ) {
    return "review-latest-sync";
  }
  return "unknown";
}

export async function handleInternChatMessage({
  message,
  config = {},
  kbPath,
  repoPath = process.cwd(),
  permissionsManifest,
  classifier,
  fileLatestSyncFn = fileLatestSync,
  reviewArtifactsFn = reviewArtifacts,
  runtimeProbeFn = probeRuntime
} = {}) {
  const auth = authorizeChatMessage({ message, config });
  if (!auth.authorized) {
    return {
      status: "denied",
      intent: "unauthorized",
      reply: `Sender ${message?.sender || "unknown"} is not authorized to control AO1 Intern.`
    };
  }

  const intent = parseInternChatIntent(message?.text || "");
  if (intent === "review-latest-sync") {
    const result = await fileLatestSyncFn(buildFilingOptions({
      kbPath,
      repoPath,
      config,
      permissionsManifest,
      classifier
    }));
    return {
      status: "ok",
      intent,
      skill: FILING_SKILL,
      result,
      reply: formatFilingReply(result)
    };
  }

  if (intent === "review-generated-artifacts") {
    const result = await reviewArtifactsFn({ repoPath, kbPath, config });
    return {
      status: result.status === "passed" ? "ok" : "failed",
      intent,
      skill: "artifact-review",
      result,
      reply: `Generated artifact review ${result.status}. ${result.checks?.length || 0} checks inspected.`
    };
  }

  if (intent === "runtime-status") {
    const result = await runtimeProbeFn({ commands: config.runtime?.commands || {} });
    return {
      status: result.ready === false ? "failed" : "ok",
      intent,
      skill: "runtime-probe",
      result,
      reply: result.ready === false
        ? "AO1 Intern runtime is not ready."
        : "AO1 Intern runtime is ready."
    };
  }

  if (intent === "help") {
    return {
      status: "ok",
      intent,
      skill: "chat-control",
      reply: [
        "AO1 Intern understands:",
        "review latest artifacts",
        "review generated policy artifacts",
        "status"
      ].join("\n")
    };
  }

  return {
    status: "unknown",
    intent: "unknown",
    reply: "I do not know how to do that yet. Try: review latest artifacts, review generated policy artifacts, or status."
  };
}

function authorizeChatMessage({ message, config }) {
  const channel = message?.channel || "unknown";
  const sender = message?.sender || "";
  const allowed = config.chat?.[channel]?.allowed_senders || [];
  return {
    authorized: allowed.includes(sender)
  };
}

function buildFilingOptions({ kbPath, repoPath, config, permissionsManifest, classifier }) {
  const resolvedRepoPath = path.resolve(repoPath);
  const resolvedKbPath = requiredPath(kbPath, "kbPath");
  const resolvedPermissions = permissionsManifest || loadPermissionsManifest(config, resolvedRepoPath);
  const selectedClassifier = classifier || selectRuntimeClassifier({
    mode: config.classifier || "heuristic",
    repoPath: resolvedKbPath,
    internRepoPath: resolvedRepoPath,
    codexConfig: config.codex_exec || {},
    hermesConfig: config.hermes || {},
    hostBrokerPolicy: buildHostBrokerPolicy(config, resolvedRepoPath)
  });

  return {
    kbPath: resolvedKbPath,
    repoPath: resolvedRepoPath,
    commitPolicy: config.filing?.commit_policy || "per-run",
    permissionsManifest: resolvedPermissions,
    classifier: selectedClassifier
  };
}

function loadPermissionsManifest(config, repoPath) {
  if (!config.permissions_path) return null;
  return readJson(resolveFromBase(config.permissions_path, repoPath));
}

function buildHostBrokerPolicy(config, repoPath) {
  if (config.runtime?.execution_boundary !== "host-broker") return null;
  const permissionsPath = resolveFromBase(config.permissions_path || "config/permissions.example.json", repoPath);
  return generateHostBrokerPolicy({
    manifest: readJson(permissionsPath),
    config
  });
}

function resolveFromBase(candidatePath, basePath) {
  return path.isAbsolute(candidatePath) ? candidatePath : path.join(basePath, candidatePath);
}

function requiredPath(value, name) {
  if (!value) throw new Error(`Missing ${name}`);
  return path.resolve(value);
}

function formatFilingReply(result = {}) {
  const outputs = result.outputs?.length || 0;
  const kbWrites = result.kbWrites?.length || 0;
  const run = result.runId ? ` for ${result.runId}` : "";
  return `AO1 Intern ${result.status || "completed"}${run}. Outputs: ${outputs}. KB writes: ${kbWrites}.`;
}
