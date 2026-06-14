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
  const stdoutPath = path.join(repoPath, ".ao1-intern", "logs", "observer.out.log");
  const stderrPath = path.join(repoPath, ".ao1-intern", "logs", "observer.err.log");
  fs.mkdirSync(path.dirname(stdoutPath), { recursive: true });
  const cronPath = path.join(outDir, "ao1-intern.cron");
  const launchAgentPath = path.join(outDir, "com.ao1.intern.observer.plist");
  const installPath = path.join(outDir, "INSTALL.md");
  const launchAgentProfilePath = scheduledSandboxProfilePath({ repoPath, config });
  const launchAgentWorkingDirectory = scheduledLaunchAgentWorkingDirectory({ config });
  const nodeCommand = scheduledNodeCommand({ config });
  const scheduledEnv = scheduledCommandEnv(env, config);
  const filingArgs = renderScheduledCliArguments({ repoPath, kbPath, configPath, config });
  const filingCommand = [
    renderEnvAssignments(scheduledEnv),
    renderShellCommand(filingArgs)
  ].filter(Boolean).join(" ");
  const command = [
    `cd ${shellQuote(repoPath)}`,
    "&&",
    filingCommand,
    `>> ${shellQuote(logPath)} 2>&1`
  ].filter(Boolean).join(" ");
  fs.writeFileSync(cronPath, `${cron} ${command}\n`);
  fs.writeFileSync(launchAgentPath, renderObserverLaunchAgent({
    cron,
    programArguments: filingArgs,
    environment: scheduledEnv,
    workingDirectory: launchAgentWorkingDirectory,
    stdoutPath,
    stderrPath
  }));
  fs.writeFileSync(
    installPath,
    [
      "# AO1 Intern Schedule",
      "",
      "Manual installation only. Review the generated cron snippet before installing it.",
      "",
      "If the command uses `sandbox-exec`, regenerate and review policy artifacts first:",
      "",
      "```bash",
      `npm run intern -- policy-artifacts --permissions config/permissions.example.json${configPath ? ` --config ${shellQuote(configPath)}` : ""}`,
      `npm run intern -- review-artifacts${configPath ? ` --config ${shellQuote(configPath)}` : ""}`,
      "```",
      "",
      "Preferred macOS LaunchAgent install after review:",
      "",
      "The LaunchAgent applies the reviewed sandbox profile from `runtime.macos_sandbox.launch_agent_profile_path`:",
      "",
      "macOS privacy preflight: when the Intern repo or KB live under `~/Documents`, grant Full Disk Access to the scheduled Node runtime before bootstrapping the LaunchAgent. On this machine that runtime is:",
      "",
      `- \`${nodeCommand}\``,
      "",
      "The generator cannot grant this permission. Without it, launchd may hang while Node opens repo files. Run the machine preflight before bootstrapping; it submits a one-shot launchd Node read probe and must return `passed`:",
      "",
      "```bash",
      `npm run intern -- launchd-preflight --kb ${shellQuote(kbPath)}${configPath ? ` --config ${shellQuote(configPath)}` : ""}`,
      "```",
      "",
      "```bash",
      `mkdir -p ${shellQuote(path.dirname(launchAgentProfilePath))}`,
      `cp ${shellQuote(path.join(repoPath, ".ao1-intern", "policies", "host-broker.sb"))} ${shellQuote(launchAgentProfilePath)}`,
      `launchctl bootstrap gui/$(id -u) ${shellQuote(launchAgentPath)}`,
      `launchctl kickstart -k gui/$(id -u)/com.ao1.intern.observer`,
      "```",
      "",
      "Uninstall the LaunchAgent if needed:",
      "",
      "```bash",
      `launchctl bootout gui/$(id -u) ${shellQuote(launchAgentPath)}`,
      "```",
      "",
      "Cron fallback after review:",
      "",
      "Merge the snippet with the existing crontab after review; do not replace an existing crontab blindly:",
      "",
      "```bash",
      "crontab -l > /tmp/ao1-intern-existing.cron 2>/dev/null || true",
      `cat /tmp/ao1-intern-existing.cron ${shellQuote(cronPath)} > /tmp/ao1-intern-merged.cron`,
      "$EDITOR /tmp/ao1-intern-merged.cron",
      "crontab /tmp/ao1-intern-merged.cron",
      "```",
      "",
      "This command is intentionally not run by the generator."
    ].join("\n") + "\n"
  );
  return { cronPath, launchAgentPath, installPath, cron, command };
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function scheduledCommandEnv(env = process.env, config = {}) {
  const scheduledEnv = {
    HOME: env.HOME || "",
    PATH: env.PATH || "",
    TMPDIR: env.TMPDIR || "/private/tmp",
    USER: env.USER || "",
    LOGNAME: env.LOGNAME || env.USER || "",
    SHELL: env.SHELL || "/bin/zsh"
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

function renderShellCommand(args) {
  return args.map(shellQuote).join(" ");
}

function renderScheduledCliArguments({ repoPath, kbPath, configPath, config }) {
  const nodeCommand = scheduledNodeCommand({ config });
  const cliPath = path.join(repoPath, "src", "cli.mjs");
  const cliArgs = [
    nodeCommand,
    cliPath,
    "file-latest-sync",
    "--repo",
    repoPath,
    "--kb",
    kbPath
  ];
  if (configPath) cliArgs.push("--config", configPath);
  if (!shouldWrapWithMacOSSandbox(config)) return cliArgs;
  const profilePath = scheduledSandboxProfilePath({ repoPath, config });
  return [scheduledSandboxExecCommand({ config }), "-f", profilePath, ...cliArgs];
}

function scheduledSandboxExecCommand({ config }) {
  return config.runtime?.macos_sandbox?.sandbox_exec_command || "/usr/bin/sandbox-exec";
}

function scheduledNodeCommand({ config }) {
  return config.runtime?.macos_sandbox?.node_command || process.execPath || "node";
}

function scheduledSandboxProfilePath({ repoPath, config }) {
  return config.runtime?.macos_sandbox?.launch_agent_profile_path
    || config.runtime?.macos_sandbox?.profile_path
    || path.join(repoPath, ".ao1-intern", "policies", "host-broker.sb");
}

function scheduledLaunchAgentWorkingDirectory({ config }) {
  return config.runtime?.macos_sandbox?.launch_agent_working_directory || "/private/tmp";
}

function shouldWrapWithMacOSSandbox(config) {
  return config.runtime?.execution_boundary === "host-broker" && config.runtime?.macos_sandbox?.schedule_wrapper !== false;
}

function renderObserverLaunchAgent({ cron, programArguments, environment, workingDirectory, stdoutPath, stderrPath }) {
  const intervals = calendarIntervalsFromCron(cron);
  return [
    "<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
    "<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">",
    "<plist version=\"1.0\">",
    "<dict>",
    "  <key>Label</key>",
    "  <string>com.ao1.intern.observer</string>",
    "  <key>ProgramArguments</key>",
    "  <array>",
    ...programArguments.map((argument) => `    <string>${escapeXml(argument)}</string>`),
    "  </array>",
    ...renderEnvironmentDict(environment),
    "  <key>WorkingDirectory</key>",
    `  <string>${escapeXml(workingDirectory)}</string>`,
    "  <key>StartCalendarInterval</key>",
    "  <array>",
    ...intervals.flatMap(({ hour, minute }) => [
      "    <dict>",
      "      <key>Hour</key>",
      `      <integer>${hour}</integer>`,
      "      <key>Minute</key>",
      `      <integer>${minute}</integer>`,
      "    </dict>"
    ]),
    "  </array>",
    "  <key>StandardOutPath</key>",
    `  <string>${escapeXml(stdoutPath)}</string>`,
    "  <key>StandardErrorPath</key>",
    `  <string>${escapeXml(stderrPath)}</string>`,
    "</dict>",
    "</plist>",
    ""
  ].join("\n");
}

function renderEnvironmentDict(environment) {
  const entries = Object.entries(environment).filter(([, value]) => value);
  if (entries.length === 0) return [];
  return [
    "  <key>EnvironmentVariables</key>",
    "  <dict>",
    ...entries.flatMap(([key, value]) => [
      `    <key>${escapeXml(key)}</key>`,
      `    <string>${escapeXml(value)}</string>`
    ]),
    "  </dict>"
  ];
}

function calendarIntervalsFromCron(cron) {
  const [minute, hours, dayOfMonth, month, dayOfWeek] = cron.split(/\s+/);
  if (dayOfMonth !== "*" || month !== "*" || dayOfWeek !== "*") {
    throw new Error(`Unsupported scheduler cron expression for LaunchAgent: ${cron}`);
  }
  return hours.split(",").map((hour) => ({
    hour: Number(hour),
    minute: Number(minute)
  }));
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&apos;");
}
