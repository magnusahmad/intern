import path from "node:path";
import { assertNoSecretsInText } from "./secrets.mjs";
import { ensureInside, safeSlug, writeJson } from "./fs-util.mjs";

const DISALLOWED_RAW_LOG_KEYS = new Set([
  "prompt",
  "rawPrompt",
  "raw_prompt",
  "fullPrompt",
  "full_prompt",
  "terminalLog",
  "terminal_log",
  "rawTerminalLog",
  "raw_terminal_log",
  "rawLogs",
  "raw_logs",
  "stdout",
  "stderr",
  "transcript"
]);

export function buildDelegationAuditRecord(input = {}) {
  const disallowed = findDisallowedKeys(input);
  if (disallowed.length) {
    throw new Error(`Delegation audit artifacts must not store raw terminal logs or prompts: ${disallowed.join(", ")}`);
  }
  const target = input.target || {};
  const startedAt = input.startedAt || new Date().toISOString();
  const record = {
    version: "ao1-intern.delegation-audit.v1",
    origin: input.origin || {},
    targetId: target.id || input.targetId || "unknown",
    cwd: target.cwd || input.cwd,
    backend: input.backend,
    commandTemplateName: input.commandTemplateName,
    external: input.external || {},
    startedAt,
    completedAt: input.completedAt || null,
    status: input.status || (input.completedAt ? "completed" : "started"),
    finalOperatorSummary: input.finalOperatorSummary || ""
  };

  validateRecord(record);
  assertNoSecretsInText(JSON.stringify(record), "delegation audit record");
  return record;
}

export function writeDelegationAuditArtifact({
  repoPath = process.cwd(),
  outDir = path.join(repoPath, ".ao1-intern", "delegations"),
  record
} = {}) {
  const normalizedRecord = record?.version === "ao1-intern.delegation-audit.v1"
    ? record
    : buildDelegationAuditRecord(record);
  const disallowed = findDisallowedKeys(normalizedRecord);
  if (disallowed.length) {
    throw new Error(`Delegation audit artifacts must not store raw terminal logs or prompts: ${disallowed.join(", ")}`);
  }
  validateRecord(normalizedRecord);
  assertNoSecretsInText(JSON.stringify(normalizedRecord), "delegation audit record");

  const fileName = [
    safeSlug(normalizedRecord.startedAt),
    safeSlug(normalizedRecord.targetId),
    safeSlug(normalizedRecord.backend)
  ].filter(Boolean).join("-") + ".json";
  const artifactPath = path.join(outDir, fileName);
  if (!ensureInside(outDir, artifactPath)) {
    throw new Error("Delegation audit path escaped the configured audit directory.");
  }
  writeJson(artifactPath, normalizedRecord);
  return {
    path: artifactPath,
    record: normalizedRecord
  };
}

function validateRecord(record) {
  if (!record.cwd) throw new Error("Delegation audit record requires cwd.");
  if (!record.backend) throw new Error("Delegation audit record requires backend.");
  if (!record.commandTemplateName) throw new Error("Delegation audit record requires command template name.");
  if (!record.startedAt) throw new Error("Delegation audit record requires startedAt.");
}

function findDisallowedKeys(value, prefix = "") {
  if (!value || typeof value !== "object") return [];
  const matches = [];
  for (const [key, nested] of Object.entries(value)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (DISALLOWED_RAW_LOG_KEYS.has(key)) matches.push(fullKey);
    if (nested && typeof nested === "object") matches.push(...findDisallowedKeys(nested, fullKey));
  }
  return matches;
}
