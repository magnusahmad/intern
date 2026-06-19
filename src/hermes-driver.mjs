import { execFileSync, spawnSync } from "node:child_process";
import { assertNoSecretsInText } from "./secrets.mjs";

const DEFAULT_HERMES_COMMAND = "/Users/magnus/.local/bin/hermes";

export function buildHermesOneshotInvocation({
  command = DEFAULT_HERMES_COMMAND,
  prompt,
  model,
  provider,
  toolsets,
  skills,
  ignoreUserConfig = false,
  ignoreRules = false,
  yolo = false
}) {
  if (!prompt) throw new Error("Hermes prompt is required");
  const args = [];
  if (model) args.push("--model", model);
  if (provider) args.push("--provider", provider);
  if (toolsets) args.push("--toolsets", normalizeList(toolsets));
  for (const skill of normalizeArray(skills)) args.push("--skills", skill);
  if (ignoreUserConfig) args.push("--ignore-user-config");
  if (ignoreRules) args.push("--ignore-rules");
  if (yolo) args.push("--yolo");
  args.push("--oneshot", prompt);
  return { command, args };
}

export function buildHermesChatInvocation({
  command = DEFAULT_HERMES_COMMAND,
  query,
  model,
  provider,
  toolsets,
  skills,
  source,
  continueSession,
  resume,
  quiet = true,
  yolo = false,
  maxTurns
}) {
  if (!query) throw new Error("Hermes chat query is required");
  const args = ["chat", "--query", query];
  if (quiet) args.push("--quiet");
  if (model) args.push("--model", model);
  if (provider) args.push("--provider", provider);
  if (toolsets) args.push("--toolsets", normalizeList(toolsets));
  for (const skill of normalizeArray(skills)) args.push("--skills", skill);
  if (source) args.push("--source", source);
  if (continueSession) {
    args.push("--continue");
    if (typeof continueSession === "string") args.push(continueSession);
  }
  if (resume) args.push("--resume", resume);
  if (maxTurns !== undefined) args.push("--max-turns", String(maxTurns));
  if (yolo) args.push("--yolo");
  return { command, args };
}

export function runHermesOneshot({
  prompt,
  command,
  model,
  provider,
  toolsets,
  skills,
  ignoreUserConfig,
  ignoreRules,
  yolo,
  cwd,
  env,
  execFile = execFileSync
}) {
  const invocation = buildHermesOneshotInvocation({
    command,
    prompt,
    model,
    provider,
    toolsets,
    skills,
    ignoreUserConfig,
    ignoreRules,
    yolo
  });
  const options = {
    cwd,
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 10
  };
  if (env) options.env = env;
  const output = execFileChecked(execFile, invocation.command, invocation.args, options);
  return validateHermesOutput(String(output));
}

export function runHermesChat({
  query,
  command,
  model,
  provider,
  toolsets,
  skills,
  source,
  continueSession,
  resume,
  quiet,
  yolo,
  maxTurns,
  timeoutMs,
  cwd,
  env,
  execFile,
  spawnFile = spawnSync
}) {
  const invocation = buildHermesChatInvocation({
    command,
    query,
    model,
    provider,
    toolsets,
    skills,
    source,
    continueSession,
    resume,
    quiet,
    yolo,
    maxTurns
  });
  const options = {
    cwd,
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 10
  };
  if (timeoutMs !== undefined) {
    options.timeout = Number(timeoutMs);
    options.killSignal = "SIGTERM";
  }
  if (env) options.env = env;
  if (execFile) {
    const output = execFileChecked(execFile, invocation.command, invocation.args, options);
    return validateHermesOutput(String(output));
  }
  const result = spawnFile(invocation.command, invocation.args, options);
  return validateHermesProcessResult(result, { timeoutMs: options.timeout });
}

export function validateHermesOutput(text) {
  const output = String(text || "");
  assertNoSecretsInText(output, "hermes output");
  const finalMessage = extractLastAssistantMessage(output);
  const reply = finalMessage || output;
  if (!reply.trim()) throw new Error("Hermes output is empty");
  return reply;
}

export function extractLastAssistantMessage(text) {
  const source = String(text || "");
  const key = "\"last-assistant-message\"";
  let searchFrom = source.length;
  while (searchFrom > 0) {
    const keyIndex = source.lastIndexOf(key, searchFrom - 1);
    if (keyIndex === -1) return "";
    const start = source.lastIndexOf("{", keyIndex);
    if (start === -1) return "";
    const parsed = parseJsonObjectAt(source, start);
    if (parsed?.value && typeof parsed.value["last-assistant-message"] === "string") {
      return parsed.value["last-assistant-message"];
    }
    searchFrom = keyIndex;
  }
  return "";
}

function validateHermesProcessResult(result, { timeoutMs } = {}) {
  if (result?.error) {
    if (result.error.code === "ETIMEDOUT") {
      throw new Error(`Hermes chat timed out after ${timeoutMs ?? "configured"}ms`);
    }
    throw result.error;
  }
  const stdout = stringifyChildOutput(result?.stdout);
  const stderr = stringifyChildOutput(result?.stderr);
  const combined = [stdout, stderr].filter(Boolean).join("\n");
  if ((result?.status ?? 0) !== 0) {
    const error = new Error("Hermes exited with non-zero status");
    error.status = result?.status;
    error.stdout = stdout;
    error.stderr = stderr;
    throw formatExecFailure(error);
  }
  const finalMessage = extractLastAssistantMessage(combined);
  if (finalMessage) return validateHermesOutput(finalMessage);
  return validateHermesOutput(stdout || stderr);
}

function parseJsonObjectAt(text, start) {
  let depth = 0;
  let inString = false;
  let escape = false;
  for (let index = start; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escape) {
        escape = false;
      } else if (char === "\\") {
        escape = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }
    if (char === "\"") {
      inString = true;
    } else if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        try {
          return { value: JSON.parse(text.slice(start, index + 1)), end: index + 1 };
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

function execFileChecked(execFile, command, args, options) {
  try {
    return execFile(command, args, options);
  } catch (error) {
    throw formatExecFailure(error);
  }
}

function formatExecFailure(error) {
  const detail = [
    stringifyChildOutput(error?.stderr),
    stringifyChildOutput(error?.stdout)
  ].map((part) => part.trim()).filter(Boolean).join("\n");
  if (detail) {
    assertNoSecretsInText(detail, "hermes failure output");
    return new Error(`Hermes exited with code ${error?.status ?? "unknown"}:\n${truncate(detail, 1800)}`);
  }
  return error;
}

function stringifyChildOutput(value) {
  if (!value) return "";
  return Buffer.isBuffer(value) ? value.toString("utf8") : String(value);
}

function truncate(value, maxChars) {
  const text = String(value || "");
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars - 16).trimEnd()}\n[truncated]`;
}

function normalizeList(value) {
  return normalizeArray(value).join(",");
}

function normalizeArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value.filter(Boolean) : String(value).split(",").map((entry) => entry.trim()).filter(Boolean);
}
