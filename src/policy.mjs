import fs from "node:fs";
import path from "node:path";
import { normalizeCodexExecConfig } from "./codex-driver.mjs";
import { writeJson } from "./fs-util.mjs";

export function generateOpenShellPolicy(manifest) {
  const kbWriteRoots = manifest.kb?.kb_write_enabled === true ? (manifest.kb?.write || []) : [];
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
        ...kbWriteRoots,
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
  const kbWriteRoots = manifest.kb?.kb_write_enabled === true ? (manifest.kb?.write || []) : [];
  const writeRoots = uniquePaths([
    ...kbWriteRoots,
    ...(manifest.intern_repo?.write || [])
  ]).map((entryPath) => ({ path: entryPath, mode: "write" }));
  const codexConfig = normalizeCodexExecConfig(config.codex_exec || {});

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
        model: codexConfig.model,
        service_tier: codexConfig.serviceTier,
        sandbox: codexConfig.sandbox,
        ignore_user_config: codexConfig.ignoreUserConfig,
        ephemeral: codexConfig.ephemeral
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

export function generateOpenShellGatewayLaunchAgent({ config = {}, repoPath = process.cwd() } = {}) {
  const gateway = normalizeOpenShellGatewayConfig({ config, repoPath });
  return [
    "<?xml version=\"1.0\" encoding=\"UTF-8\"?>",
    "<!DOCTYPE plist PUBLIC \"-//Apple//DTD PLIST 1.0//EN\" \"http://www.apple.com/DTDs/PropertyList-1.0.dtd\">",
    "<plist version=\"1.0\">",
    "<dict>",
    "  <key>Label</key>",
    `  <string>${xmlEscape(gateway.label)}</string>`,
    "  <key>ProgramArguments</key>",
    "  <array>",
    ...gateway.programArguments.map((argument) => `    <string>${xmlEscape(argument)}</string>`),
    "  </array>",
    "  <key>EnvironmentVariables</key>",
    "  <dict>",
    "    <key>DOCKER_HOST</key>",
    `    <string>${xmlEscape(gateway.dockerHost)}</string>`,
    "  </dict>",
    "  <key>WorkingDirectory</key>",
    `  <string>${xmlEscape(gateway.workingDirectory)}</string>`,
    "  <key>RunAtLoad</key>",
    `  ${renderPlistBoolean(gateway.runAtLoad)}`,
    "  <key>KeepAlive</key>",
    `  ${renderPlistBoolean(gateway.keepAlive)}`,
    "  <key>StandardOutPath</key>",
    `  <string>${xmlEscape(gateway.stdoutPath)}</string>`,
    "  <key>StandardErrorPath</key>",
    `  <string>${xmlEscape(gateway.stderrPath)}</string>`,
    "</dict>",
    "</plist>"
  ].join("\n") + "\n";
}

export function writePolicyArtifacts({ manifest, config = {}, outDir }) {
  fs.mkdirSync(outDir, { recursive: true });
  const policyPath = path.join(outDir, "openshell-policy.json");
  const brokerPolicyPath = path.join(outDir, "host-broker-policy.json");
  const macosSandboxProfilePath = path.join(outDir, "host-broker.sb");
  const openshellGatewayLaunchAgentPath = path.join(outDir, "com.ao1.intern.openshell-gateway.plist");
  const readmePath = path.join(outDir, "README.md");
  const brokerPolicy = generateHostBrokerPolicy({ manifest, config });
  const repoPath = inferRepoPathFromPolicyOutDir({ outDir, config });

  writeJson(policyPath, generateOpenShellPolicy(manifest));
  writeJson(brokerPolicyPath, brokerPolicy);
  fs.writeFileSync(macosSandboxProfilePath, generateMacOSSandboxProfile({ brokerPolicy }));
  fs.writeFileSync(openshellGatewayLaunchAgentPath, generateOpenShellGatewayLaunchAgent({ config, repoPath }));
  fs.writeFileSync(readmePath, renderPolicyReadme({
    brokerPolicy,
    openshellGatewayLaunchAgent: normalizeOpenShellGatewayConfig({ config, repoPath })
  }));

  return { policyPath, brokerPolicyPath, macosSandboxProfilePath, openshellGatewayLaunchAgentPath, readmePath };
}

function uniquePaths(paths) {
  return [...new Set(paths.filter((entryPath) => entryPath && entryPath !== "*"))];
}

function renderPolicyReadme({ brokerPolicy, openshellGatewayLaunchAgent }) {
  const npmCommand = brokerPolicy.os_sandbox?.macos?.npm_command || "npm";
  const launchAgentName = `${openshellGatewayLaunchAgent.label}.plist`;
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
    `- Review \`${launchAgentName}\` before using it as the OpenShell gateway LaunchAgent.`,
    `- Manual LaunchAgent install command after review: \`launchctl bootstrap gui/$(id -u) ${launchAgentName}\`.`,
    `- Manual LaunchAgent unload command: \`launchctl bootout gui/$(id -u) ${launchAgentName}\`.`,
    "- Confirm the LaunchAgent references TLS, Docker socket, and log paths only by local path; do not copy key values into this directory.",
    "- Remember that generated artifacts are not installed automatically and are not applied automatically."
  ].join("\n") + "\n";
}

function normalizeOpenShellGatewayConfig({ config = {}, repoPath = process.cwd() } = {}) {
  const resolvedRepoPath = path.resolve(repoPath);
  const gateway = config.runtime?.openshell_gateway || {};
  const program = gateway.program || config.runtime?.commands?.openshell_gateway || "/Users/magnus/.local/bin/openshell-gateway";
  const programArguments = [program];
  pushFlag(programArguments, "--config", gateway.config_path || "/Users/magnus/.config/openshell/ao1-gateway.toml");
  pushFlag(programArguments, "--tls-cert", gateway.tls_cert || "/Users/magnus/.local/state/openshell/ao1-gateway/tls/server/tls.crt");
  pushFlag(programArguments, "--tls-key", gateway.tls_key || "/Users/magnus/.local/state/openshell/ao1-gateway/tls/server/tls.key");
  pushFlag(programArguments, "--tls-client-ca", gateway.tls_client_ca || "/Users/magnus/.local/state/openshell/ao1-gateway/tls/ca.crt");
  pushFlag(programArguments, "--enable-mtls-auth", String(gateway.enable_mtls_auth !== false));
  pushFlag(programArguments, "--port", String(gateway.port || 17670));

  return {
    label: gateway.launch_agent_label || "com.ao1.intern.openshell-gateway",
    programArguments,
    dockerHost: gateway.docker_host || "unix:///Users/magnus/.docker/run/docker.sock",
    workingDirectory: gateway.working_directory || resolvedRepoPath,
    runAtLoad: gateway.run_at_load !== false,
    keepAlive: gateway.keep_alive !== false,
    stdoutPath: gateway.stdout_path || path.join(resolvedRepoPath, ".ao1-intern", "logs", "openshell-gateway.out.log"),
    stderrPath: gateway.stderr_path || path.join(resolvedRepoPath, ".ao1-intern", "logs", "openshell-gateway.err.log")
  };
}

function inferRepoPathFromPolicyOutDir({ outDir, config = {} }) {
  const resolvedOutDir = path.resolve(outDir);
  if (path.basename(resolvedOutDir) === "policies" && path.basename(path.dirname(resolvedOutDir)) === ".ao1-intern") {
    return path.dirname(path.dirname(resolvedOutDir));
  }
  return config.hermes?.cwd || process.cwd();
}

function pushFlag(argumentsList, flag, value) {
  if (value === undefined || value === null || value === "") return;
  argumentsList.push(flag, String(value));
}

function renderPlistBoolean(value) {
  return value ? "<true/>" : "<false/>";
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
    if (path.isAbsolute(entryPath)) parents.add(path.parse(entryPath).root);
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

function xmlEscape(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll("\"", "&quot;")
    .replaceAll("'", "&apos;");
}
