import fs from "node:fs";
import path from "node:path";
import { ensureInside } from "./fs-util.mjs";

const RULE_FILES = ["AGENTS.md", "README.md", "index.md"];
const ALWAYS_RULE_FILES = ["shared/source-map/index.md"];

export function loadKbRules(kbPath) {
  const files = [];
  const seen = new Set();
  for (const name of [
    ...RULE_FILES,
    ...linkedRuleFilesFromRootIndex(kbPath),
    ...ALWAYS_RULE_FILES
  ]) {
    addRuleFile({ kbPath, name, files, seen });
  }

  return {
    files,
    summary: [
      "Keep curated knowledge in concept folders.",
      "Do not paste raw connector dumps into markdown.",
      "Include Owner, Last reviewed, Sources, and Related metadata.",
      "Use concept folders for AO1 and avoid department folders unless explicitly asked.",
      "Consult linked concept indexes and shared/source-map/index.md before choosing target concepts.",
      "Keep prose economical and source-grounded."
    ]
  };
}

function addRuleFile({ kbPath, name, files, seen }) {
  if (!isLocalMarkdownRulePath(name) || seen.has(name)) return;
  const file = path.resolve(kbPath, name);
  if (!ensureInside(kbPath, file) || !fs.existsSync(file)) return;
  seen.add(name);
  files.push({ path: file, name, text: fs.readFileSync(file, "utf8") });
}

function linkedRuleFilesFromRootIndex(kbPath) {
  const rootIndex = path.join(kbPath, "index.md");
  if (!fs.existsSync(rootIndex)) return [];
  return extractMarkdownLinks(fs.readFileSync(rootIndex, "utf8"));
}

function extractMarkdownLinks(markdown) {
  const links = [];
  const pattern = /!?\[[^\]]*]\(([^)]+)\)/g;
  for (const match of markdown.matchAll(pattern)) {
    if (match[0].startsWith("!")) continue;
    const link = normalizeMarkdownLink(match[1]);
    if (link) links.push(link);
  }
  return links;
}

function normalizeMarkdownLink(rawLink) {
  const link = rawLink.split("#")[0].trim();
  if (!link || /^[a-z][a-z0-9+.-]*:/i.test(link) || path.isAbsolute(link)) return null;
  return path.normalize(link);
}

function isLocalMarkdownRulePath(name) {
  if (!name.endsWith(".md") || name.startsWith(".ao1/")) return false;
  return !name.split(path.sep).includes("..");
}
