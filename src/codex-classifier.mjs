import { runCodexExec } from "./codex-driver.mjs";

const ALLOWED_CLASSIFICATIONS = new Set([
  "client-context",
  "product/brand",
  "operational todo",
  "possible sensitive item",
  "noise"
]);

export function createCodexClassifier({
  repoPath,
  codexConfig = {},
  execFile
}) {
  return ({ items, rules, manifest, sync, curate }) => {
    const prompt = buildCodexClassifierPrompt({ items, rules, manifest, sync, curate });
    const output = runCodexExec({
      repo: repoPath,
      prompt,
      model: codexConfig.model,
      serviceTier: codexConfig.service_tier,
      sandbox: codexConfig.sandbox,
      ignoreUserConfig: codexConfig.ignore_user_config,
      ephemeral: codexConfig.ephemeral,
      execFile
    });
    return mapCodexDecisionsToItems({
      decisions: parseCodexClassifierOutput(output),
      items,
      rules
    });
  };
}

export function buildCodexClassifierPrompt({ items, rules, manifest, sync, curate }) {
  const payload = {
    task: "Classify AO1 raw connector manifest items into KB-ready filing decisions.",
    contract: {
      output: "Return exactly one JSON object. Do not wrap it in Markdown.",
      shape: {
        items: [{
          source_item_id: "string from input",
          conceptPath: "KB concept markdown path such as product/ideas/example.md",
          summary: "short KB-ready summary, not raw sync data",
          classification: "client-context | product/brand | operational todo | possible sensitive item | noise",
          keptReason: "why this item should be filed",
          rulesConsulted: ["KB rule file names used"]
        }]
      },
      noise: "Omit noise items from the items array.",
      safety: "Do not include raw transcripts, message dumps, credentials, private keys, or long raw excerpts."
    },
    kb_rules: rules.files.map((entry) => ({
      name: entry.name,
      excerpt: String(entry.text || entry.content || "").slice(0, 2000)
    })),
    sync: {
      run_id: sync?.run_id || manifest?.run_id || null,
      connector_id: manifest?.connector_id || sync?.connector_id || null,
      curate_reason: curate?.reason || null
    },
    items: items.map(({ item }) => ({
      source_item_id: item.source_item_id,
      source: item.source,
      source_url: item.source_url,
      content_type: item.content_type,
      title: item.title,
      body_text: String(item.body_text || "").slice(0, 5000),
      curatable: item.curatable === true || item.raw?.curatable === true
    }))
  };

  return [
    "You are the AO1 Intern filing classifier.",
    "Follow the KB-local rules in the payload and choose existing or new concept paths that fit those rules.",
    "Return exactly one JSON object with an `items` array and no surrounding commentary.",
    JSON.stringify(payload, null, 2)
  ].join("\n\n");
}

export function parseCodexClassifierOutput(text) {
  const jsonText = extractJsonObject(text);
  const parsed = JSON.parse(jsonText);
  if (!Array.isArray(parsed.items)) {
    throw new Error("Codex classifier output must contain an items array");
  }
  return parsed.items;
}

function mapCodexDecisionsToItems({ decisions, items, rules }) {
  const bySourceItemId = new Map(items.map((entry) => [entry.item.source_item_id, entry]));
  const fallbackRules = rules.files.map((entry) => entry.name);
  const classified = [];

  for (const decision of decisions) {
    if (decision.classification === "noise") continue;
    const sourceItemId = decision.source_item_id || decision.sourceItemId;
    const entry = bySourceItemId.get(sourceItemId);
    if (!entry) {
      throw new Error(`Codex classifier returned unknown source_item_id: ${sourceItemId || "(missing)"}`);
    }
    if (!ALLOWED_CLASSIFICATIONS.has(decision.classification)) {
      throw new Error(`Codex classifier returned unsupported classification: ${decision.classification}`);
    }
    classified.push({
      file: entry.file,
      item: entry.item,
      conceptPath: decision.conceptPath,
      summary: decision.summary,
      classification: decision.classification,
      keptReason: decision.keptReason,
      rulesConsulted: Array.isArray(decision.rulesConsulted) ? decision.rulesConsulted : fallbackRules
    });
  }

  return classified;
}

function extractJsonObject(text) {
  const trimmed = String(text || "").trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) return fenced[1].trim();

  const start = trimmed.indexOf("{");
  if (start === -1) {
    throw new Error("Codex classifier output did not contain a JSON object");
  }

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < trimmed.length; index += 1) {
    const char = trimmed[index];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }
    if (char === '"') {
      inString = true;
    } else if (char === "{") {
      depth += 1;
    } else if (char === "}") {
      depth -= 1;
      if (depth === 0) return trimmed.slice(start, index + 1);
    }
  }

  throw new Error("Codex classifier output did not contain a complete JSON object");
}
