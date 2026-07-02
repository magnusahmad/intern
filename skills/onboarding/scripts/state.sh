#!/usr/bin/env bash
# state.sh — quiet mutations of .onboarding-state.json (golden rule 10).
# Replaces per-run python heredocs: one short line per state change.
#
# Usage:
#   state.sh <state-file> get  <dotted.path>
#   state.sh <state-file> set  <dotted.path> <value> [<dotted.path> <value> ...]
#   state.sh <state-file> todo <text ...>
#
# Values are parsed as JSON when valid (true, 42, {"a":1}, "quoted string") and
# treated as raw strings otherwise. Intermediate objects are created as needed.
# Every mutation bumps updated_at. The file must already exist (Phase 1 creates it).
set -euo pipefail

if [ $# -lt 3 ]; then
  echo "usage: state.sh <state-file> get|set|todo ..." >&2
  exit 2
fi

STATE_FILE=$1 STATE_CMD=$2
shift 2
export STATE_FILE STATE_CMD

python3 - "$@" <<'PY'
import datetime
import json
import os
import sys

path = os.environ["STATE_FILE"]
cmd = os.environ["STATE_CMD"]
args = sys.argv[1:]

try:
    with open(path) as f:
        state = json.load(f)
except FileNotFoundError:
    sys.exit(f"state.sh: {path} not found — Phase 1 creates it first")


def parse(raw):
    try:
        return json.loads(raw)
    except ValueError:
        return raw


def resolve(obj, dotted, create=False):
    keys = dotted.split(".")
    for key in keys[:-1]:
        if create:
            obj = obj.setdefault(key, {})
        else:
            obj = obj[key]
    return obj, keys[-1]


if cmd == "get":
    try:
        parent, leaf = resolve(state, args[0])
        value = parent[leaf]
    except (KeyError, TypeError):
        sys.exit(f"state.sh: no value at {args[0]!r}")
    print(json.dumps(value, indent=2) if isinstance(value, (dict, list)) else value)
    sys.exit(0)

if cmd == "set":
    if not args or len(args) % 2:
        sys.exit("state.sh set: need <dotted.path> <value> pairs")
    for dotted, raw in zip(args[::2], args[1::2]):
        parent, leaf = resolve(state, dotted, create=True)
        parent[leaf] = parse(raw)
    summary = ", ".join(args[::2])
elif cmd == "todo":
    if not args:
        sys.exit("state.sh todo: need text")
    text = " ".join(args)
    todos = state.setdefault("todos", [])
    if text not in todos:
        todos.append(text)
    summary = f"todo ({len(todos)} total)"
else:
    sys.exit(f"state.sh: unknown command {cmd!r}")

state["updated_at"] = (
    datetime.datetime.now(datetime.timezone.utc)
    .isoformat()
    .replace("+00:00", "Z")
)
with open(path, "w") as f:
    json.dump(state, f, indent=2)
    f.write("\n")
print(f"✓ state: {summary}")
PY
