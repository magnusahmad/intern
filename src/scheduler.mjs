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
  env = scheduledCommandEnv(),
  outDir = path.join(repoPath, ".ao1-intern", "schedules")
}) {
  const cron = observerCronForKb(kbPath);
  fs.mkdirSync(outDir, { recursive: true });
  const logPath = path.join(repoPath, ".ao1-intern", "logs", "observer.log");
  const cronPath = path.join(outDir, "ao1-intern.cron");
  const installPath = path.join(outDir, "INSTALL.md");
  const command = [
    `cd ${shellQuote(repoPath)}`,
    "&&",
    renderEnvAssignments(env),
    "npm run intern -- file-latest-sync",
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

function scheduledCommandEnv(env = process.env) {
  return {
    HOME: env.HOME || "",
    PATH: env.PATH || ""
  };
}

function renderEnvAssignments(env) {
  return Object.entries(env)
    .filter(([, value]) => value)
    .map(([key, value]) => `${key}=${shellQuote(value)}`)
    .join(" ");
}
