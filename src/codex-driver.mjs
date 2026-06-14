import { assertNoSecretsInText } from "./secrets.mjs";
import { execFileSync } from "node:child_process";

export const DEFAULT_CODEX_EXEC_CONFIG = Object.freeze({
  model: "gpt-5.5",
  serviceTier: "fast",
  sandbox: "read-only",
  ignoreUserConfig: true,
  ephemeral: true
});

export function normalizeCodexExecConfig(config = {}) {
  const ignoreUserConfig = config.ignoreUserConfig ?? config.ignore_user_config;
  const serviceTier = config.serviceTier ?? config.service_tier;

  if (ignoreUserConfig === false) {
    throw new Error("AO1 Intern Codex exec must ignore user config.");
  }
  if (config.ephemeral === false) {
    throw new Error("AO1 Intern Codex exec must be ephemeral.");
  }

  return {
    model: config.model ?? DEFAULT_CODEX_EXEC_CONFIG.model,
    serviceTier: serviceTier ?? DEFAULT_CODEX_EXEC_CONFIG.serviceTier,
    sandbox: config.sandbox ?? DEFAULT_CODEX_EXEC_CONFIG.sandbox,
    ignoreUserConfig: true,
    ephemeral: true
  };
}

export function buildCodexExecInvocation({
  repo,
  prompt,
  model = DEFAULT_CODEX_EXEC_CONFIG.model,
  serviceTier = DEFAULT_CODEX_EXEC_CONFIG.serviceTier,
  sandbox = DEFAULT_CODEX_EXEC_CONFIG.sandbox,
  ignoreUserConfig = DEFAULT_CODEX_EXEC_CONFIG.ignoreUserConfig,
  ephemeral = DEFAULT_CODEX_EXEC_CONFIG.ephemeral
}) {
  const codexConfig = normalizeCodexExecConfig({
    model,
    serviceTier,
    sandbox,
    ignoreUserConfig,
    ephemeral
  });
  const args = ["exec"];
  if (codexConfig.ignoreUserConfig) args.push("--ignore-user-config");
  if (codexConfig.serviceTier) args.push("-c", `service_tier="${codexConfig.serviceTier}"`);
  if (codexConfig.model) args.push("--model", codexConfig.model);
  if (codexConfig.sandbox) args.push("--sandbox", codexConfig.sandbox);
  if (codexConfig.ephemeral) args.push("--ephemeral");
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
