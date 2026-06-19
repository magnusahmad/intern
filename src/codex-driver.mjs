// Codex driver — kept as minimal stub interface.
// The full Codex exec implementation was part of the V1 dogfood pipeline.
// The delegation templates and policy generator read these interfaces.
export function normalizeCodexExecConfig(codexConfig = {}) {
  const serviceTier = codexConfig.serviceTier ?? codexConfig.service_tier;
  if (codexConfig.ignore_user_config === false || codexConfig.ignoreUserConfig === false) {
    throw new Error("AO1 Intern Codex exec must ignore user config.");
  }
  if (codexConfig.ephemeral === false) {
    throw new Error("AO1 Intern Codex exec must be ephemeral.");
  }
  return {
    model: codexConfig.model || null,
    serviceTier: serviceTier || null,
    sandbox: codexConfig.sandbox || null,
    ignoreUserConfig: true,
    ephemeral: true
  };
}

export function buildCodexExecInvocation({
  repo,
  prompt,
  model,
  serviceTier,
  sandbox,
  ignoreUserConfig,
  ephemeral
}) {
  const args = ["exec"];
  if (model) args.push("--model", model);
  if (serviceTier) args.push("-c", `service_tier="${serviceTier}"`);
  if (ignoreUserConfig) args.push("--ignore-user-config");
  if (ephemeral) args.push("--ephemeral");
  if (sandbox) args.push("--sandbox", sandbox);
  args.push("--cd", repo);
  args.push(prompt);
  return { command: "exec", args };
}

export function runCodexExec({ prompt, model, serviceTier, sandbox, ignoreUserConfig, ephemeral, env, execFile }) {
  // Stub — the scheduled-runtime-smoke command is for Hermes and policy-artifacts.
  // Replace with real implementation when Codex exec is re-wired.
  throw new Error("runCodexExec is not implemented in this stub.");
}
