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
# Capture → KB
# ─────────────────────────────────────────────────────────────────
# Keeping the company brain current is a two-layer system:
#   1. Real-time (primary): the `kb` skill, self-invoked per task per SOUL.md's
#      capture mandate — durable facts are filed the moment they're learned.
#   2. Backstop (this dir): `kb-backstop.cron` — a daily catch-up sweep that files
#      anything real-time capture missed, so nothing durable is lost.
#
# Install the backstop with:
#   hermes cron create --path cron/kb-backstop.cron
#
# Future capture jobs (chat/email/meeting-note ingestion into raw/ then curation)
# can follow the same pattern as new sources come online.
