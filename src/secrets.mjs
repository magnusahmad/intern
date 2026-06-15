import fs from "node:fs";
import { execFileSync } from "node:child_process";

const SECRET_PATTERNS = [
  /\bsk-[A-Za-z0-9_-]{16,}\b/,
  /\brk_(live|test)_[A-Za-z0-9_-]{12,}\b/,
  /\bghp_[A-Za-z0-9_]{20,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /"refresh_token"\s*:\s*"[^"]{12,}"/
];

export function findSecrets(text) {
  return SECRET_PATTERNS.filter((pattern) => pattern.test(text)).map((pattern) => pattern.source);
}

export function assertNoSecretsInText(text, label = "text") {
  const matches = findSecrets(text);
  if (matches.length) {
    throw new Error(`Secret-like value found in ${label}`);
  }
}

export function assertNoSecretsInFiles(files) {
  for (const file of files) {
    assertNoSecretsInText(fs.readFileSync(file, "utf8"), file);
  }
}

export class FakeSecretProvider {
  constructor(values = {}) {
    this.values = values;
  }

  resolve(ref) {
    if (!ref.startsWith("keychain://")) {
      throw new Error(`Unsupported secret ref: ${ref}`);
    }
    if (!(ref in this.values)) {
      throw new Error(`Missing secret ref: ${ref}`);
    }
    return this.values[ref];
  }
}

export class KeychainSecretProvider {
  resolve(ref) {
    const service = keychainServiceForRef(ref);
    return execFileSync("/usr/bin/security", ["find-generic-password", "-s", service, "-w"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"]
    }).trimEnd();
  }
}

export function keychainServiceForRef(ref) {
  if (!ref.startsWith("keychain://")) {
    throw new Error(`Unsupported secret ref: ${ref}`);
  }
  const parsed = new URL(ref);
  const service = [parsed.hostname, parsed.pathname.replace(/^\//, "")]
    .filter(Boolean)
    .join("/");
  if (!service) throw new Error(`Invalid keychain ref: ${ref}`);
  return service;
}
