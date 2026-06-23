---
name: google_meet
description: "Join or observe a Google Meet call, transcribe live captions, optionally speak in realtime, and follow up afterwards. If the company setup includes a meet-live-copilot daemon, default to that with the user's normal Chrome/Arc tab."
version: 0.2.0
platforms:
  - linux
  - macos
---

# google_meet

## When to use

The user says any of:
- "join my Meet at <url>"
- "take notes on this meeting"
- "summarize the meeting and send followups"
- "sit in on my standup"
- "be a bot in this call and speak up when X"

## Company default: Meet Live Copilot

If the company setup includes a `meet-live-copilot` daemon, **do not use the separate Hermes-launched Chrome profile path as the default**. That path can destabilize Chrome/Meet on macOS.

When the user says “join a Google Meet”, “start live copilot”, or gives a Meet URL, default to the company copilot daemon:

```bash
${HERMES_HOME:-~/.hermes}/meet-live-copilot/run.sh --port 18791
```

`$HERMES_HOME` should point at the installed company agent home. If not set, resolve the active agent home first and run `meet-live-copilot/run.sh` from there.

Then verify:

```bash
curl -sS http://127.0.0.1:18791/health
```

Expected: `ok: true`, `ready: true`, `kbDocs > 0`. The user should join in their **normal Chrome/Arc Meet tab**, turn on captions, and have the unpacked extension loaded from:

```text
$HERMES_HOME/meet-live-copilot/extension
```

Runtime files:

```text
$HERMES_HOME/workspace/meet-live-copilot/status.json
$HERMES_HOME/workspace/meet-live-copilot/captions.jsonl
$HERMES_HOME/workspace/meet-live-copilot/comments.jsonl
$HERMES_HOME/workspace/meet-live-copilot/events.jsonl
```

Use `tail`/`curl /health` to confirm whether captions are flowing. `captionsSeen` and `lastCaptionAt` indicate caption capture; `commentsSent` indicates Telegram copilot comments.

## Plugin modes (fallback only)

| Mode | What the bot does |
|------|-------------------|
| `transcribe` | Joins through Playwright, enables captions, scrapes transcript. Listen-only. |
| `realtime` | Same as transcribe PLUS speaks into the meeting via OpenAI Realtime. |

Use these plugin modes only if the company copilot daemon is unavailable or the user explicitly asks for the plugin bot to join. Pick `realtime` only when the user actually wants the agent to speak — it costs real money and requires a virtual audio device (BlackHole on macOS, pulseaudio-utils on Linux).

## Setup

### 1. Enable the plugin

```bash
hermes plugins enable google_meet
```

Then restart the gateway:
```bash
hermes gateway restart
```
Or send `/restart` from Telegram — the gateway cannot restart itself from within its own process.

### 2. Install dependencies

```bash
hermes meet install                  # playwright + chromium (transcribe only)
hermes meet install --realtime       # + pulseaudio-utils (Linux) / BlackHole (macOS)
hermes meet auth                     # optional; skips guest-lobby wait
hermes meet setup                    # preflight checks
```

### 3. Auth (plugin fallback only; optional)

For a company live copilot daemon, skip this and use the custom daemon above. Only use plugin auth if explicitly running the Playwright plugin fallback.

```bash
hermes meet auth
```

This authenticates the bot so it bypasses the guest lobby entirely. Without it, the bot clicks "Ask to join" and waits in the lobby — the host must admit it within 5 minutes or the bot times out.

## Joining a meeting

```python
meet_join(url="https://meet.google.com/xxx-xxxx-xxx", mode="transcribe", guest_name="Hermes Agent")
```

Returns immediately. Then poll `meet_status()` and `meet_transcript(last=20)` as needed.

**The host must admit the bot from the lobby.** Without `hermes meet auth`, guest bots always land in the lobby. Watch for `lobbyWaiting: true` in status — alert the user to admit the bot.

## Tool reference

| Tool | Parameters | Use |
|------|------------|-----|
| Company copilot daemon | `run.sh --port 18791` | **Default when the company agent ships `meet-live-copilot/`** |
| `/health` endpoint | `curl http://127.0.0.1:18791/health` | Liveness + progress |
| `meet_join` | `url`, `mode?`, `guest_name?`, `duration?`, `headed?`, `node?` | Plugin fallback bot join |
| `meet_status` | `node?` | Plugin fallback liveness + progress |
| `meet_transcript` | `last?`, `node?` | Plugin fallback transcript |
| `meet_leave` | `node?` | Close plugin fallback bot |
| `meet_say` | `text`, `node?` | Speak in realtime meeting |

## Transcript location

```
~/.hermes/profiles/<profile>/workspace/meetings/<meeting-id>/transcript.txt
```

Or `meet_transcript()` for in-session reading.

## macOS-specific gotcha: permission dialogs blocking headless Chrome

**Problem:** When the plugin bot launches Playwright with `permissions: ["microphone", "camera"]`, macOS shows real OS-level permission dialogs for Camera and Microphone. The headless Chrome browser process hangs waiting for user interaction that never comes. The bot silently fails to join.

**Diagnosis:** `inCall: false`, `lobbyWaiting: false`, `error: null` in status, but the bot never makes it past the lobby. The browser is blocked on an OS permission prompt.

**Fix:** For `transcribe` mode (listen-only, uses Google captions not local audio), request NO browser permissions:

```python
"permissions": [],   # NOT ["microphone", "camera"]
```

`realtime` mode needs a virtual audio device configured separately and can be handled case-by-case.

## Status dict highlights

| Key | Meaning |
|-----|---------|
| `inCall` | Past the lobby. False while waiting for admission. |
| `lobbyWaiting` | Clicked "Ask to join", waiting on host to admit. |
| `captioning` | Caption observer installed and active. |
| `joinedAt` | Timestamp of actual admission (vs `joinAttemptedAt` which is lobby click time). |
| `leaveReason` | `duration_expired`, `lobby_timeout`, `denied`, `page_closed`, or null. |

## Important limits

- Captions are only as good as Google Meet's live captions — English-biased, lossy on overlapping speakers.
- Guest mode: lobby timeout is 5 minutes (configurable via `HERMES_MEET_LOBBY_TIMEOUT` env var).
- One active meeting at a time per install.
- Company copilot default: use the custom Meet Live Copilot daemon + user’s normal browser tab, not separate Chrome-profile extension capture.
- Realtime mode requires BlackHole 2ch + ffmpeg on macOS (or pulseaudio-utils on Linux) + OpenAI Realtime API key.
- `meet_say` requires `mode='realtime'` on the originating `meet_join`.
- Barge-in is best-effort — the bot will talk over ~1s of a human interruption.
- **Windows not supported.**
