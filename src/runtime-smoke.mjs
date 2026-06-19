import { runHermesOneshot } from "./hermes-driver.mjs";
import { createHostBroker } from "./host-broker.mjs";
import { generateHostBrokerPolicy } from "./policy.mjs";

const HERMES_EXPECTED = "AO1_HERMES_SCHEDULE_SMOKE_OK";

export function scheduledRuntimeEnv(env = process.env, config = {}) {
  const runtimeEnv = {
    HOME: env.HOME || "",
    PATH: env.PATH || ""
  };
  const caBundle = config.runtime?.macos_sandbox?.ca_bundle || env.SSL_CERT_FILE;
  if (caBundle) runtimeEnv.SSL_CERT_FILE = caBundle;
  return runtimeEnv;
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
