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

export function writePolicyArtifacts({ manifest, outDir }) {
  fs.mkdirSync(outDir, { recursive: true });
  const policyPath = path.join(outDir, "openshell-policy.json");
  const readmePath = path.join(outDir, "README.md");

  writeJson(policyPath, generateOpenShellPolicy(manifest));
  fs.writeFileSync(readmePath, renderPolicyReadme());

  return { policyPath, readmePath };
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
    "- Confirm denied tools still block unrestricted shell access and KB writes without the explicit switch."
  ].join("\n") + "\n";
}
