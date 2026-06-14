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
    os_sandbox: {
      macos: {
        profile: "host-broker.sb",
        mode: "manual-review",
        npm_command: config.runtime?.macos_sandbox?.npm_command || "npm",
        file_read_roots: uniquePaths([
          ...(config.runtime?.macos_sandbox?.tool_read_roots || []),
          ...(config.runtime?.macos_sandbox?.auth_read_roots || []),
          ...(config.runtime?.macos_sandbox?.auth_write_roots || []),
          ...(config.runtime?.macos_sandbox?.system_read_roots || []),
          ...(config.runtime?.macos_sandbox?.temp_write_roots || []),
          ...(config.runtime?.macos_sandbox?.unix_socket_roots || [])
        ]),
        file_write_roots: uniquePaths([
          ...(config.runtime?.macos_sandbox?.auth_write_roots || []),
          ...(config.runtime?.macos_sandbox?.temp_write_roots || [])
        ]),
        unix_socket_roots: uniquePaths(config.runtime?.macos_sandbox?.unix_socket_roots || [])
      }
    },
    application: {
      mode: "review-only",
      note: "Host-side broker policy is enforced by the checked-in filing runtime, but it is not an OS sandbox."
    }
  };
}

export function generateMacOSSandboxProfile({ brokerPolicy }) {
  const readRoots = [
    ...pathsFromPolicyEntries(brokerPolicy.filesystem?.read || []),
    ...absoluteToolPaths(brokerPolicy),
    ...(brokerPolicy.os_sandbox?.macos?.file_read_roots || [])
  ];
  const executableRoots = [
    ...absoluteToolPaths(brokerPolicy),
    ...(brokerPolicy.os_sandbox?.macos?.file_read_roots || [])
  ];
  const writeRoots = [
    ...pathsFromPolicyEntries(brokerPolicy.filesystem?.write || []),
    ...(brokerPolicy.os_sandbox?.macos?.file_write_roots || [])
  ];
  const unixSocketRoots = brokerPolicy.os_sandbox?.macos?.unix_socket_roots || [];
  const lines = [
    "(version 1)",
    "(deny default)",
    "(import \"system.sb\")",
    "",
    ";; Review-only OS-level guard for the host-broker runtime.",
    ";; Generated from host-broker-policy.json; apply manually with sandbox-exec only after review.",
    "(allow process*)",
    "(allow sysctl-read)",
    "(allow file-read*",
    ...renderSandboxReadFilters(readRoots),
    ")",
    "(allow file-map-executable",
    ...renderSandboxPathFilters(executableRoots),
    ")",
    "(allow file-write*",
    ...renderSandboxPathFilters(writeRoots),
    ")",
    ...renderInternetOutboundRule(brokerPolicy.network?.allow || []),
    ...renderUnixSocketRules(unixSocketRoots)
  ];
  return lines.join("\n") + "\n";
}

export function writePolicyArtifacts({ manifest, config = {}, outDir }) {
  fs.mkdirSync(outDir, { recursive: true });
  const policyPath = path.join(outDir, "openshell-policy.json");
  const brokerPolicyPath = path.join(outDir, "host-broker-policy.json");
  const macosSandboxProfilePath = path.join(outDir, "host-broker.sb");
  const readmePath = path.join(outDir, "README.md");
  const brokerPolicy = generateHostBrokerPolicy({ manifest, config });

  writeJson(policyPath, generateOpenShellPolicy(manifest));
  writeJson(brokerPolicyPath, brokerPolicy);
  fs.writeFileSync(macosSandboxProfilePath, generateMacOSSandboxProfile({ brokerPolicy }));
  fs.writeFileSync(readmePath, renderPolicyReadme({ brokerPolicy }));

  return { policyPath, brokerPolicyPath, macosSandboxProfilePath, readmePath };
}

function uniquePaths(paths) {
  return [...new Set(paths.filter((entryPath) => entryPath && entryPath !== "*"))];
}

function renderPolicyReadme({ brokerPolicy }) {
  const npmCommand = brokerPolicy.os_sandbox?.macos?.npm_command || "npm";
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
    "- Review `host-broker.sb` as a manual OS-level enforcement profile before any `sandbox-exec` use.",
    `- Example review command: \`sandbox-exec -f host-broker.sb ${npmCommand} run intern -- scheduled-runtime-smoke --config config/ao1-intern.example.json\`.`,
    "- Remember that generated artifacts are not installed or applied automatically."
  ].join("\n") + "\n";
}

function collectCredentialRefs(value, refs = new Set()) {
  if (!value || typeof value !== "object") return [...refs];
  if (typeof value.credential_ref === "string") refs.add(value.credential_ref);
  for (const nested of Object.values(value)) collectCredentialRefs(nested, refs);
  return [...refs].sort();
}

function pathsFromPolicyEntries(entries) {
  return entries
    .map((entry) => entry.path)
    .filter((entryPath) => entryPath && entryPath !== "*")
    .map((entryPath) => path.resolve(entryPath));
}

function absoluteToolPaths(brokerPolicy) {
  return [
    brokerPolicy.tools?.hermes?.command,
    brokerPolicy.tools?.codex?.command
  ].filter((command) => command && path.isAbsolute(command));
}

function renderSandboxPathFilters(paths) {
  return uniquePaths(paths).map((entryPath) => `  (subpath ${sandboxString(entryPath)})`);
}

function renderUnixSocketRules(paths) {
  if (!paths.length) return [];
  const roots = uniquePaths(paths).map((entryPath) => path.resolve(entryPath));
  return [
    "(allow network-bind",
    ...roots.map((entryPath) => `  (local unix-socket (subpath ${sandboxString(entryPath)}))`),
    ")",
    "(allow network-outbound",
    ...roots.map((entryPath) => `  (remote unix-socket (subpath ${sandboxString(entryPath)}))`),
    ")"
  ];
}

function renderInternetOutboundRule(networkEntries) {
  if (!networkEntries.length) return [];
  return [
    "",
    ";; macOS sandbox-exec cannot express the abstract manifest targets below as domain ACLs.",
    `;; Declared network targets: ${networkEntries.map((entry) => entry.target).join(", ")}`,
    "(allow network-outbound)"
  ];
}

function renderSandboxReadFilters(paths) {
  const resolvedPaths = uniquePaths(paths.map((entryPath) => path.resolve(entryPath)));
  return [
    ...parentDirectoryLiterals(resolvedPaths).map((entryPath) => `  (literal ${sandboxString(entryPath)})`),
    ...renderSandboxPathFilters(resolvedPaths)
  ];
}

function parentDirectoryLiterals(paths) {
  const parents = new Set();
  for (const entryPath of paths) {
    let current = path.dirname(entryPath);
    while (current && current !== path.dirname(current)) {
      parents.add(current);
      current = path.dirname(current);
    }
  }
  return [...parents].sort((left, right) => left.length - right.length || left.localeCompare(right));
}

function sandboxString(value) {
  return JSON.stringify(String(value));
}
