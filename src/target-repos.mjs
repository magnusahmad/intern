import path from "node:path";

const PROJECTS_ROOT = "/Users/magnus/Documents/Projects";
const AO1_KB_ROOT = path.join(PROJECTS_ROOT, "ao1-kb");

export const DEFAULT_TARGET_REPOS = Object.freeze([
  target({
    id: "ao1-intern",
    name: "AO1 Intern",
    cwd: path.join(PROJECTS_ROOT, "ao1-intern"),
    aliases: ["ao1 intern", "ao1-intern", "intern", "intern agent"],
    preferredBackend: "codex",
    kbContextPointers: [
      AO1_KB_ROOT,
      path.join(AO1_KB_ROOT, "product", "ideas", "mobile-to-cli-operations-intern.md")
    ]
  }),
  target({
    id: "ao1-kb",
    name: "AO1 KB",
    cwd: AO1_KB_ROOT,
    aliases: ["ao1 kb", "ao1-kb", "kb", "knowledge base", "ao1 knowledge base"],
    preferredBackend: "codex",
    kbContextPointers: [AO1_KB_ROOT]
  }),
  target({
    id: "ao1",
    name: "AO1 App",
    cwd: path.join(PROJECTS_ROOT, "ao1"),
    aliases: ["ao1", "ao1 app", "ao1 repo", "ao1 website"],
    preferredBackend: "codex",
    kbContextPointers: [AO1_KB_ROOT]
  }),
  target({
    id: "memento-ai",
    name: "Memento AI",
    cwd: path.join(PROJECTS_ROOT, "memento-ai"),
    aliases: ["memento", "memento-ai", "memento ai", "memento app", "readwise"],
    preferredBackend: "codex",
    kbContextPointers: [AO1_KB_ROOT]
  }),
  target({
    id: "blueballs",
    name: "Blueballs",
    cwd: path.join(PROJECTS_ROOT, "blueballs"),
    aliases: ["blueballs", "stripe storefront", "payment links", "stripe pricing", "stripe"],
    preferredBackend: "codex",
    kbContextPointers: [AO1_KB_ROOT]
  })
]);

export function normalizeTargetRepos({
  configuredTargets = [],
  includeDefaults = true
} = {}) {
  const byId = new Map();
  if (includeDefaults) {
    for (const entry of DEFAULT_TARGET_REPOS) byId.set(entry.id, entry);
  }
  for (const entry of configuredTargets || []) {
    const normalized = target({
      id: entry.id,
      name: entry.name,
      cwd: entry.cwd || entry.path,
      aliases: entry.aliases,
      preferredBackend: entry.preferredBackend ?? entry.preferred_backend,
      kbContextPointers: entry.kbContextPointers ?? entry.kb_context,
      agentsPath: entry.agentsPath ?? entry.agents_path
    });
    byId.set(normalized.id, normalized);
  }
  return [...byId.values()];
}

export function resolveTargetRepo({
  text = "",
  explicitTarget = "",
  targets,
  config = {}
} = {}) {
  const candidateTargets = targets || normalizeTargetRepos({
    configuredTargets: config.hermes_gateway?.target_repos || config.target_repos || []
  });

  if (explicitTarget) {
    const exactMatches = candidateTargets
      .map((candidate) => exactTargetMatch(candidate, explicitTarget))
      .filter(Boolean);
    if (exactMatches.length === 1) {
      return resolved(exactMatches[0], `Explicit target matched ${exactMatches[0].matchedAlias}.`);
    }
    if (exactMatches.length > 1) {
      return ambiguous(exactMatches, `Explicit target ${explicitTarget} matched multiple repositories.`);
    }
    return unknown(`No target repository matched ${explicitTarget}.`);
  }

  const matches = candidateTargets
    .map((candidate) => textTargetMatch(candidate, text))
    .filter(Boolean);
  if (!matches.length) return unknown("No target repository matched the message.");

  const maxScore = Math.max(...matches.map((match) => match.matchScore));
  const strongest = matches.filter((match) => match.matchScore === maxScore);
  if (strongest.length === 1) {
    return resolved(strongest[0], `Message matched ${strongest[0].matchedAlias}.`);
  }
  return ambiguous(strongest, "Message matched multiple target repositories.");
}

function target({
  id,
  name,
  cwd,
  aliases = [],
  preferredBackend = "codex",
  kbContextPointers = [AO1_KB_ROOT],
  agentsPath
}) {
  if (!id) throw new Error("Target repo id is required.");
  if (!cwd) throw new Error(`Target repo cwd is required for ${id}.`);
  const normalizedCwd = path.resolve(cwd);
  const normalizedAliases = unique([
    id,
    name,
    path.basename(normalizedCwd),
    ...aliases
  ].filter(Boolean).map((alias) => String(alias).trim()));

  return {
    id: String(id),
    name: String(name || id),
    cwd: normalizedCwd,
    aliases: normalizedAliases,
    preferredBackend: normalizeBackend(preferredBackend),
    kbContextPointers: unique(kbContextPointers || []),
    agentsPath: agentsPath || path.join(normalizedCwd, "AGENTS.md")
  };
}

function exactTargetMatch(candidate, value) {
  const normalized = normalizePhrase(value);
  const matchedAlias = candidate.aliases.find((alias) => normalizePhrase(alias) === normalized);
  return matchedAlias ? withMatch(candidate, matchedAlias, wordCount(matchedAlias)) : null;
}

function textTargetMatch(candidate, text) {
  const textWords = words(text);
  if (!textWords.length) return null;
  const matches = candidate.aliases
    .map((alias) => ({ alias, aliasWords: words(alias) }))
    .filter(({ aliasWords }) => aliasWords.length && containsSequence(textWords, aliasWords))
    .sort((left, right) => right.aliasWords.length - left.aliasWords.length || right.alias.length - left.alias.length);
  if (!matches.length) return null;
  return withMatch(candidate, matches[0].alias, matches[0].aliasWords.length);
}

function withMatch(candidate, matchedAlias, matchScore) {
  return {
    ...candidate,
    matchedAlias,
    matchScore
  };
}

function resolved(targetRepo, reason) {
  return {
    status: "resolved",
    target: publicTarget(targetRepo),
    reason
  };
}

function ambiguous(candidates, reason) {
  return {
    status: "ambiguous",
    candidates: candidates.map(publicTarget),
    reason
  };
}

function unknown(reason) {
  return {
    status: "unknown",
    candidates: [],
    reason
  };
}

function publicTarget(candidate) {
  return {
    id: candidate.id,
    name: candidate.name,
    cwd: candidate.cwd,
    aliases: candidate.aliases,
    preferredBackend: candidate.preferredBackend,
    kbContextPointers: candidate.kbContextPointers,
    agentsPath: candidate.agentsPath,
    ...(candidate.matchedAlias ? { matchedAlias: candidate.matchedAlias } : {})
  };
}

function normalizeBackend(value) {
  const normalized = String(value || "codex").toLowerCase().trim();
  if (!["codex", "claude"].includes(normalized)) {
    throw new Error(`Unsupported preferred backend: ${value}`);
  }
  return normalized;
}

function normalizePhrase(value) {
  return words(value).join(" ");
}

function words(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

function wordCount(value) {
  return words(value).length;
}

function containsSequence(haystack, needle) {
  if (needle.length > haystack.length) return false;
  for (let index = 0; index <= haystack.length - needle.length; index += 1) {
    if (needle.every((word, offset) => haystack[index + offset] === word)) return true;
  }
  return false;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}
