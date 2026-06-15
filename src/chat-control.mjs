import fs from "node:fs";
import path from "node:path";
import { reviewArtifacts } from "./artifact-review.mjs";
import { heuristicPlanChatIntent, selectChatIntentPlanner } from "./chat-planner.mjs";
import { fileLatestSync } from "./filing.mjs";
import { ensureInside, readJson } from "./fs-util.mjs";
import { generateHostBrokerPolicy } from "./policy.mjs";
import { probeRuntime } from "./runtime-probe.mjs";
import { selectRuntimeClassifier } from "./runtime-classifier.mjs";
import { formatShellReply, runShellSkill } from "./shell-skill.mjs";

const FILING_SKILL = "ao1-kb-filing";

export function parseInternChatIntent(text = "") {
  return heuristicPlanChatIntent({ text }).intent;
}

export async function handleInternChatMessage({
  message,
  config = {},
  kbPath,
  repoPath = process.cwd(),
  permissionsManifest,
  classifier,
  intentPlanner,
  shellRunner = runShellSkill,
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

  const plan = await planChatIntent({ message, config, kbPath, repoPath, intentPlanner });
  const intent = plan.intent;
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

  if (intent === "summarize-last-filing") {
    return {
      status: "ok",
      intent,
      skill: "filing-summary",
      reply: summarizeLastFiling({ repoPath })
    };
  }

  if (intent === "run-shell-command") {
    const shellConfig = config.chat?.shell || {};
    if (shellConfig.enabled !== true) {
      return {
        status: "denied",
        intent,
        skill: "shell",
        reply: "Shell access is disabled for AO1 Intern."
      };
    }
    const command = plan.command || message?.text || "";
    const result = await shellRunner({
      command,
      cwd: shellConfig.working_directory || repoPath,
      timeoutMs: shellConfig.timeout_ms,
      maxOutputChars: shellConfig.max_output_chars
    });
    return {
      status: result.status === "ok" ? "ok" : "failed",
      intent,
      skill: "shell",
      result,
      reply: formatShellReply({
        command,
        result,
        maxReplyChars: shellConfig.max_reply_chars
      })
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
        "what did you write?",
        "where did you put it?",
        "run: <shell command>",
        "ask Codex: <prompt>",
        "review generated policy artifacts",
        "status"
      ].join("\n")
    };
  }

  return {
    status: "unknown",
    intent: "unknown",
    reply: "I do not know how to do that yet. Try: review latest artifacts, what did you write?, run: git status, ask Codex: <prompt>, review generated policy artifacts, or status."
  };
}

async function planChatIntent({ message, config, kbPath, repoPath, intentPlanner }) {
  const hostBrokerPolicy = buildHostBrokerPolicy(config, repoPath);
  const planner = intentPlanner || selectChatIntentPlanner({
    config,
    repoPath,
    hostBrokerPolicy
  });
  try {
    return await planner({
      message,
      text: message?.text || "",
      config,
      kbPath,
      repoPath
    });
  } catch {
    return heuristicPlanChatIntent({ text: message?.text || "" });
  }
}

export function summarizeLastFiling({ repoPath = process.cwd(), checkpointPath = path.join(repoPath, ".ao1-intern", "checkpoint.json") } = {}) {
  if (!fs.existsSync(checkpointPath)) {
    return "I do not have a filing checkpoint yet.";
  }

  const checkpoint = readJson(checkpointPath);
  const entries = Object.entries(checkpoint.filed_runs || {})
    .map(([runId, record]) => ({ runId, ...record }))
    .sort((a, b) => String(b.at || "").localeCompare(String(a.at || "")));
  const latest = entries[0];
  if (!latest) return "I do not have any filing runs recorded yet.";

  if (latest.status !== "filed") {
    return [
      `Last filing run: ${latest.status || "unknown"} for ${latest.runId}.`,
      "It did not write markdown."
    ].join("\n");
  }

  const outputs = latest.outputs || [];
  const kbWrites = latest.kb_writes || [];
  const lines = [
    `Last filing run: filed for ${latest.runId}.`,
    `Intern files: ${outputs.length || 0}. KB writes: ${kbWrites.length ? kbWrites.join(", ") : "none"}.`
  ];

  for (const relPath of outputs.slice(0, 3)) {
    const file = safeRepoPath(repoPath, relPath);
    if (!file || !fs.existsSync(file)) {
      lines.push(`- ${relPath}: file is no longer present.`);
      continue;
    }
    const summary = summarizeFiledMarkdown(fs.readFileSync(file, "utf8"));
    lines.push(`- ${relPath}`);
    if (summary.targetConcept) lines.push(`  Target: ${summary.targetConcept}`);
    for (const bullet of summary.bullets.slice(0, 2)) {
      lines.push(`  ${bullet}`);
    }
  }

  if (outputs.length > 3) lines.push(`Plus ${outputs.length - 3} more file(s).`);
  return lines.join("\n");
}

function safeRepoPath(repoPath, relPath) {
  const candidate = path.resolve(repoPath, relPath);
  return ensureInside(repoPath, candidate) ? candidate : null;
}

function summarizeFiledMarkdown(markdown) {
  const targetConcept = markdown.match(/^Target concept:\s*(.+)$/m)?.[1] || "";
  const summaryMatch = markdown.match(/(?:^|\n)## Summary\s*\n([\s\S]*?)(?=\n## |\n?$)/);
  const bullets = [];
  for (const line of (summaryMatch?.[1] || "").split(/\r?\n/)) {
    const bullet = line.match(/^- (.+)$/);
    if (bullet) bullets.push(bullet[1]);
  }
  return { targetConcept, bullets };
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
