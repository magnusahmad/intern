import fs from "node:fs";
import path from "node:path";
import { getKbCron } from "./kb-sync.mjs";

export function observerCronForKb(kbPath) {
  const cron = getKbCron(kbPath);
  if (!cron) throw new Error("KB config has no schedule.cron");
  return cron;
}

export function generateScheduleArtifacts({
  kbPath,
  repoPath,
  configPath = path.join(repoPath, "config", "ao1-intern.example.json"),
  config = {},
  env = process.env,
  outDir = path.join(repoPath, ".ao1-intern", "schedules")
}) {
  const cron = observerCronForKb(kbPath);
  fs.mkdirSync(outDir, { recursive: true });
  const logPath = path.join(repoPath, ".ao1-intern", "logs", "observer.log");
  const cronPath = path.join(outDir, "ao1-intern.cron");
  const installPath = path.join(outDir, "INSTALL.md");
  const scheduledEnv = scheduledCommandEnv(env, config);
  const runtimeCommand = renderRuntimeCommand({ repoPath, config });
  const command = [
    `cd ${shellQuote(repoPath)}`,
    "&&",
    renderEnvAssignments(scheduledEnv),
    runtimeCommand,
    "run intern -- file-latest-sync",
    `--kb ${shellQuote(kbPath)}`,
    configPath ? `--config ${shellQuote(configPath)}` : "",
    `>> ${shellQuote(logPath)} 2>&1`
  ].filter(Boolean).join(" ");
  fs.writeFileSync(cronPath, `${cron} ${command}\n`);
  fs.writeFileSync(
    installPath,
    [
      "# AO1 Intern Schedule",
      "",
      "Manual installation only. Review the generated cron file before installing it.",
      "",
      "If the command uses `sandbox-exec`, regenerate and review policy artifacts first:",
      "",
      "```bash",
      `npm run intern -- policy-artifacts --permissions config/permissions.example.json${configPath ? ` --config ${shellQuote(configPath)}` : ""}`,
      "```",
      "",
      "```bash",
      `crontab ${shellQuote(cronPath)}`,
      "```",
      "",
      "This command is intentionally not run by the generator."
    ].join("\n") + "\n"
  );
  return { cronPath, installPath, cron, command };
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function scheduledCommandEnv(env = process.env, config = {}) {
  const scheduledEnv = {
    HOME: env.HOME || "",
    PATH: env.PATH || ""
  };
  const caBundle = config.runtime?.macos_sandbox?.ca_bundle || env.SSL_CERT_FILE;
  if (caBundle) scheduledEnv.SSL_CERT_FILE = caBundle;
  return scheduledEnv;
}

function renderEnvAssignments(env) {
  return Object.entries(env)
    .filter(([, value]) => value)
    .map(([key, value]) => `${key}=${shellQuote(value)}`)
    .join(" ");
}

function renderRuntimeCommand({ repoPath, config }) {
  if (!shouldWrapWithMacOSSandbox(config)) return "npm";
  const profilePath = config.runtime?.macos_sandbox?.profile_path || path.join(repoPath, ".ao1-intern", "policies", "host-broker.sb");
  const npmCommand = config.runtime?.macos_sandbox?.npm_command || "npm";
  return ["sandbox-exec", "-f", shellQuote(profilePath), shellQuote(npmCommand)].join(" ");
}

function shouldWrapWithMacOSSandbox(config) {
  return config.runtime?.execution_boundary === "host-broker" && config.runtime?.macos_sandbox?.schedule_wrapper !== false;
}
