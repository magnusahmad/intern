# Repo scan subagent — spawn prompt (extraction)

Spawn this as a **background** child at Phase 3, only if the user provided a company repo path.
It is **read-only** and must **not modify the company repo**. It gathers raw signals about the
technical reality and writes them to files. It does not classify the business.

- **Toolsets:** `file`, `terminal` (read-only use).
- **Inputs:** the company `company_repo_path`.
- **Output files** (under `$INTERN_KB_PATH/raw/onboarding/`):
  - `repo-scan.md` — human-readable findings.
  - `repo-signals.json` — structured signals.
  - touch `repo-scan.done` **last**, only after both files are written.

## Spawn prompt (paste into the child task)

> You are a read-only repository-extraction subagent for business onboarding. The company repo
> is at `<company_repo_path>`. **Do not modify it** — read and grep only. Extract the technical
> reality:
>
> - **Stack / framework:** read `README`, `package.json`/lockfiles, framework markers
>   (Next.js, Astro, etc.), language/runtime.
> - **Hosting / deploy:** look for `wrangler.toml`/`wrangler.jsonc` (Cloudflare Pages/Workers),
>   build + deploy scripts. Record the deploy target name if present.
> - **Expected env vars:** read `.env.example`/config for expected variable names — these
>   reveal other services in use.
> - **App shape (business-model signal):** presence of auth, dashboard routes, API routes →
>   SaaS/app; static storefront + cart → ecommerce; marketing-only site → services/other.
> - **Stripe wiring:** grep for `plink_`, `price_`, `prod_`, `pk_live`/`pk_test`, `cs_`, and
>   checkout/payment-link URLs. Record where each is found.
> - **Where catalog/pricing is defined** in code or content (e.g. `content/products.ts`), so
>   future edits know where to go.
>
> Write `$INTERN_KB_PATH/raw/onboarding/repo-scan.md` (readable) and `repo-signals.json`
> (structured), then `touch $INTERN_KB_PATH/raw/onboarding/repo-scan.done`. Do not write anything
> inside the company repo. Partial results are fine — note anything you couldn't determine.

## `repo-signals.json` shape

```json
{
  "schema_version": 1,
  "scanned_at": "2026-06-29T10:05:00Z",
  "repo_path": "/Users/owner/Projects/acme-site",
  "stack": ["next.js"],
  "hosting": "cloudflare_pages",
  "deploy_target": { "type": "wrangler.toml", "name": "acme-site" },
  "expected_env_vars": ["STRIPE_SECRET_KEY", "..."],
  "app_shape": { "has_auth": true, "has_dashboard": true, "has_api_routes": true, "has_cart": false },
  "stripe_refs": [ { "kind": "price_id", "value": "price_...", "file": "content/products.ts", "line": 12 } ],
  "catalog_defined_in": "content/products.ts",
  "notes": []
}
```

## Safety

- Read-only. Never `git add`/`commit`/`push` or edit files in the company repo.
- Do not copy live Stripe IDs or other secrets anywhere outside `raw/onboarding/` (KB).
