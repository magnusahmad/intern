import fs from "node:fs";
import path from "node:path";

const RULE_FILES = ["AGENTS.md", "README.md", "index.md"];

export function loadKbRules(kbPath) {
  const files = [];
  for (const name of RULE_FILES) {
    const file = path.join(kbPath, name);
    if (fs.existsSync(file)) {
      files.push({ path: file, name, text: fs.readFileSync(file, "utf8") });
    }
  }

  return {
    files,
    summary: [
      "Keep curated knowledge in concept folders.",
      "Do not paste raw connector dumps into markdown.",
      "Include Owner, Last reviewed, Sources, and Related metadata.",
      "Use concept folders for AO1 and avoid department folders unless explicitly asked.",
      "Keep prose economical and source-grounded."
    ]
  };
}
