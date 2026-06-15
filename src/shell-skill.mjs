import { execFileSync } from "node:child_process";
import path from "node:path";

export function runShellSkill({
  command,
  cwd = process.cwd(),
  timeoutMs = 120000,
  maxOutputChars = 6000,
  execFile = execFileSync
} = {}) {
  if (!command || !String(command).trim()) {
    return {
      status: "failed",
      exitCode: null,
      stdout: "",
      stderr: "No shell command was provided."
    };
  }

  try {
    const stdout = execFile("/bin/zsh", ["-lc", String(command)], {
      cwd: path.resolve(cwd),
      encoding: "utf8",
      timeout: Number(timeoutMs),
      maxBuffer: 1024 * 1024 * 10,
      env: process.env
    });
    return {
      status: "ok",
      exitCode: 0,
      stdout: truncate(stdout, maxOutputChars),
      stderr: ""
    };
  } catch (error) {
    return {
      status: "failed",
      exitCode: Number.isInteger(error.status) ? error.status : null,
      stdout: truncate(error.stdout || "", maxOutputChars),
      stderr: truncate(error.stderr || error.message || "", maxOutputChars)
    };
  }
}

export function formatShellReply({ command, result, maxReplyChars = 3500 } = {}) {
  const parts = [
    `Shell ${result?.status || "failed"}${result?.exitCode === null || result?.exitCode === undefined ? "" : ` (exit ${result.exitCode})`}.`,
    `Command: ${command || ""}`
  ];
  if (result?.stdout) parts.push(`stdout:\n${result.stdout.trimEnd()}`);
  if (result?.stderr) parts.push(`stderr:\n${result.stderr.trimEnd()}`);
  if (!result?.stdout && !result?.stderr) parts.push("No output.");
  return truncate(parts.join("\n"), maxReplyChars);
}

function truncate(value, maxChars) {
  const text = String(value || "");
  const limit = Math.max(0, Number(maxChars || 0));
  if (!limit || text.length <= limit) return text;
  return `${text.slice(0, limit)}\n[truncated ${text.length - limit} chars]`;
}
