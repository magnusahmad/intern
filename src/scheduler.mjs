import fs from "node:fs";
import path from "node:path";
import { getKbCron } from "./kb-sync.mjs";

export function observerCronForKb(kbPath) {
  const cron = getKbCron(kbPath);
  if (!cron) throw new Error("KB config has no schedule.cron");
  return cron;
}

export function generateScheduleArtifacts({ kbPath, repoPath, outDir = path.join(repoPath, ".ao1-intern", "schedules") }) {
  const cron = observerCronForKb(kbPath);
  fs.mkdirSync(outDir, { recursive: true });
  const logPath = path.join(repoPath, ".ao1-intern", "logs", "observer.log");
  const cronPath = path.join(outDir, "ao1-intern.cron");
  const installPath = path.join(outDir, "INSTALL.md");
  const command = `cd ${shellQuote(repoPath)} && npm run intern -- file-latest-sync --kb ${shellQuote(kbPath)} >> ${shellQuote(logPath)} 2>&1`;
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
