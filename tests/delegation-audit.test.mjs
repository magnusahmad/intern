import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import {
  buildDelegationAuditRecord,
  writeDelegationAuditArtifact
} from "../src/delegation-audit.mjs";
import { makeTempRepo } from "./helpers.mjs";

test("test_delegation_audit_writes_minimal_secret_free_artifact", () => {
  const { intern } = makeTempRepo();
  const record = buildDelegationAuditRecord({
    origin: { channel: "telegram", messageId: "42", operator: "Magnus" },
    target: { id: "memento-ai", cwd: "/Users/magnus/Documents/Projects/memento-ai" },
    backend: "codex",
    commandTemplateName: "codex-background-pty",
    external: { hermesSessionId: "session-1", processId: "process-1" },
    startedAt: "2026-06-16T10:00:00.000Z",
    completedAt: "2026-06-16T10:03:00.000Z",
    status: "completed",
    finalOperatorSummary: "Updated onboarding copy and ran npm test."
  });

  const result = writeDelegationAuditArtifact({ repoPath: intern, record });
  const parsed = JSON.parse(fs.readFileSync(result.path, "utf8"));

  assert.equal(result.path.startsWith(path.join(intern, ".ao1-intern", "delegations")), true);
  assert.equal(parsed.version, "ao1-intern.delegation-audit.v1");
  assert.equal(parsed.backend, "codex");
  assert.equal(parsed.cwd, "/Users/magnus/Documents/Projects/memento-ai");
  assert.equal(parsed.commandTemplateName, "codex-background-pty");
  assert.equal(parsed.external.hermesSessionId, "session-1");
  assert.equal(parsed.finalOperatorSummary, "Updated onboarding copy and ran npm test.");
  assert.equal("rawTerminalLog" in parsed, false);
  assert.equal("stdout" in parsed, false);
  assert.equal("stderr" in parsed, false);
});

test("test_delegation_audit_rejects_secrets_and_raw_terminal_logs", () => {
  assert.throws(() => buildDelegationAuditRecord({
    origin: { channel: "telegram" },
    target: { id: "ao1-intern", cwd: "/Users/magnus/Documents/Projects/ao1-intern" },
    backend: "codex",
    commandTemplateName: "codex-oneshot",
    finalOperatorSummary: "Token sk-test-secret-value-1234567890"
  }), /secret/i);

  assert.throws(() => buildDelegationAuditRecord({
    origin: { channel: "telegram" },
    target: { id: "ao1-intern", cwd: "/Users/magnus/Documents/Projects/ao1-intern" },
    backend: "codex",
    commandTemplateName: "codex-oneshot",
    rawTerminalLog: "full transcript"
  }), /raw terminal logs/i);
});
