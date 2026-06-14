import { assertNoSecretsInText } from "./secrets.mjs";
import { execFileSync } from "node:child_process";

export function buildCodexExecInvocation({
  repo,
  prompt,
  model = "gpt-5.5",
  serviceTier = "fast",
  sandbox = "read-only",
  ignoreUserConfig = true,
  ephemeral = true
}) {
  const args = ["exec"];
  if (ignoreUserConfig) args.push("--ignore-user-config");
  if (serviceTier) args.push("-c", `service_tier="${serviceTier}"`);
  if (model) args.push("--model", model);
  if (sandbox) args.push("--sandbox", sandbox);
  if (ephemeral) args.push("--ephemeral");
  args.push("--cd", repo);
  args.push(prompt);
  return { command: "codex", args };
}

export function runCodexExec({
  repo,
  prompt,
  model,
  serviceTier,
  sandbox,
  ignoreUserConfig,
  ephemeral,
  env,
  execFile = execFileSync
}) {
  const { command, args } = buildCodexExecInvocation({
    repo,
    prompt,
    model,
    serviceTier,
    sandbox,
    ignoreUserConfig,
    ephemeral
  });
  const options = { encoding: "utf8", maxBuffer: 1024 * 1024 * 10 };
  if (env) options.env = env;
  const output = execFile(command, args, options);
  return validateCodexOutput(String(output));
}

export function validateCodexOutput(text) {
  assertNoSecretsInText(text, "codex output");
  if (!text.trim()) throw new Error("Codex output is empty");
  return text;
}
