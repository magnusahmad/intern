#!/usr/bin/env python3
"""Build an Obsidian-style interactive graph of the AO1 KB.

Walks a knowledge-base directory for Markdown pages, extracts the [[wikilinks]]
between them, and writes a self-contained ``kb-graph.html`` that renders a
force-directed graph (vis-network via CDN). Open it in any browser — no Obsidian
install required. The same KB folder also opens directly as an Obsidian vault if
the owner happens to have Obsidian.

Deterministic and re-runnable: regenerate the graph any time the KB changes.

Usage:
    python3 build_kb_graph.py [KB_PATH] [-o OUTPUT_HTML]

KB_PATH defaults to $AO1_KB_PATH, then the current directory.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path

WIKILINK = re.compile(r"\[\[([^\]|#]+)(?:[#|][^\]]*)?\]\]")
H1 = re.compile(r"^#\s+(.+)$", re.MULTILINE)

# Nous Research / Geist accent palette on near-black, keyed by top-level folder.
GROUP_COLORS = {
    "company": "#0070f3",   # blue — the core
    "products": "#50e3c2",  # cyan
    "operations": "#f5a623",  # amber
    "decisions": "#7928ca",   # purple
    "people": "#ff0080",      # pink
    "customers": "#ff0080",
    "raw": "#444444",         # dim — raw material recedes
    "_root": "#ededed",       # near-white hub
    "_other": "#ededed",
}


def discover_pages(kb: Path) -> dict[str, dict]:
    """Map relative path -> page metadata for every Markdown file in the KB."""
    pages: dict[str, dict] = {}
    for path in sorted(kb.rglob("*.md")):
        rel = path.relative_to(kb)
        text = path.read_text(encoding="utf-8", errors="ignore")
        title_match = H1.search(text)
        parts = rel.parts
        pages[str(rel)] = {
            "rel": str(rel),
            "stem": path.stem,
            "title": title_match.group(1).strip() if title_match else path.stem,
            "group": parts[0] if len(parts) > 1 else "_root",
            "text": text,
        }
    return pages


def build_edges(pages: dict[str, dict]) -> list[tuple[str, str]]:
    """Resolve [[wikilinks]] into undirected edges between pages."""
    by_stem: dict[str, list[str]] = {}
    for rel, page in pages.items():
        by_stem.setdefault(page["stem"].lower(), []).append(rel)

    edges: set[tuple[str, str]] = set()
    for rel, page in pages.items():
        for match in WIKILINK.finditer(page["text"]):
            target_stem = Path(match.group(1).strip()).stem.lower()
            for candidate in by_stem.get(target_stem, []):
                if candidate != rel:
                    edges.add(tuple(sorted((rel, candidate))))
    return sorted(edges)


def company_name(kb: Path) -> str:
    """Best-effort brand name for the graph title."""
    profile = kb / "company" / "company-profile.json"
    if profile.exists():
        try:
            data = json.loads(profile.read_text(encoding="utf-8"))
            name = (data.get("brand") or {}).get("name")
            if name:
                return str(name)
        except (ValueError, OSError):
            pass
    return ""


def to_graph(pages: dict[str, dict], edges: list[tuple[str, str]]) -> tuple[list, list]:
    degree: dict[str, int] = {rel: 0 for rel in pages}
    for a, b in edges:
        degree[a] = degree.get(a, 0) + 1
        degree[b] = degree.get(b, 0) + 1

    nodes = []
    for rel, page in pages.items():
        group = page["group"] if page["group"] in GROUP_COLORS else "_other"
        nodes.append({
            "id": rel,
            "label": page["title"],
            "group": group,
            "color": GROUP_COLORS[group],
            "value": 1 + degree.get(rel, 0),  # hub pages render larger
            "title": rel,                      # tooltip = path
        })
    links = [{"from": a, "to": b} for a, b in edges]
    return nodes, links


HTML_TEMPLATE = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>__TITLE__</title>
<script src="https://unpkg.com/vis-network@9.1.9/standalone/umd/vis-network.min.js"></script>
<style>
  :root {
    --bg: #0a0a0a; --fg: #ededed; --muted: #666; --line: #1f1f1f;
    --accent: #0070f3;
    --mono: ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, monospace;
  }
  html, body { margin: 0; height: 100%; background: var(--bg); color: var(--fg);
    font-family: var(--mono); }
  #graph { width: 100%; height: 100vh; }
  /* hairline frame, Nous-style */
  #frame { position: fixed; inset: 14px; border: 1px solid var(--line);
    pointer-events: none; z-index: 4; }
  #header { position: fixed; top: 30px; left: 32px; z-index: 5; }
  #header h1 { margin: 0; font-size: 13px; font-weight: 500; letter-spacing: 0.08em;
    text-transform: uppercase; }
  #header p { margin: 6px 0 0; font-size: 11px; color: var(--muted);
    letter-spacing: 0.12em; text-transform: uppercase; }
  #legend { position: fixed; bottom: 30px; left: 32px; z-index: 5; font-size: 10px;
    letter-spacing: 0.1em; text-transform: uppercase; color: var(--muted);
    background: rgba(10,10,10,0.75); border: 1px solid var(--line); padding: 10px 14px; }
  #legend span { display: inline-flex; align-items: center; margin-right: 16px; }
  #legend i { width: 7px; height: 7px; border-radius: 50%; display: inline-block;
    margin-right: 7px; }
  #hint { position: fixed; bottom: 30px; right: 32px; z-index: 5; font-size: 10px;
    letter-spacing: 0.12em; text-transform: uppercase; color: var(--muted); }
</style>
</head>
<body>
<div id="frame"></div>
<div id="header"><h1>__TITLE__</h1><p>__SUBTITLE__</p></div>
<div id="legend">__LEGEND__</div>
<div id="hint">drag · scroll to zoom · hover</div>
<div id="graph"></div>
<script>
  const nodes = new vis.DataSet(__NODES__);
  const edges = new vis.DataSet(__EDGES__);
  const container = document.getElementById("graph");
  const network = new vis.Network(container, { nodes, edges }, {
    nodes: { shape: "dot", scaling: { min: 7, max: 30 },
      font: { color: "#ededed", size: 13, face: "ui-monospace, SF Mono, Menlo, monospace",
        strokeWidth: 0, vadjust: -2 },
      borderWidth: 0,
      shadow: { enabled: true, color: "rgba(0,0,0,0.6)", size: 14, x: 0, y: 0 } },
    edges: { color: { color: "#262626", highlight: "#0070f3", hover: "#0070f3" },
      width: 1, hoverWidth: 1, selectionWidth: 1,
      smooth: { type: "continuous", roundness: 0.4 } },
    physics: { solver: "forceAtlas2Based",
      forceAtlas2Based: { gravitationalConstant: -48, springLength: 120,
        springConstant: 0.08, avoidOverlap: 0.4 },
      stabilization: { iterations: 220 } },
    interaction: { hover: true, tooltipDelay: 120, navigationButtons: false,
      hoverConnectedEdges: true }
  });
</script>
</body>
</html>
"""


def render_html(nodes: list, links: list, brand: str) -> str:
    title = f"{brand} — Knowledge Base" if brand else "Knowledge Base"
    subtitle = f"{len(nodes)} pages · {len(links)} links · the company brain"
    used_groups = sorted({n["group"] for n in nodes})
    legend = "".join(
        f'<span><i style="background:{GROUP_COLORS[g]}"></i>'
        f'{"root" if g.startswith("_") else g}</span>'
        for g in used_groups
    )
    return (
        HTML_TEMPLATE
        .replace("__TITLE__", title)
        .replace("__SUBTITLE__", subtitle)
        .replace("__LEGEND__", legend)
        .replace("__NODES__", json.dumps(nodes))
        .replace("__EDGES__", json.dumps(links))
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Build an Obsidian-style KB graph.")
    parser.add_argument("kb_path", nargs="?",
                        default=os.environ.get("AO1_KB_PATH", "."),
                        help="KB directory (default: $AO1_KB_PATH or .)")
    parser.add_argument("-o", "--output", default=None,
                        help="Output HTML path (default: <KB>/kb-graph.html)")
    args = parser.parse_args(argv)

    kb = Path(os.path.expanduser(args.kb_path)).resolve()
    if not kb.is_dir():
        print(f"KB path not found: {kb}", file=sys.stderr)
        return 1

    pages = discover_pages(kb)
    if not pages:
        print(f"No Markdown pages found under {kb}", file=sys.stderr)
        return 1

    edges = build_edges(pages)
    nodes, links = to_graph(pages, edges)
    out = Path(args.output) if args.output else kb / "kb-graph.html"
    out.write_text(render_html(nodes, links, company_name(kb)), encoding="utf-8")
    print(f"Wrote {out}  ({len(nodes)} pages, {len(links)} links)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
