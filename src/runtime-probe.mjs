import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const DEFAULT_COMMANDS = {
  hermes: "/Users/magnus/.local/bin/hermes",
  codex: "codex",
  nemoclaw: "nemoclaw",
  openshell: "openshell"
};

export function probeRuntime({
  commands = DEFAULT_COMMANDS,
  envPath = process.env.PATH || "",
  commandExists = (command) => defaultCommandExists(command, envPath),
  commandStatus = defaultCommandStatus
} = {}) {
  const resolvedCommands = { ...DEFAULT_COMMANDS, ...commands };
  const result = {
    hermes: probeCommand(resolvedCommands.hermes, commandExists),
    codex: probeCommand(resolvedCommands.codex, commandExists),
    nemoclaw: probeCommand(resolvedCommands.nemoclaw, commandExists),
    openshell: probeCommand(resolvedCommands.openshell, commandExists),
    ready: false,
    blockers: []
  };

  if (result.openshell.found) {
    result.openshell.gateway = probeOpenShellGateway(resolvedCommands.openshell, commandStatus);
  }

  if (!result.hermes.found) result.blockers.push("Hermes executable was not found.");
  if (!result.codex.found) result.blockers.push("Codex executable was not found.");
  if (!result.nemoclaw.found && !result.openshell.found) {
    result.blockers.push("Neither NemoClaw or OpenShell executable was found; containment is not yet verifiable.");
  }
  if (!result.nemoclaw.found && result.openshell.found && !result.openshell.gateway.ready) {
    result.blockers.push("OpenShell gateway is not connected; containment is not yet runnable.");
  }

  result.ready = result.blockers.length === 0;
  return result;
}

function probeCommand(command, commandExists) {
  return {
    command,
    found: Boolean(command && commandExists(command))
  };
}

function probeOpenShellGateway(command, commandStatus) {
  const status = commandStatus(command, ["status"]);
  return {
    checked: true,
    ready: status.ok,
    output: compactOutput(status.output || "")
  };
}

function defaultCommandExists(command, envPath) {
  if (path.isAbsolute(command)) return isExecutable(command);
  for (const dir of envPath.split(path.delimiter).filter(Boolean)) {
    if (isExecutable(path.join(dir, command))) return true;
  }
  return false;
}

function isExecutable(file) {
  try {
    fs.accessSync(file, fs.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function defaultCommandStatus(command, args) {
  try {
    return {
      ok: true,
      output: execFileSync(command, args, {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        timeout: 5000
      })
    };
  } catch (error) {
    return {
      ok: false,
      output: [error.stdout, error.stderr, error.message].filter(Boolean).join("\n")
    };
  }
}

function compactOutput(output) {
  return output.replace(/\u001b\[[0-9;]*m/g, "").trim().slice(0, 1200);
}
