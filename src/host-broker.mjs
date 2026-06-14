import { execFileSync } from "node:child_process";
import path from "node:path";
import { assertNoSecretsInText } from "./secrets.mjs";

export function createHostBroker({ policy, execFile = execFileSync }) {
  assertHostBrokerPolicy(policy);
  return {
    codexExecFile(command, args = [], options = {}) {
      assertHostBrokerInvocation({ policy, role: "codex", command, args, options });
      return execFile(command, args, options);
    },
    hermesExecFile(command, args = [], options = {}) {
      assertHostBrokerInvocation({ policy, role: "hermes", command, args, options });
      return execFile(command, args, options);
    }
  };
}

export function assertHostBrokerInvocation({ policy, role, command, args = [], options = {} }) {
  assertHostBrokerPolicy(policy);
  assertNoSecretsInText([command, ...args].join("\n"), `${role} invocation`);
  if (options.shell === true) throw new Error("Host broker does not allow shell execution.");
  if (role === "codex") return assertCodexInvocation({ policy, command, args });
  if (role === "hermes") return assertHermesInvocation({ policy, command, args, options });
  throw new Error(`Unsupported host broker role: ${role}`);
}

function assertHostBrokerPolicy(policy) {
  if (policy?.version !== "ao1-intern.host-broker-policy.v1") {
    throw new Error("Host broker policy version is unsupported.");
  }
  if (policy.execution_boundary !== "host-broker") {
    throw new Error("Host broker policy must use host-broker execution boundary.");
  }
}

function assertCodexInvocation({ policy, command, args }) {
  const codex = policy.tools?.codex || {};
  if (!codex.allow) throw new Error("Codex exec is not allowed by host broker policy.");
  if (command !== codex.command) throw new Error("Codex command does not match host broker policy.");
  if (args[0] !== "exec") throw new Error("Codex host broker only allows `codex exec`.");
  if (codex.ignore_user_config && !args.includes("--ignore-user-config")) {
    throw new Error("Codex exec must ignore user config under host broker policy.");
  }
  if (codex.ephemeral && !args.includes("--ephemeral")) {
    throw new Error("Codex exec must be ephemeral under host broker policy.");
  }
  if (codex.model && valueAfter(args, "--model") !== codex.model) {
    throw new Error("Codex model does not match host broker policy.");
  }
  if (codex.sandbox && valueAfter(args, "--sandbox") !== codex.sandbox) {
    throw new Error(`Codex sandbox must be ${codex.sandbox} under host broker policy.`);
  }
  if (codex.service_tier && !hasServiceTier(args, codex.service_tier)) {
    throw new Error("Codex service tier does not match host broker policy.");
  }
  const cwd = valueAfter(args, "--cd");
  if (!cwd || !isAllowedReadPath(policy, cwd)) {
    throw new Error("Codex --cd path is not in host broker read roots.");
  }
}

function assertHermesInvocation({ policy, command, args, options }) {
  const hermes = policy.tools?.hermes || {};
  if (!hermes.allow) throw new Error("Hermes is not allowed by host broker policy.");
  if (command !== hermes.command) throw new Error("Hermes command does not match host broker policy.");
  if (!args.includes("--oneshot") && !args.includes("-z")) {
    throw new Error("Hermes host broker only allows one-shot execution.");
  }
  if (policy.tools?.deny?.includes("shell-unrestricted") && args.includes("--yolo")) {
    throw new Error("Hermes --yolo is blocked as unrestricted shell access.");
  }
  if (hermes.cwd && path.resolve(options.cwd || "") !== path.resolve(hermes.cwd)) {
    throw new Error("Hermes cwd does not match host broker policy.");
  }
}

function valueAfter(args, flag) {
  const index = args.indexOf(flag);
  if (index === -1) return null;
  return args[index + 1] || null;
}

function hasServiceTier(args, serviceTier) {
  for (let index = 0; index < args.length - 1; index += 1) {
    if (args[index] !== "-c" && args[index] !== "--config") continue;
    const value = args[index + 1];
    if (value === `service_tier="${serviceTier}"` || value === `service_tier=${serviceTier}`) return true;
  }
  return false;
}

function isAllowedReadPath(policy, candidatePath) {
  const resolved = path.resolve(candidatePath);
  return (policy.filesystem?.read || []).some((entry) => {
    const root = path.resolve(entry.path);
    return resolved === root || resolved.startsWith(`${root}${path.sep}`);
  });
}
