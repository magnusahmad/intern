import path from "node:path";

function matchesDeclaredPath(candidate, declared) {
  if (declared === "*") return false;
  const relative = path.relative(path.resolve(declared), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export function validatePermission(manifest, request) {
  if (request.type === "file-read") {
    const roots = [
      ...(manifest.kb?.read || []),
      ...(manifest.ao1_repos?.read || []),
      ...(manifest.intern_repo?.read || [])
    ];
    return roots.some((root) => matchesDeclaredPath(request.path, root));
  }

  if (request.type === "file-write") {
    if (request.kbWrite && !manifest.kb?.kb_write_enabled) return false;
    const roots = [
      ...(manifest.kb?.write || []),
      ...(manifest.intern_repo?.write || [])
    ];
    return roots.some((root) => matchesDeclaredPath(request.path, root));
  }

  if (request.type === "network") {
    return (manifest.network?.allow || []).includes(request.target);
  }

  if (request.type === "tool") {
    return (manifest.tools?.allow || []).includes(request.tool) && !(manifest.tools?.deny || []).includes(request.tool);
  }

  return false;
}

export function assertPermission(manifest, request) {
  if (!validatePermission(manifest, request)) {
    throw new Error(`Permission denied for ${request.type}`);
  }
}
