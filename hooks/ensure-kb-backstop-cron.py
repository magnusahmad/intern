#!/usr/bin/env python3
"""on_session_start shell hook — auto-register the kb-backstop cron job.

Hermes profile import copies cron/*.cron definition files but never registers
them as jobs (registration is a manual `hermes cron create`, which no real
user runs). This hook closes that gap: on session start, if the profile's
cron/jobs.json doesn't already contain the job, parse kb-backstop.cron and
register it via the hermes CLI. Idempotent; silent on every path (hook stdout
is ignored for this event, failures just retry next session).

Note the runtime split: registration (this hook) works from any session, but
the cron *ticker* only runs inside a gateway process for this profile — CLI
sessions never tick. The pre_verify backstop covers task runs; this cron is
the safety net for the gateway/Telegram end state.
"""
import json
import os
import re
import shutil
import subprocess
import sys

JOB_NAME = "kb-backstop"


def resolve_hermes_home():
    env = os.environ.get("HERMES_HOME")
    if env:
        return os.path.expanduser(env)
    root = os.path.expanduser("~/.hermes")
    try:
        with open(os.path.join(root, "active_profile")) as f:
            profile = f.read().strip()
    except OSError:
        profile = ""
    if profile and profile != "default":
        return os.path.join(root, "profiles", profile)
    return root


def parse_cron_file(path):
    """Parse the minimal .cron format: schedule, delivery, and a prompt block."""
    text = open(path, encoding="utf-8").read()
    m = re.search(r'^schedule:\s*"?([^"\n]+)"?\s*$', text, re.M)
    schedule = m.group(1).strip() if m else None
    m = re.search(r"^delivery:\s*(\S+)\s*$", text, re.M)
    delivery = m.group(1).strip() if m else "origin"
    m = re.search(r"^prompt:\s*\|\s*\n((?:[ \t]+\S.*\n|\s*\n)+)", text, re.M)
    prompt = None
    if m:
        block = m.group(1)
        indents = [len(l) - len(l.lstrip()) for l in block.splitlines() if l.strip()]
        cut = min(indents) if indents else 0
        prompt = "\n".join(l[cut:] if len(l) >= cut else "" for l in block.splitlines()).strip()
    return schedule, prompt, delivery


def already_registered(hermes_home):
    jobs_file = os.path.join(hermes_home, "cron", "jobs.json")
    try:
        with open(jobs_file, encoding="utf-8") as f:
            jobs = json.load(f)
    except (OSError, ValueError):
        return False
    entries = jobs.get("jobs", jobs) if isinstance(jobs, dict) else jobs
    if isinstance(entries, dict):
        entries = list(entries.values())
    if not isinstance(entries, list):
        return False
    return any(
        isinstance(j, dict) and j.get("name") == JOB_NAME for j in entries
    )


def hermes_argv():
    exe = shutil.which("hermes")
    if exe:
        return [exe]
    venv_py = os.path.expanduser("~/.hermes/hermes-agent/venv/bin/python")
    if os.path.exists(venv_py):
        return [venv_py, "-m", "hermes_cli.main"]
    return None


def main():
    hermes_home = resolve_hermes_home()
    cron_def = os.path.join(hermes_home, "cron", f"{JOB_NAME}.cron")
    if not os.path.isfile(cron_def):
        return
    if already_registered(hermes_home):
        return
    schedule, prompt, delivery = parse_cron_file(cron_def)
    if not schedule or not prompt:
        print(f"ensure-kb-backstop-cron: could not parse {cron_def}", file=sys.stderr)
        return
    argv = hermes_argv()
    if not argv:
        print("ensure-kb-backstop-cron: no hermes CLI found", file=sys.stderr)
        return
    env = dict(os.environ, HERMES_HOME=hermes_home)
    cmd = argv + ["cron", "create", schedule, prompt,
                  "--name", JOB_NAME, "--deliver", delivery]
    r = subprocess.run(cmd, env=env, capture_output=True, text=True, timeout=60)
    if r.returncode != 0:
        print(f"ensure-kb-backstop-cron: create failed: {r.stderr.strip()[:300]}",
              file=sys.stderr)


if __name__ == "__main__":
    main()
