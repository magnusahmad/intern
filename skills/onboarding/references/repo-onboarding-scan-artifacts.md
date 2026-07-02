# Repo onboarding scan artifacts

Use this when onboarding needs a repository-only scan or when a background repo scan must hand off durable findings.

## Required outputs

Write all outputs under `$INTERN_KB_PATH/raw/onboarding/`:

- `repo-scan.md` — human-readable scan summary.
- `repo-signals.json` — structured extraction for later synthesis.
- `repo-scan.done` — empty touch marker created only after the markdown and JSON are written.

## `repo-signals.json` minimum shape

Include the durable signals future phases need without scraping the markdown:

- `schema_version`.
- `repo`: path, git status, branch, remotes when available.
- `stack`: runtime, frameworks, app shape, scripts.
- `hosting_deploy`: deploy target, config files, routes/domains, storage bindings.
- `app_shape`: entrypoints and API routes.
- `env_vars`: expected variables grouped by app/sub-app; never include secret values.
- `integrations`: detected providers with confidence and evidence.
- Payment-specific detail when present: checkout URLs/IDs, webhook endpoints, env vars.
- Catalog/pricing sources and explicit conflicts between website, repo defaults, specs, and payment-provider truth.
- `source_files_inspected` and `issues_or_open_questions`.

## Verification

If no canonical test/lint/build command applies, run an ad-hoc verifier rather than calling the scan done by inspection alone:

1. Create a temporary script using Python `tempfile.NamedTemporaryFile`, under the OS temp directory, with prefix `hermes-verify-`.
2. Verify the three artifact paths exist.
3. Parse `repo-signals.json` and assert critical fields for this repo class are present.
4. Assert key markdown evidence appears in `repo-scan.md`.
5. Remove the temp verifier in a `finally` block when possible.
6. Report this explicitly as **ad-hoc verification**, not a green canonical suite.
7. **Run it once.** One passing verifier per change is the stopping condition — do not rewrite
   a near-identical verifier and run it again (SKILL.md golden rule 9), and report the result
   in a couple of lines, not a full panel per run.

Keep the verifier focused on artifact validity and extracted behavior. Do not encode one business's exact values as global requirements except inside session-specific expectations for that run.
