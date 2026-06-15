import assert from "node:assert/strict";
import test from "node:test";
import { formatShellReply, runShellSkill } from "../src/shell-skill.mjs";

test("test_shell_skill_runs_zsh_command_and_formats_output", () => {
  const calls = [];
  const result = runShellSkill({
    command: "codex exec --cd /tmp 'summarize status'",
    cwd: "/tmp",
    execFile: (command, args, options) => {
      calls.push({ command, args, options });
      return "Codex summary\n";
    }
  });

  assert.equal(result.status, "ok");
  assert.equal(calls[0].command, "/bin/zsh");
  assert.deepEqual(calls[0].args, ["-lc", "codex exec --cd /tmp 'summarize status'"]);
  assert.equal(calls[0].options.cwd, "/tmp");
  assert.match(formatShellReply({ command: "codex exec --cd /tmp 'summarize status'", result }), /Codex summary/);
});

test("test_shell_skill_returns_failure_output_without_throwing", () => {
  const error = new Error("command failed");
  error.status = 2;
  error.stdout = "partial\n";
  error.stderr = "bad command\n";
  const result = runShellSkill({
    command: "bad-command",
    execFile: () => {
      throw error;
    }
  });

  assert.equal(result.status, "failed");
  assert.equal(result.exitCode, 2);
  assert.equal(result.stdout, "partial\n");
  assert.equal(result.stderr, "bad command\n");
});
