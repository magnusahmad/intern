import fs from "node:fs";
import path from "node:path";
import { writeJson } from "./fs-util.mjs";

export function generateOpenShellPolicy(manifest) {
  return {
    version: "ao1-intern.openshell-policy.v1",
    identity: {
      agent_id: manifest.agent_id,
      users: manifest.users || []
    },
    filesystem: {
      read: uniquePaths([
        ...(manifest.kb?.read || []),
        ...(manifest.ao1_repos?.read || []),
        ...(manifest.intern_repo?.read || [])
      ]).map((entryPath) => ({ path: entryPath, mode: "read" })),
      write: uniquePaths([
        ...(manifest.kb?.write || []),
        ...(manifest.intern_repo?.write || [])
      ]).map((entryPath) => ({ path: entryPath, mode: "write" })),
      kb_write_enabled: manifest.kb?.kb_write_enabled === true
    },
    network: {
      allow: (manifest.network?.allow || []).map((target) => ({ target }))
    },
    tools: {
      allow: manifest.tools?.allow || [],
      deny: manifest.tools?.deny || []
    },
    application: {
      mode: "review-only",
      note: "Generated policy artifacts are not applied automatically."
    }
  };
}

export function generateHostBrokerPolicy({ manifest, config = {} }) {
  const writeRoots = uniquePaths([
    ...(manifest.kb?.write || []),
    ...(manifest.intern_repo?.write || [])
  ]).map((entryPath) => ({ path: entryPath, mode: "write" }));

  return {
    version: "ao1-intern.host-broker-policy.v1",
    execution_boundary: config.runtime?.execution_boundary || "host-broker",
    identity: {
      agent_id: manifest.agent_id,
      users: manifest.users || []
    },
    tools: {
      hermes: {
        allow: (manifest.tools?.allow || []).includes("hermes"),
        command: config.hermes?.command || "/Users/magnus/.local/bin/hermes",
        mode: "oneshot-json-finalizer",
        cwd: config.hermes?.cwd || null
      },
      codex: {
        allow: (manifest.tools?.allow || []).includes("codex-exec"),
        command: config.runtime?.commands?.codex || "codex",
        mode: "draft-classifier",
        model: config.codex_exec?.model || null,
        service_tier: config.codex_exec?.service_tier || null,
        sandbox: config.codex_exec?.sandbox || null,
        ignore_user_config: config.codex_exec?.ignore_user_config === true,
        ephemeral: config.codex_exec?.ephemeral === true
      },
      deny: manifest.tools?.deny || []
    },
    filesystem: {
      read: uniquePaths([
        ...(manifest.kb?.read || []),
        ...(manifest.ao1_repos?.read || []),
        ...(manifest.intern_repo?.read || [])
      ]).map((entryPath) => ({ path: entryPath, mode: "read" })),
      write: writeRoots,
      kb_write_enabled: manifest.kb?.kb_write_enabled === true
    },
    network: {
      allow: (manifest.network?.allow || []).map((target) => ({ target }))
    },
    secrets: {
      allowed_refs: collectCredentialRefs(config),
      policy: "Resolve refs at runtime only; do not copy secret values into config, logs, checkpoints, policies, prompts, or run files."
    },
    application: {
      mode: "review-only",
      note: "Host-side broker policy is enforced by the checked-in filing runtime, but it is not an OS sandbox."
    }
  };
}

export function writePolicyArtifacts({ manifest, config = {}, outDir }) {
  fs.mkdirSync(outDir, { recursive: true });
  const policyPath = path.join(outDir, "openshell-policy.json");
  const brokerPolicyPath = path.join(outDir, "host-broker-policy.json");
  const readmePath = path.join(outDir, "README.md");

  writeJson(policyPath, generateOpenShellPolicy(manifest));
  writeJson(brokerPolicyPath, generateHostBrokerPolicy({ manifest, config }));
  fs.writeFileSync(readmePath, renderPolicyReadme());

  return { policyPath, brokerPolicyPath, readmePath };
}

function uniquePaths(paths) {
  return [...new Set(paths.filter((entryPath) => entryPath && entryPath !== "*"))];
}

function renderPolicyReadme() {
  return [
    "# AO1 Intern Runtime Policy",
    "",
    "Review this generated policy before using it with OpenShell or NemoClaw.",
    "",
    "This artifact is not applied automatically. It is a review checkpoint for the runtime permissions declared in `config/permissions.example.json`.",
    "",
    "Before applying a generated policy:",
    "",
    "- Confirm read roots are limited to AO1 repositories needed by the intern.",
    "- Confirm write roots are limited to the intern repo unless `kb_write_enabled` has been deliberately enabled.",
    "- Confirm secret values are referenced through Keychain or another local provider and are not copied into this directory.",
    "- Confirm denied tools still block unrestricted shell access and KB writes without the explicit switch.",
    "- Confirm `host-broker-policy.json` only allows the reviewed Hermes one-shot and Codex exec paths while those tools run on the host.",
    "- Remember that the broker is enforced by the checked-in filing runtime; it is not an OS sandbox."
  ].join("\n") + "\n";
}

function collectCredentialRefs(value, refs = new Set()) {
  if (!value || typeof value !== "object") return [...refs];
  if (typeof value.credential_ref === "string") refs.add(value.credential_ref);
  for (const nested of Object.values(value)) collectCredentialRefs(nested, refs);
  return [...refs].sort();
}
