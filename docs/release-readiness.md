# Release readiness

## Environment isolation

`wrangler.jsonc` is production-only. Its `MONOPOLY_BANK_DB` ID is never rewritten by CI. The staging workflow builds the application, resolves the D1 ID for the GitHub `staging` environment at runtime, and writes an untracked `dist/monopoly_bank/wrangler.staging.json`. That configuration has a distinct Worker name, a distinct D1 database and therefore an isolated Durable Object namespace.

Before the first staging run, create the following GitHub `staging` environment configuration:

| Kind | Name | Purpose |
| --- | --- | --- |
| secret | `CLOUDFLARE_API_TOKEN` | Least-privilege token for the staging Worker and staging D1 only. |
| secret | `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account identifier. |
| variable | `CLOUDFLARE_STAGING_D1_DATABASE_NAME` | Isolated staging D1 database name. |
| variable | `CLOUDFLARE_STAGING_WORKER_NAME` | Optional non-production Worker name; defaults to `monopoly-bank-staging`. |

Set `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, and `APP_ORIGIN` as staging Worker secrets before a release. `APP_ORIGIN` must equal the HTTPS staging custom domain. The workflow verifies only secret names; it never prints values.

## Database delivery contract

Every database change follows this sequence:

1. **Expand**: add nullable columns, additive tables or indexes only.
2. **Backward-compatible code**: deploy code that works against both pre- and post-expand schemas.
3. **Backfill**: run a resumable, idempotent, observable job in staging first; record counts and reconciliation queries in the release evidence.
4. **Contract**: only after all supported Worker versions and backfills are confirmed, remove obsolete reads/writes in a later release.

Never combine expand and contract in one migration. D1 migrations are append-only and are applied in filename order; the repository verifies both a blank database and a fixture first migrated through `0015`, then upgraded through the current migration set.

## Staging release and evidence

Run **Staging release** manually with its isolated HTTPS URL and a non-sensitive existing staging game ID. It records in the GitHub job log:

- lint, unit tests, clean-DB migrations, and upgraded-fixture migrations;
- resolved staging D1 ID plus generated Worker/D1/DO binding validation;
- required Worker secret names;
- a pre-deploy D1 export restored into a disposable local D1, with foreign-key and schema checks plus a fixture lookup;
- migration application, Worker deployment, and HTTPS smoke checks for the app shell, unauthenticated API boundary, and security headers.

The export is kept only in the runner workspace for the restore rehearsal and is deleted before the job finishes. Do not upload it as a CI artifact or log its contents.

## Production procedure and rollback

Production release remains a manually dispatched workflow restricted to `main`, with the explicit `confirm_production_release` input and GitHub `production` environment approval. It does not create or substitute production D1 IDs and must not be triggered without separate authorization.

Before production approval: review staging evidence, confirm native D1 backup/time-travel retention, run the same backup/restore rehearsal against a sanitized or access-restricted export, confirm pending migrations are expand-safe, and save the current Worker version ID from `wrangler versions list`.

If post-deploy smoke fails, first stop further releases, then run `wrangler rollback` (or select the recorded version) for the Worker only. Do **not** attempt to reverse an already-applied D1 migration. Stabilize with forward-compatible code, preserve the incident evidence, and use D1 point-in-time recovery only under an approved data-recovery runbook. Re-run smoke tests after rollback.

## Current readiness assessment

The repository has automated local clean/upgrade migration coverage, isolated staging delivery, binding checks, restore rehearsal tooling, and post-deploy smoke checks. It is **not production-ready until** a real staging environment has supplied the required secrets, completed one successful workflow run, and its evidence (including email delivery and an authenticated end-to-end payment flow) has been reviewed. No production deployment was performed by this change.
