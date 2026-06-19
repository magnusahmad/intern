import path from "node:path";
import { buildCodexExecInvocation, normalizeCodexExecConfig } from "./codex-driver.mjs";
import { assertNoSecretsInText } from "./secrets.mjs";
import { resolveTargetRepo } from "./target-repos.mjs";

const SUPPORTED_BACKENDS = new Set(["codex", "claude"]);
const CODEX_MODES = new Set(["background-pty", "oneshot"]);
const CLAUDE_MODES = new Set(["print", "interactive-tmux"]);

export function buildDelegationRoutePlan({
  message = "",
  explicitTarget = "",
  explicitBackend = "",
  explicitMode = "",
  config = {}
} = {}) {
  assertNoSecretsInText(String(message || ""), "delegation message");
  if (!explicitTarget) {
    return {
      version: "ao1-intern.hermes-gateway-route.v1",
      status: "needs-input",
      reason: "Delegation route requires an explicit target selected by Hermes or the operator; raw chat text is not routed deterministically.",
      candidates: []
    };
  }

  const targetResult = resolveTargetRepo({ explicitTarget, config });
  if (targetResult.status !== "resolved") {
    return {
      version: "ao1-intern.hermes-gateway-route.v1",
      status: targetResult.status,
      reason: targetResult.reason,
      candidates: targetResult.candidates
    };
  }

  const backend = selectDelegationBackend({
    explicitBackend,
    target: targetResult.target,
    config
  });
  const mode = selectLaunchMode({ backend, explicitMode, config });
  const launch = buildBackendLaunchTemplate({
    target: targetResult.target,
    backend,
    mode,
    task: message,
    config
  });

  return {
    version: "ao1-intern.hermes-gateway-route.v1",
    status: "ready",
    target: targetResult.target,
    backend,
    mode: launch.mode,
    launch,
    continuity: launch.hermesContinuity,
    audit: {
      owner: "intern",
      state: "metadata-only",
      artifactDir: config.hermes_gateway?.audit_dir || ".ao1-intern/delegations"
    },
    safety: {
      targetRules: targetResult.target.agentsPath,
      kbContextPointers: targetResult.target.kbContextPointers,
      liveServiceRules: "Target repo AGENTS.md owns live-service confirmation rules."
    }
  };
}

export function selectDelegationBackend({
  explicitBackend = "",
  target = {},
  config = {}
} = {}) {
  const explicit = normalizeBackend(explicitBackend);
  if (explicit) return explicit;

  return normalizeBackend(
    config.hermes_gateway?.default_backend
      || config.delegation?.default_backend
      || target.preferredBackend
      || "codex"
  );
}

export function buildBackendLaunchTemplate({
  target,
  backend,
  mode,
  task,
  config = {}
} = {}) {
  if (!target?.cwd) throw new Error("Backend launch template requires target cwd.");
  if (!task) throw new Error("Backend launch template requires task text.");
  const normalizedBackend = normalizeBackend(backend);
  if (!normalizedBackend) throw new Error("Backend launch template requires backend.");
  assertNoSecretsInText(JSON.stringify({ target, task }), "backend launch template");

  const normalizedMode = normalizeMode({ backend: normalizedBackend, mode });
  if (normalizedBackend === "codex" && normalizedMode === "background-pty") {
    return codexBackgroundPtyTemplate({ target, task, config });
  }
  if (normalizedBackend === "codex" && normalizedMode === "oneshot") {
    return codexOneshotTemplate({ target, task, config });
  }
  if (normalizedBackend === "claude" && normalizedMode === "print") {
    return claudePrintTemplate({ target, task, config });
  }
  if (normalizedBackend === "claude" && normalizedMode === "interactive-tmux") {
    return claudeInteractiveTmuxTemplate({ target, task, config });
  }
  throw new Error(`Unsupported backend template: ${normalizedBackend}/${normalizedMode}`);
}

function codexBackgroundPtyTemplate({ target, task, config }) {
  const codexConfig = normalizeCodexExecConfig(config.codex_exec || {});
  const args = [];
  if (codexConfig.model) args.push("--model", codexConfig.model);
  if (codexConfig.serviceTier) args.push("-c", `service_tier="${codexConfig.serviceTier}"`);
  args.push("--cd", target.cwd);

  return template({
    templateName: "codex-background-pty",
    backend: "codex",
    mode: "background-pty",
    command: config.runtime?.commands?.codex || "codex",
    args,
    cwd: target.cwd,
    initialInput: buildInitialWorkerInput({ target, task }),
    target
  });
}

function codexOneshotTemplate({ target, task, config }) {
  const codexConfig = normalizeCodexExecConfig(config.codex_exec || {});
  const invocation = buildCodexExecInvocation({
    repo: target.cwd,
    prompt: task,
    model: codexConfig.model,
    serviceTier: codexConfig.serviceTier,
    sandbox: codexConfig.sandbox,
    ignoreUserConfig: codexConfig.ignoreUserConfig,
    ephemeral: codexConfig.ephemeral
  });
  return template({
    templateName: "codex-oneshot",
    backend: "codex",
    mode: "oneshot",
    command: config.runtime?.commands?.codex || invocation.command,
    args: invocation.args,
    cwd: target.cwd,
    target
  });
}

function claudePrintTemplate({ target, task, config }) {
  return template({
    templateName: "claude-print",
    backend: "claude",
    mode: "print",
    command: config.runtime?.commands?.claude || "claude",
    args: ["-p", task],
    cwd: target.cwd,
    target
  });
}

function claudeInteractiveTmuxTemplate({ target, task, config }) {
  const sessionName = safeSessionName(`ao1-intern-${target.id}`);
  return template({
    templateName: "claude-interactive-tmux",
    backend: "claude",
    mode: "interactive-tmux",
    command: config.runtime?.commands?.tmux || "tmux",
    args: ["new-session", "-A", "-s", sessionName, "-c", target.cwd, config.runtime?.commands?.claude || "claude"],
    cwd: target.cwd,
    initialInput: buildInitialWorkerInput({ target, task }),
    target
  });
}

function template({
  templateName,
  backend,
  mode,
  command,
  args,
  cwd,
  initialInput,
  target
}) {
  const value = {
    templateName,
    backend,
    mode,
    command,
    args,
    cwd,
    target: {
      id: target.id,
      cwd: target.cwd,
      agentsPath: target.agentsPath,
      kbContextPointers: target.kbContextPointers
    },
    hermesContinuity: {
      owner: "hermes",
      session: "current Hermes gateway chat/thread",
      followUp: "Operator replies continue the same Hermes session and are sent to the active worker process.",
      internState: "audit metadata only"
    },
    ...(initialInput ? { initialInput } : {})
  };
  assertNoSecretsInText(JSON.stringify(value), "backend launch template");
  return value;
}

function buildInitialWorkerInput({ target, task }) {
  return [
    task,
    "",
    `Start in ${target.cwd}.`,
    `Read the target repo rules first: ${target.agentsPath}.`,
    "Use AO1 KB context pointers only when they are relevant:",
    ...target.kbContextPointers.map((entry) => `- ${entry}`),
    "Ask follow-up questions in this Hermes chat when operator input is required."
  ].join("\n");
}

function selectLaunchMode({ backend, explicitMode = "", config = {} } = {}) {
  const normalizedExplicit = normalizeMode({ backend, mode: explicitMode, allowEmpty: true });
  if (normalizedExplicit) return normalizedExplicit;

  if (backend === "codex") {
    return normalizeMode({
      backend,
      mode: config.hermes_gateway?.default_modes?.codex || config.hermes_gateway?.default_mode || "background-pty"
    });
  }
  if (backend === "claude") {
    return normalizeMode({
      backend,
      mode: config.hermes_gateway?.default_modes?.claude || config.hermes_gateway?.default_claude_mode || "print"
    });
  }
  throw new Error(`Unsupported backend: ${backend}`);
}

function normalizeMode({ backend, mode, allowEmpty = false }) {
  if (!mode && allowEmpty) return "";
  const normalized = String(mode || "").toLowerCase().trim();
  if (backend === "codex") {
    const value = normalized || "background-pty";
    if (!CODEX_MODES.has(value)) throw new Error(`Unsupported Codex launch mode: ${mode}`);
    return value;
  }
  if (backend === "claude") {
    const value = normalized || "print";
    if (!CLAUDE_MODES.has(value)) throw new Error(`Unsupported Claude launch mode: ${mode}`);
    return value;
  }
  throw new Error(`Unsupported backend: ${backend}`);
}

function normalizeBackend(value) {
  if (!value) return "";
  const normalized = String(value).toLowerCase().trim();
  if (!SUPPORTED_BACKENDS.has(normalized)) throw new Error(`Unsupported backend: ${value}`);
  return normalized;
}

function safeSessionName(value) {
  return path.basename(String(value || "ao1-intern-worker"))
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || "ao1-intern-worker";
}
