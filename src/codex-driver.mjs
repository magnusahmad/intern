import { assertNoSecretsInText } from "./secrets.mjs";

export function buildCodexExecInvocation({ repo, prompt, model = null }) {
  const args = ["exec", "--cd", repo];
  if (model) args.push("--model", model);
  args.push(prompt);
  return { command: "codex", args };
}

export function validateCodexOutput(text) {
  assertNoSecretsInText(text, "codex output");
  if (!text.trim()) throw new Error("Codex output is empty");
  return text;
}
