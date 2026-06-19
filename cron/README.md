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
#   skills:
#     - ao1-kb-filing
#   delivery: origin

# ─────────────────────────────────────────────────────────────────
# Example: Daily KB sync check (disabled — uncomment and configure)
# ─────────────────────────────────────────────────────────────────
# kb-sync-check.cron
#   schedule: "0 10 * * *"
#   prompt: |
#     Run the KB sync check. Read the latest sync run from the KB at
#     $AO1_KB_PATH and report whether there are new items ready to file.
#     If items exist, list the run ID and item count.
#   delivery: origin