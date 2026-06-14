import { safeSlug } from "./fs-util.mjs";

export function heuristicClassifyItems({ items, rules }) {
  const results = [];
  for (const { file, item } of items) {
    const text = item.body_text || "";
    if (!isCuratable(item, text)) continue;
    results.push({
      file,
      item,
      conceptPath: chooseConceptPath(item, text),
      summary: summarize(text),
      classification: classifyKind(text),
      keptReason: "Matched KB concept rules and was marked curatable.",
      rulesConsulted: rules.files.map((entry) => entry.name)
    });
  }
  return results;
}

export function validateClassifiedItems(items) {
  for (const [index, item] of items.entries()) {
    if (!item.conceptPath || typeof item.conceptPath !== "string") {
      throw new Error(`Classifier item ${index} missing conceptPath`);
    }
    if (!item.summary || typeof item.summary !== "string") {
      throw new Error(`Classifier item ${index} missing summary`);
    }
    if (!item.classification || typeof item.classification !== "string") {
      throw new Error(`Classifier item ${index} missing classification`);
    }
    if (!item.item || typeof item.item !== "object") {
      throw new Error(`Classifier item ${index} missing raw item reference`);
    }
    if (!Array.isArray(item.rulesConsulted)) {
      throw new Error(`Classifier item ${index} missing rulesConsulted`);
    }
  }
  return items;
}

function isCuratable(item, text) {
  if (item.curatable === true || item.raw?.curatable === true) return true;
  if (/ao1-intern:curatable/i.test(text)) return true;
  if (/Owner:\s*AO1/i.test(text) && /Sources:/i.test(text)) return true;
  return false;
}

function chooseConceptPath(item, text) {
  const lower = `${item.title || ""}\n${text}`.toLowerCase();
  if (/openshell|nemoclaw|hermes|codex|intern|agent governance/.test(lower)) {
    return "product/ideas/intern-agent-governance.md";
  }
  if (/meeting|follow-up|decision|availability/.test(lower)) {
    return "meetings/intern-sync-notes.md";
  }
  if (/brand|voice|logo|company bio/.test(lower)) {
    return "brand/company-bio.md";
  }
  if (/doctrine|research|market|architecture/.test(lower)) {
    return "research/ai-operating-doctrine.md";
  }
  return `shared/imports/${safeSlug(item.title || item.source_item_id || "curated-item")}.md`;
}

function classifyKind(text) {
  const lower = text.toLowerCase();
  if (/sensitive|private|secret|credential/.test(lower)) return "possible sensitive item";
  if (/todo|follow-up|next action|action item/.test(lower)) return "operational todo";
  if (/brand|product|offer|positioning/.test(lower)) return "product/brand";
  return "client-context";
}

function summarize(text) {
  const compact = text
    .replace(/ao1-intern:curatable/gi, " ")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/^#+\s*/gm, "")
    .replace(/\s+/g, " ")
    .trim();
  return compact.split(/(?<=[.!?])\s+/).slice(0, 2).join(" ").slice(0, 600);
}
