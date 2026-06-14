# AO1 Intern

AO1 dogfood repo for the internal Intern agent. V1 observes AO1 KB syncs, reads latest raw connector manifests, filters important information, and writes KB-ready markdown into this repo for review and later KB write-back.

## Commands

```bash
npm test
npm run intern -- file-latest-sync --kb /Users/magnus/Documents/Projects/ao1-kb
npm run intern -- schedule-artifacts --kb /Users/magnus/Documents/Projects/ao1-kb
```

The schedule command only writes reviewable cron/LaunchAgent artifacts and install instructions. It does not install anything.
