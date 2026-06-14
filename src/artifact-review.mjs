import fs from "node:fs";
import path from "node:path";
import { observerCronForKb } from "./scheduler.mjs";
import { findSecrets } from "./secrets.mjs";
import { readJson } from "./fs-util.mjs";

const POLICY_FILES = [
  "openshell-policy.json",
  "host-broker-policy.json",
  "host-broker.sb",
  "com.ao1.intern.openshell-gateway.plist",
  "README.md"
];

const SCHEDULE_FILES = [
  "ao1-intern.cron",
  "com.ao1.intern.observer.plist",
  "INSTALL.md"
];

export function reviewArtifacts({
  repoPath = process.cwd(),
  kbPath = null,
  config = {},
  policyDir = path.join(repoPath, ".ao1-intern", "policies"),
  scheduleDir = path.join(repoPath, ".ao1-intern", "schedules")
} = {}) {
  const checks = [
    ...checkExpectedFiles(policyDir, POLICY_FILES, "policy artifact"),
    ...checkExpectedFiles(scheduleDir, SCHEDULE_FILES, "schedule artifact")
  ];

  checks.push(checkNoSecrets({ dirs: [policyDir, scheduleDir] }));
  checks.push(...checkHostBrokerPolicy({
    file: path.join(policyDir, "host-broker-policy.json"),
    repoPath
  }));
  checks.push(...checkSchedule({
    file: path.join(scheduleDir, "ao1-intern.cron"),
    kbPath,
    repoPath,
    config
  }));
  checks.push(...checkObserverLaunchAgent({
    file: path.join(scheduleDir, "com.ao1.intern.observer.plist"),
    kbPath,
    repoPath,
    config
  }));
  checks.push(...checkScheduleInstall({
    file: path.join(scheduleDir, "INSTALL.md"),
    cronPath: path.join(scheduleDir, "ao1-intern.cron"),
    config
  }));
  checks.push(...checkLaunchAgent({
    file: path.join(policyDir, "com.ao1.intern.openshell-gateway.plist")
  }));
  checks.push(...checkPolicyReadme({
    file: path.join(policyDir, "README.md")
  }));

  return {
    status: checks.every((check) => check.status === "passed") ? "passed" : "failed",
    checks,
    manualNextSteps: [
      "Review generated artifacts with a human before installing them.",
      "Start or install the OpenShell gateway LaunchAgent manually.",
      "Install the reviewed scheduler manually.",
      "Observe the first unattended dogfood run."
    ]
  };
}

function checkExpectedFiles(dir, files, label) {
  return files.map((file) => {
    const artifactPath = path.join(dir, file);
    return fs.existsSync(artifactPath)
      ? passed(`${label}: ${file}`, artifactPath)
      : failed(`${label}: ${file}`, `${artifactPath} is missing`);
  });
}

function checkNoSecrets({ dirs }) {
  const matches = [];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    for (const file of listFiles(dir)) {
      const text = fs.readFileSync(file, "utf8");
      const secretMatches = findSecrets(text);
      if (secretMatches.length) {
        matches.push(`${file}: ${secretMatches.join(", ")}`);
      }
    }
  }
  return matches.length
    ? failed("artifact secret scan", matches.join("; "))
    : passed("artifact secret scan", "No secret-like values found in generated artifacts.");
}

function checkHostBrokerPolicy({ file, repoPath }) {
  if (!fs.existsSync(file)) return [failed("host broker policy", `${file} is missing`)];
  let policy;
  try {
    policy = readJson(file);
  } catch (error) {
    return [failed("host broker policy", `Could not parse JSON: ${error.message}`)];
  }

  const codex = policy.tools?.codex || {};
  const hermes = policy.tools?.hermes || {};
  const writeRoots = policy.filesystem?.write || [];
  const deny = policy.tools?.deny || [];
  const secretRefs = policy.secrets?.allowed_refs || [];
  const expectedRepoRoot = path.resolve(repoPath);
  return [
    expectEqual("host broker policy version", policy.version, "ao1-intern.host-broker-policy.v1"),
    expectEqual("host broker execution boundary", policy.execution_boundary, "host-broker"),
    expectEqual("host broker KB write switch", policy.filesystem?.kb_write_enabled, false, "KB write switch must remain disabled for M5 review."),
    expectTrue("host broker write roots", writeRoots.length > 0 && writeRoots.every((entry) => isInside(expectedRepoRoot, entry.path)), "Write roots must stay inside the Intern repo."),
    expectTrue("host broker denied tools", deny.includes("shell-unrestricted") && deny.includes("kb-write-unless-enabled"), "Policy must deny unrestricted shell and KB writes without the switch."),
    expectTrue("host broker secret refs", secretRefs.length > 0 && secretRefs.every((ref) => String(ref).startsWith("keychain://")), "Secrets must be Keychain refs, not values."),
    expectEqual("Hermes command", hermes.command, "/Users/magnus/.local/bin/hermes"),
    expectEqual("Hermes mode", hermes.mode, "oneshot-json-finalizer"),
    expectEqual("Codex command", codex.command, "codex"),
    expectEqual("Codex model", codex.model, "gpt-5.5"),
    expectEqual("Codex service tier", codex.service_tier, "fast"),
    expectEqual("Codex sandbox", codex.sandbox, "read-only", "Codex must stay read-only."),
    expectEqual("Codex user config isolation", codex.ignore_user_config, true),
    expectEqual("Codex ephemeral mode", codex.ephemeral, true)
  ];
}

function checkSchedule({ file, kbPath, repoPath, config }) {
  if (!fs.existsSync(file)) return [failed("schedule artifact", `${file} is missing`)];
  const cron = fs.readFileSync(file, "utf8");
  const expectedCron = kbPath ? observerCronForKb(kbPath) : null;
  const expectedProfilePath = scheduledSandboxProfilePath({ repoPath, config });
  const checks = [
    expectTrue("schedule command uses repo", cron.includes(`cd '${repoPath}'`) || cron.includes(`cd ${shellQuote(repoPath)}`), "Schedule must cd into the Intern repo."),
    expectTrue("schedule command uses file-latest-sync", cron.includes("file-latest-sync"), "Schedule must run the filing command."),
    expectTrue("schedule command passes explicit repo", cron.includes("--repo") && cron.includes(repoPath), "Schedule must pass the Intern repo explicitly for launchd sandbox runs."),
    expectTrue("schedule command uses config", cron.includes("--config"), "Schedule must carry the reviewed config path."),
    expectTrue("schedule command carries HOME", cron.includes("HOME="), "Schedule must carry HOME for machine auth."),
    expectTrue("schedule command carries PATH", cron.includes("PATH="), "Schedule must carry PATH for local tools."),
    expectTrue("schedule command uses sandbox wrapper", cron.includes("sandbox-exec") && cron.includes("-f") && cron.includes(expectedProfilePath), "Schedule must use the reviewed host-broker sandbox profile."),
    expectTrue("schedule command logs output", cron.includes(".ao1-intern/logs/observer.log"), "Schedule must log observer output for dogfood review.")
  ];
  if (expectedCron) {
    checks.unshift(expectTrue("schedule cadence matches KB", cron.startsWith(`${expectedCron} `), `Schedule must start with ${expectedCron}.`));
  }
  return checks;
}

function checkScheduleInstall({ file, cronPath, config = {} }) {
  if (!fs.existsSync(file)) return [failed("schedule install instructions", `${file} is missing`)];
  const install = fs.readFileSync(file, "utf8");
  const nodeCommand = config.runtime?.macos_sandbox?.node_command || "node";
  return [
    expectTrue("schedule install remains manual", install.includes("Manual installation only") && install.includes("not run by the generator"), "Schedule install instructions must stay manual."),
    expectTrue("schedule install includes LaunchAgent", install.includes("launchctl bootstrap") && install.includes("com.ao1.intern.observer.plist"), "Schedule install instructions must include the reviewed LaunchAgent path."),
    expectTrue("schedule install documents macOS TCC", install.includes("Full Disk Access") && install.includes(nodeCommand), "Schedule install instructions must document macOS Full Disk Access for the Node runtime."),
    expectTrue("schedule install runs launchd preflight", install.includes("launchd-preflight") && install.includes("--kb") && install.includes("--config"), "Schedule install instructions must run launchd-preflight before bootstrap."),
    expectTrue("schedule install preserves existing crontab", /crontab -l/.test(install) && /merge/i.test(install), "Schedule install instructions must tell the user to merge with existing crontab entries."),
    expectTrue("schedule install avoids direct crontab replacement", !install.includes(`crontab ${shellQuote(cronPath)}`) && !install.includes(`crontab ${cronPath}`), "Schedule install instructions must not replace the full crontab with the snippet.")
  ];
}

function checkObserverLaunchAgent({ file, kbPath, repoPath, config }) {
  if (!fs.existsSync(file)) return [failed("observer LaunchAgent", `${file} is missing`)];
  const plist = fs.readFileSync(file, "utf8");
  const expectedCron = kbPath ? observerCronForKb(kbPath) : null;
  const expectedProfilePath = scheduledSandboxProfilePath({ repoPath, config });
  const expectedWorkingDirectory = scheduledLaunchAgentWorkingDirectory({ config });
  const checks = [
    expectTrue("observer LaunchAgent label", plist.includes("com.ao1.intern.observer"), "Observer LaunchAgent label must be AO1 Intern specific."),
    expectTrue("observer LaunchAgent command", plist.includes("file-latest-sync") && plist.includes(repoPath), "Observer LaunchAgent must run the Intern filing command from the Intern repo."),
    expectTrue("observer LaunchAgent explicit repo", plist.includes("--repo") && plist.includes(repoPath), "Observer LaunchAgent must pass the Intern repo explicitly for launchd sandbox runs."),
    expectTrue("observer LaunchAgent working directory", plist.includes(`<string>${expectedWorkingDirectory}</string>`), `Observer LaunchAgent must run from ${expectedWorkingDirectory}.`),
    expectTrue("observer LaunchAgent sandbox wrapper", plist.includes("sandbox-exec"), "Observer LaunchAgent must use sandbox-exec."),
    expectTrue("observer LaunchAgent sandbox profile", plist.includes(expectedProfilePath), `Observer LaunchAgent must use ${expectedProfilePath}.`),
    expectTrue("observer LaunchAgent direct sandbox command", plist.includes("<string>/usr/bin/sandbox-exec</string>") && !/<array>\s*<string>\/bin\/zsh<\/string>/.test(plist) && !plist.includes("<string>-lc</string>"), "Observer LaunchAgent must invoke sandbox-exec directly without shell wrapping."),
    expectTrue("observer LaunchAgent environment", ["HOME", "PATH", "TMPDIR", "USER", "LOGNAME", "SHELL"].every((key) => plist.includes(`<key>${key}</key>`)), "Observer LaunchAgent must carry machine auth and login environment explicitly."),
    expectTrue("observer LaunchAgent config", plist.includes("ao1-intern.example.json"), "Observer LaunchAgent must carry the reviewed config path."),
    expectTrue("observer LaunchAgent logs", plist.includes(".ao1-intern/logs/observer.out.log") && plist.includes(".ao1-intern/logs/observer.err.log"), "Observer LaunchAgent must log under Intern state.")
  ];
  if (expectedCron) {
    const intervals = intervalsFromCron(expectedCron);
    checks.push(expectTrue("observer LaunchAgent schedule", intervals.every(({ hour, minute }) => (
      plist.includes(`<integer>${hour}</integer>`) && plist.includes(`<integer>${minute}</integer>`)
    )), "Observer LaunchAgent must include each KB cron hour and minute."));
  }
  return checks;
}

function checkLaunchAgent({ file }) {
  if (!fs.existsSync(file)) return [failed("OpenShell gateway LaunchAgent", `${file} is missing`)];
  const plist = fs.readFileSync(file, "utf8");
  return [
    expectTrue("OpenShell gateway LaunchAgent label", plist.includes("com.ao1.intern.openshell-gateway"), "LaunchAgent label must be AO1 Intern specific."),
    expectTrue("OpenShell gateway command", plist.includes("/Users/magnus/.local/bin/openshell-gateway"), "LaunchAgent must run openshell-gateway."),
    expectTrue("OpenShell gateway config", plist.includes("/Users/magnus/.config/openshell/ao1-gateway.toml"), "LaunchAgent must use reviewed local gateway config."),
    expectTrue("OpenShell gateway TLS refs", plist.includes("/Users/magnus/.local/state/openshell/ao1-gateway/tls/server/tls.crt") && plist.includes("/Users/magnus/.local/state/openshell/ao1-gateway/tls/server/tls.key"), "LaunchAgent must reference TLS paths, not key contents."),
    expectTrue("OpenShell gateway logs", plist.includes(".ao1-intern/logs/openshell-gateway.out.log") && plist.includes(".ao1-intern/logs/openshell-gateway.err.log"), "LaunchAgent must write logs under Intern state.")
  ];
}

function checkPolicyReadme({ file }) {
  if (!fs.existsSync(file)) return [failed("policy README", `${file} is missing`)];
  const readme = fs.readFileSync(file, "utf8");
  return [
    expectTrue("policy README manual install", readme.includes("not applied automatically") && readme.includes("Manual LaunchAgent install"), "README must keep install manual."),
    expectTrue("policy README sandbox review", readme.includes("sandbox-exec") && readme.includes("scheduled-runtime-smoke"), "README must include sandbox smoke review guidance.")
  ];
}

function listFiles(dir) {
  const entries = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      entries.push(...listFiles(entryPath));
    } else if (entry.isFile()) {
      entries.push(entryPath);
    }
  }
  return entries;
}

function expectEqual(name, actual, expected, detail = `${name} must equal ${JSON.stringify(expected)}.`) {
  return Object.is(actual, expected) ? passed(name, detail) : failed(name, `${detail} Got ${JSON.stringify(actual)}.`);
}

function expectTrue(name, condition, detail) {
  return condition ? passed(name, detail) : failed(name, detail);
}

function passed(name, detail) {
  return { name, status: "passed", detail };
}

function failed(name, detail) {
  return { name, status: "failed", detail };
}

function isInside(parent, candidate) {
  const rel = path.relative(path.resolve(parent), path.resolve(candidate));
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function scheduledSandboxProfilePath({ repoPath, config }) {
  return config.runtime?.macos_sandbox?.launch_agent_profile_path
    || config.runtime?.macos_sandbox?.profile_path
    || path.join(repoPath, ".ao1-intern", "policies", "host-broker.sb");
}

function scheduledLaunchAgentWorkingDirectory({ config }) {
  return config.runtime?.macos_sandbox?.launch_agent_working_directory || "/private/tmp";
}

function intervalsFromCron(cron) {
  const [minute, hours] = cron.split(/\s+/);
  return hours.split(",").map((hour) => ({
    hour: Number(hour),
    minute: Number(minute)
  }));
}
