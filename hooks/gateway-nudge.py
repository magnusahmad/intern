#!/usr/bin/env python3
"""pre_llm_call shell hook — surface a dead gateway to the user, via the agent.

Scheduled jobs (kb-backstop cron) and Telegram only work while a gateway
process runs for this profile, but a real user never starts one by hand.
This hook checks, on the first turn of a session, whether registered cron
jobs exist while no gateway is running — and if so injects context telling
the agent to ask the user for permission to start it. The hook never starts
anything itself; the user decides, the agent acts.

Guardrails: first turn only, main agent only, at most one nudge per snooze
window, permanent opt-out file, silent on any error. Output contract
(agent/shell_hooks.py): {"context": "..."} on stdout is injected into the
user message; empty stdout is a no-op.
"""
import json
import os
import subprocess
import sys
import time

SNOOZE_SECONDS = 24 * 3600
OPTOUT_NAME = ".gateway-nudge-optout"
SNOOZE_NAME = ".gateway-nudge-last"


def resolve_profile_and_home():
    root = os.path.expanduser("~/.hermes")
    env = os.environ.get("HERMES_HOME")
    if env:
        home = os.path.expanduser(env)
        name = os.path.basename(home) if os.path.basename(os.path.dirname(home)) == "profiles" else "default"
        return name, home
    try:
        with open(os.path.join(root, "active_profile")) as f:
            profile = f.read().strip()
    except OSError:
        profile = ""
    if profile and profile != "default":
        return profile, os.path.join(root, "profiles", profile)
    return "default", root


def has_registered_jobs(home):
    try:
        with open(os.path.join(home, "cron", "jobs.json"), encoding="utf-8") as f:
            jobs = json.load(f)
    except (OSError, ValueError):
        return False
    entries = jobs.get("jobs", jobs) if isinstance(jobs, dict) else jobs
    if isinstance(entries, dict):
        entries = list(entries.values())
    return bool(isinstance(entries, list) and any(isinstance(j, dict) for j in entries))


def gateway_running(profile, ps_output=None):
    if ps_output is None:
        try:
            ps_output = subprocess.run(
                ["ps", "-axo", "command"],
                capture_output=True, text=True, timeout=10,
            ).stdout
        except Exception:
            return True  # can't tell: assume fine, never nudge on guesswork
    for line in ps_output.splitlines():
        if "gateway run" not in line or "hermes" not in line.lower():
            continue
        if profile == "default":
            if "--profile" not in line:
                return True
        elif f"--profile {profile} " in line + " ":
            return True
    return False


def main():
    try:
        payload = json.load(sys.stdin)
    except Exception:
        return
    if not isinstance(payload, dict):
        return
    extra = payload.get("extra") or {}

    def field(key, default=None):
        return payload.get(key, extra.get(key, default))

    if not field("is_first_turn"):
        return
    if field("platform", "") == "subagent":
        return

    profile, home = resolve_profile_and_home()
    if os.path.exists(os.path.join(home, OPTOUT_NAME)):
        return
    snooze = os.path.join(home, SNOOZE_NAME)
    try:
        if time.time() - os.path.getmtime(snooze) < SNOOZE_SECONDS:
            return
    except OSError:
        pass

    if not has_registered_jobs(home):
        return
    if gateway_running(profile):
        return

    # Mark before emitting so a crash after this line still can't nag twice.
    try:
        with open(snooze, "w") as f:
            f.write(str(int(time.time())))
    except OSError:
        pass

    profile_flag = "" if profile == "default" else f" --profile {profile}"
    print(json.dumps({"context": (
        "[gateway check] This profile has scheduled jobs registered (e.g. the "
        "daily KB backstop sweep) but no Hermes gateway process is running, so "
        "they will never fire and Telegram is offline. At a natural moment this "
        "session — after finishing any task the user asked for, not before — "
        "tell the user this in one or two sentences and ask permission to start "
        f"the gateway. If they agree, run `hermes{profile_flag} gateway install` "
        f"then `hermes{profile_flag} gateway start` (background service, "
        "survives reboots), and confirm with `hermes gateway status`. If they "
        "decline, drop it. If they say to stop asking, run: touch "
        f"{os.path.join(home, OPTOUT_NAME)}"
    )}))


if __name__ == "__main__":
    main()
