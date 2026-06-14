import { runCodexExec } from "./codex-driver.mjs";
import { runHermesOneshot } from "./hermes-driver.mjs";
import { createHostBroker } from "./host-broker.mjs";
import { generateHostBrokerPolicy } from "./policy.mjs";

const CODEX_EXPECTED = "AO1_CODEX_SCHEDULE_SMOKE_OK";
const HERMES_EXPECTED = "AO1_HERMES_SCHEDULE_SMOKE_OK";

export function scheduledRuntimeEnv(env = process.env) {
  return {
    HOME: env.HOME || "",
    PATH: env.PATH || ""
  };
}

export function runScheduledRuntimeSmoke({
  config,
  manifest,
  kbPath,
  repoPath,
  env = scheduledRuntimeEnv(),
  execFile
}) {
  const broker = createHostBroker({
    policy: generateHostBrokerPolicy({ manifest, config }),
    execFile
  });

  const codexOutput = runCodexExec({
    repo: kbPath,
    prompt: `Return exactly: ${CODEX_EXPECTED}`,
    model: config.codex_exec?.model,
    serviceTier: config.codex_exec?.service_tier,
    sandbox: config.codex_exec?.sandbox,
    ignoreUserConfig: config.codex_exec?.ignore_user_config,
    ephemeral: config.codex_exec?.ephemeral,
    env,
    execFile: broker.codexExecFile
  });
  assertExpectedSmokeOutput(codexOutput, CODEX_EXPECTED, "Codex");

  const hermesOutput = runHermesOneshot({
    prompt: `Return exactly: ${HERMES_EXPECTED}`,
    command: config.hermes?.command,
    cwd: config.hermes?.cwd || repoPath,
    ignoreRules: true,
    env,
    execFile: broker.hermesExecFile
  });
  assertExpectedSmokeOutput(hermesOutput, HERMES_EXPECTED, "Hermes");

  return {
    codex: { status: "ok", expected: CODEX_EXPECTED },
    hermes: { status: "ok", expected: HERMES_EXPECTED },
    env: {
      HOME: env.HOME,
      PATH: env.PATH
    }
  };
}

function assertExpectedSmokeOutput(output, expected, label) {
  if (String(output || "").trim() !== expected) {
    throw new Error(`${label} scheduled runtime smoke returned unexpected output.`);
  }
}
