import { createHostBroker } from "./host-broker.mjs";
import { runHermesOneshot } from "./hermes-driver.mjs";

const ALLOWED_INTENTS = new Set([
  "review-latest-sync",
  "summarize-last-filing",
  "review-generated-artifacts",
  "runtime-status",
  "run-shell-command",
  "help",
  "unknown"
]);

export function heuristicPlanChatIntent({ text = "" } = {}) {
  const normalized = String(text).toLowerCase().replace(/\s+/g, " ").trim();
  const mentionsArtifact = /\bartifacts?\b|\bartefacts?\b/.test(normalized);
  const mentionsGenerated = /\bgenerated\b|\bpolicy\b|\bschedule\b|\bsandbox\b|\blaunchagent\b/.test(normalized);

  const shellCommand = extractExplicitShellCommand(text);
  if (shellCommand) return chatPlan("run-shell-command", "heuristic", "Explicit shell command requested.", 1, { command: shellCommand });
  const codexCommand = extractCodexPrompt(text);
  if (codexCommand) return chatPlan("run-shell-command", "heuristic", "Codex prompt requested.", 1, { command: codexCommand });
  if (/\bhelp\b|\bcommands?\b/.test(normalized)) return chatPlan("help", "heuristic");
  if (/\bstatus\b|\bhealth\b|\bhealthy\b|\bready\b/.test(normalized)) return chatPlan("runtime-status", "heuristic");
  if (mentionsArtifact && mentionsGenerated) return chatPlan("review-generated-artifacts", "heuristic");
  if (/\btry\b.*\b(more recent|newer|latest)\b/.test(normalized)) return chatPlan("review-latest-sync", "heuristic");
  if (/\b(more recent|newer)\b.*\bones?\b/.test(normalized)) return chatPlan("review-latest-sync", "heuristic");
  if (/\bwhat\b.*\b(write|wrote|file|filed|put)\b/.test(normalized)) return chatPlan("summarize-last-filing", "heuristic");
  if (/\bwhere\b.*\b(put|write|wrote|file|filed)\b/.test(normalized)) return chatPlan("summarize-last-filing", "heuristic");
  if (/\b(show|summari[sz]e|explain)\b.*\b(last|latest|recent)\b.*\b(run|filing|file|files|outputs?)\b/.test(normalized)) return chatPlan("summarize-last-filing", "heuristic");
  if (
    /\bfile latest sync\b/.test(normalized) ||
    /\breview latest sync\b/.test(normalized) ||
    /\bupdate (the )?kb\b/.test(normalized) ||
    (mentionsArtifact && /\blatest\b|\breview\b/.test(normalized))
  ) {
    return chatPlan("review-latest-sync", "heuristic");
  }
  return chatPlan("unknown", "heuristic", "No approved skill matched.");
}

export function selectChatIntentPlanner({
  config = {},
  repoPath,
  execFile,
  hostBrokerPolicy
} = {}) {
  const plannerConfig = config.chat?.intent_planner || {};
  const mode = plannerConfig.mode || "heuristic";
  if (mode === "heuristic") return heuristicPlanChatIntent;
  if (mode === "hermes") {
    const hostBroker = hostBrokerPolicy ? createHostBroker({ policy: hostBrokerPolicy, execFile }) : null;
    return createHermesChatIntentPlanner({
      hermesConfig: {
        cwd: repoPath,
        ...(config.hermes || {}),
        ...(plannerConfig.hermes || {})
      },
      execFile: hostBroker?.hermesExecFile || execFile
    });
  }
  throw new Error(`Unknown chat intent planner: ${mode}`);
}

export function createHermesChatIntentPlanner({
  hermesConfig = {},
  execFile
} = {}) {
  return ({ text, message } = {}) => {
    const prompt = buildChatIntentPlannerPrompt({ text: text ?? message?.text ?? "" });
    const output = runHermesOneshot({
      prompt,
      command: hermesConfig.command,
      model: hermesConfig.model,
      provider: hermesConfig.provider,
      toolsets: hermesConfig.toolsets,
      skills: hermesConfig.skills,
      ignoreUserConfig: hermesConfig.ignore_user_config,
      ignoreRules: hermesConfig.ignore_rules,
      yolo: hermesConfig.yolo,
      cwd: hermesConfig.cwd,
      execFile
    });
    return parseChatIntentPlannerOutput(output);
  };
}

export function buildChatIntentPlannerPrompt({ text = "" } = {}) {
  const payload = {
    task: "Plan the next AO1 Intern chat action.",
    user_message: String(text || ""),
    allowed_intents: [
      {
        intent: "review-latest-sync",
        use_when: "The user wants the Intern to inspect/review/file/update recent synced artifacts, connector data, WhatsApp items, or KB-ready outputs."
      },
      {
        intent: "summarize-last-filing",
        use_when: "The user asks what was written, where it was put, what happened last, or asks to explain/summarize the last filing output."
      },
      {
        intent: "review-generated-artifacts",
        use_when: "The user asks to inspect generated policy, schedule, sandbox, LaunchAgent, or setup artifacts."
      },
      {
        intent: "runtime-status",
        use_when: "The user asks if the Intern is ready, healthy, working, connected, or asks for status."
      },
      {
        intent: "run-shell-command",
        use_when: "The user wants the Intern to do arbitrary machine work, run terminal commands, inspect files with shell tools, start processes, run tests, use git, or prompt Codex/Hermes through CLI commands. Include a `command` string suitable for `/bin/zsh -lc`. For Codex requests, prefer `codex exec --cd /Users/magnus/Documents/Projects/ao1-intern '<prompt>'` unless the user gives a more specific command."
      },
      {
        intent: "help",
        use_when: "The user asks what the Intern can do or asks for commands."
      },
      {
        intent: "unknown",
        use_when: "The user asks for something that does not match an approved skill."
      }
    ],
    contract: {
      output: "Return exactly one JSON object and no Markdown.",
      shape: {
        intent: "one allowed intent string",
        command: "required only for run-shell-command; a single /bin/zsh -lc command string",
        confidence: "number from 0 to 1",
        reason: "short reason, no secrets"
      },
      safety: "Do not claim to have performed work. Only choose an allowed intent. `run-shell-command` is intentionally unrestricted and may execute arbitrary shell commands for the allowlisted operator."
    }
  };

  return [
    "You are Hermes planning AO1 Intern chat actions.",
    "The user may ask naturally, and the Intern can run arbitrary shell commands through the approved `run-shell-command` skill.",
    "Choose the single best allowed intent from the payload.",
    "Return exactly one JSON object with `intent`, optional `command`, `confidence`, and `reason`.",
    JSON.stringify(payload, null, 2)
  ].join("\n\n");
}

export function parseChatIntentPlannerOutput(text = "") {
  const parsed = JSON.parse(extractJsonObject(String(text)));
  return normalizeChatPlan(parsed, "hermes");
}

function normalizeChatPlan(value, source) {
  return chatPlan(value?.intent, source, value?.reason, value?.confidence, {
    command: value?.command
  });
}

function chatPlan(intent, source, reason = "", confidence = 1, extra = {}) {
  const normalizedIntent = ALLOWED_INTENTS.has(intent) ? intent : "unknown";
  return {
    intent: normalizedIntent,
    source,
    confidence: Number.isFinite(Number(confidence)) ? Number(confidence) : 0,
    reason: String(reason || ""),
    ...(extra.command ? { command: String(extra.command) } : {})
  };
}

function extractExplicitShellCommand(text = "") {
  const value = String(text || "").trim();
  const codeBlock = value.match(/```(?:bash|sh|zsh|shell)?\s*([\s\S]*?)```/i);
  if (codeBlock?.[1]?.trim()) return codeBlock[1].trim();
  const inline = value.match(/`([^`]+)`/);
  if (inline?.[1]?.trim()) return inline[1].trim();
  const prefixed = value.match(/^(?:run|execute|shell|terminal)\s*[:\-]\s*(.+)$/i);
  if (prefixed?.[1]?.trim()) return prefixed[1].trim();
  return "";
}

function extractCodexPrompt(text = "") {
  const value = String(text || "").trim();
  const match = value.match(/^(?:ask|prompt|run)\s+codex\s*(?:to|:|-)?\s*(.+)$/i);
  const prompt = match?.[1]?.trim();
  if (!prompt) return "";
  return `codex exec --cd /Users/magnus/Documents/Projects/ao1-intern ${shellQuote(prompt)}`;
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function extractJsonObject(text) {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("Chat intent planner output did not contain JSON.");
  }
  return text.slice(start, end + 1);
}
