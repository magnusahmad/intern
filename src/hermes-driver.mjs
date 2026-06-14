import { execFileSync } from "node:child_process";
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
  const output = execFile(invocation.command, invocation.args, options);
  return validateHermesOutput(String(output));
}

export function validateHermesOutput(text) {
  assertNoSecretsInText(text, "hermes output");
  if (!text.trim()) throw new Error("Hermes output is empty");
  return text;
}

function normalizeList(value) {
  return normalizeArray(value).join(",");
}

function normalizeArray(value) {
  if (!value) return [];
  return Array.isArray(value) ? value.filter(Boolean) : String(value).split(",").map((entry) => entry.trim()).filter(Boolean);
}
