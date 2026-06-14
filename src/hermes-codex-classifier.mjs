import { buildCodexClassifierPrompt, mapClassifierDecisionsToItems, parseCodexClassifierOutput } from "./codex-classifier.mjs";
import { runCodexExec } from "./codex-driver.mjs";
import { runHermesOneshot } from "./hermes-driver.mjs";

export function createHermesCodexClassifier({
  repoPath,
  codexConfig = {},
  hermesConfig = {},
  codexExecFile,
  hermesExecFile
}) {
  if (!repoPath) throw new Error("Hermes/Codex classifier requires repoPath");
  return ({ items, rules, manifest, sync, curate }) => {
    const codexPrompt = buildCodexClassifierPrompt({ items, rules, manifest, sync, curate });
    const codexOutput = runCodexExec({
      repo: repoPath,
      prompt: codexPrompt,
      model: codexConfig.model,
      serviceTier: codexConfig.service_tier,
      sandbox: codexConfig.sandbox,
      ignoreUserConfig: codexConfig.ignore_user_config,
      ephemeral: codexConfig.ephemeral,
      execFile: codexExecFile
    });
    const hermesPrompt = buildHermesCodexReviewPrompt({
      items,
      rules,
      manifest,
      sync,
      curate,
      codexOutput
    });
    const hermesOutput = runHermesOneshot({
      prompt: hermesPrompt,
      command: hermesConfig.command,
      model: hermesConfig.model,
      provider: hermesConfig.provider,
      toolsets: hermesConfig.toolsets,
      skills: hermesConfig.skills,
      ignoreUserConfig: hermesConfig.ignore_user_config,
      ignoreRules: hermesConfig.ignore_rules,
      yolo: hermesConfig.yolo,
      cwd: hermesConfig.cwd,
      execFile: hermesExecFile
    });
    return mapClassifierDecisionsToItems({
      decisions: parseCodexClassifierOutput(hermesOutput),
      items,
      rules,
      label: "Hermes/Codex classifier"
    });
  };
}

export function buildHermesCodexReviewPrompt({ items, rules, manifest, sync, curate, codexOutput }) {
  const payload = {
    task: "Review and finalize Codex classifier output for AO1 Intern filing.",
    contract: {
      output: "Return exactly one JSON object. Do not wrap it in Markdown.",
      shape: {
        items: [{
          source_item_id: "string from input",
          conceptPath: "KB concept markdown path such as product/ideas/example.md",
          summary: "short KB-ready summary, not raw sync data",
          classification: "client-context | product/brand | operational todo | possible sensitive item | noise",
          keptReason: "why Hermes accepts, revises, or removes the Codex decision",
          rulesConsulted: ["KB rule file names used"]
        }]
      },
      noise: "Omit noise items from the items array.",
      safety: "Do not include raw transcripts, message dumps, credentials, private keys, or long raw excerpts."
    },
    kb_rules: rules.files.map((entry) => ({
      name: entry.name,
      excerpt: String(entry.text || entry.content || "").slice(0, 1600)
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
      body_text: String(item.body_text || "").slice(0, 2400),
      curatable: item.curatable === true || item.raw?.curatable === true
    })),
    codex_output: String(codexOutput || "").slice(0, 12000)
  };

  return [
    "You are Hermes orchestrating AO1 Intern filing.",
    "Codex draft classifier output is included in the payload. Treat it as a specialist draft, not as authority.",
    "Check the draft against the KB-local rules and raw item summaries, revise concept paths or summaries if needed, and omit noise.",
    "Return exactly one JSON object with an `items` array and no surrounding commentary.",
    "Do not include raw transcripts, message dumps, credentials, private keys, or long raw excerpts.",
    JSON.stringify(payload, null, 2)
  ].join("\n\n");
}
