#!/usr/bin/env python3
"""pre_verify shell hook — deterministic backstop for the onboarding KB bootstrap.

Fired by Hermes when the agent has edited files and is about to verify/finish.
If Intern onboarding never ran (or its KB phase is still not done), emit a
`continue` directive so the agent dispatches the Phase 5 KB bootstrap before
ending the turn. Skill prose asks for the same thing mid-conversation, but by
turn's end it is dozens of tool results back and loses to the harness's own
stop-time nudges — this hook re-states it at the exact decision point.

Wire contract (agent/shell_hooks.py): JSON payload on stdin; a JSON
`{"action": "continue", "message": ...}` on stdout keeps the turn going;
empty stdout is a silent no-op. Bounded upstream by agent.max_verify_nudges.
"""
import json
import os
import sys


def field(payload, key, default=None):
    """Event kwargs may arrive top-level or under 'extra' depending on key."""
    if key in payload:
        return payload[key]
    return (payload.get("extra") or {}).get(key, default)


def main():
    try:
        payload = json.load(sys.stdin)
    except Exception:
        return  # malformed payload: never nudge on guesswork
    if not isinstance(payload, dict):
        return

    # Nudge once per turn, main agent only. Re-nudging every stop attempt
    # would burn all max_verify_nudges even after the model complies, and a
    # Phase 5 child editing KB files must never be nagged about itself.
    if field(payload, "attempt", 0):
        return
    if field(payload, "platform", "") == "subagent":
        return

    kb = os.environ.get("INTERN_KB_PATH") or field(payload, "cwd") or os.getcwd()
    state_path = os.path.join(kb, ".onboarding-state.json")
    try:
        with open(state_path) as f:
            state = json.load(f)
        if state.get("status") == "complete":
            return
        if ((state.get("steps") or {}).get("kb") or {}).get("done"):
            return
        reason = "steps.kb.done is false in .onboarding-state.json"
    except FileNotFoundError:
        reason = ".onboarding-state.json does not exist at the KB path"
    except Exception:
        # Corrupt/unreadable state: stay silent rather than nag on bad data.
        return

    print(json.dumps({
        "action": "continue",
        "message": (
            f"Onboarding backstop: the Intern KB was never bootstrapped this "
            f"session ({reason}; KB path: {kb}). Before you finish: create or "
            f"update the onboarding state file, then dispatch the Phase 5 KB "
            f"bootstrap NOW as a background child — call delegate_task with "
            f"background: true, briefed for completeness per the onboarding "
            f"skill (synthesis from what this session learned, not minimal "
            f"stubs). Only if delegate_task is unavailable or errors, run "
            f"Phase 5 inline or record a todo naming the error. Then give "
            f"your final answer."
        ),
    }))


if __name__ == "__main__":
    main()
