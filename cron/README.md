# Cron Jobs
# https://hermes-agent.nousresearch.com/docs/user-guide/features/cron
#
# Add .cron job definition files here. Each file describes one scheduled job.
# After `hermes profile import`, jobs can be installed with:
#   hermes cron list
#   hermes cron create --path cron/my-job.cron
#
# Job format (one per file):
#   schedule: "0 9 * * *"
#   prompt: |
#     Your task description here.
#   delivery: origin

# ─────────────────────────────────────────────────────────────────
# Planned: Capture → KB jobs (to be built)
# ─────────────────────────────────────────────────────────────────
# The intended use of cron here is to keep the company brain current:
# scheduled jobs that pull new messages (chat, email, meeting notes) into
# raw captures, then summarize them into curated KB entries under $INTERN_KB_PATH.
#
# Example sketch (disabled — fill in once the capture/summarize workflow exists):
# capture-to-kb.cron
#   schedule: "0 18 * * *"
#   prompt: |
#     Pull today's new messages into raw captures, summarize the durable facts
#     and decisions, and file them as concise KB entries under $INTERN_KB_PATH.
#     Skip anything already recorded.
#   delivery: origin
