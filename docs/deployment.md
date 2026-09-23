# Deployment

Monopoly Bank deploys as one Cloudflare Worker with static assets, a D1 database and the `GAME_SESSIONS` Durable Object. There are three isolated environments: development (deployed automatically from `dev`), staging (manual rehearsal) and production (manual, approved release). This page collects the procedures; the [operations runbooks](operations-runbooks.md) cover what to do once a release is live.

## Environment isolation

`wrangler.jsonc` is production-only. Its `MONOPOLY_BANK_DB` ID is never rewritten by CI. The development and staging workflows build the application, resolve their D1 ID from the database name at runtime, and write an untracked configuration next to the build output: `dist/monopoly_bank/wrangler.dev.json` for development (see [`scripts/prepare-dev-deploy.mjs`](scripts.md)) and `dist/monopoly_bank/wrangler.staging.json` for staging (`scripts/prepare-staging-deploy.mjs`). Each generated configuration has a distinct Worker name, a distinct D1 database and therefore an isolated Durable Object namespace. `scripts/validate-deployment-bindings.mjs` asserts the generated Worker name, D1 ID/name and Durable Object binding before any migration or deploy step runs.

## Database setup

`wrangler.jsonc` contains the production `MONOPOLY_BANK_DB` binding; the separate `monopoly-bank-dev` development database is resolved by name in CI. A D1 database is created only once. If Wrangler reports that a database name already exists, that is expected: verify and reuse it instead of creating another database.

```bash
# Verify an existing database in the authenticated Cloudflare account.
npx wrangler d1 info monopoly-bank-dev

# Create a database only when `d1 info` reports that it does not exist.
npx wrangler d1 create monopoly-bank-dev --location eeur
```

If a new **production** D1 database is intentionally created, update the production binding's `database_id` in `wrangler.jsonc` before applying remote migrations or deploying. Never point the production Worker at `monopoly-bank-dev`.

## Cloudflare credentials

Create a Cloudflare API token scoped to the account that owns the Worker. It needs `Workers Scripts: Edit` and `D1: Edit` account permissions. Copy the account ID from the Cloudflare dashboard.

In GitHub, open **Settings → Environments** and create both `development` and `production`. Add these environment secrets to each environment:

- `CLOUDFLARE_API_TOKEN` — the Cloudflare API token;
- `CLOUDFLARE_ACCOUNT_ID` — the Cloudflare account ID.

Environment secrets are separate: adding credentials to `production` does not make them available to `development`. Do not store these values in source code or as plain GitHub variables. Do not commit account credentials or Cloudflare API tokens.

## Automatic development deployment

Pushes to `dev` deploy automatically to the separate `monopoly-bank-dev` Worker and D1 database through the `deploy-dev` job of the `CI` workflow. First verify that the database exists; reuse it if it does:

```bash
npx wrangler d1 info monopoly-bank-dev
```

Only if that command says the database does not exist, create it once:

```bash
npx wrangler d1 create monopoly-bank-dev --location eeur
```

The GitHub `development` environment needs:

- secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`;
- optionally, the `CLOUDFLARE_DEV_D1_DATABASE_NAME` variable when the database is not named `monopoly-bank-dev`.

The workflow resolves the development D1 database UUID from its name, so no database ID needs to be stored in GitHub. The database must identify the development database, not `monopoly-bank`. Pending migrations are applied to that development database before each deployment.

After committing the workflow to `dev`, push or merge a change into `dev`. The `CI` workflow validates the revision, resolves the existing development D1 database, applies migrations, and deploys `monopoly-bank-dev`. Do not apply the same migrations manually immediately before this workflow; it applies pending migration files safely.

Use the GitHub Actions path for development deployments: it builds the separate development Worker configuration, applies pending migrations to `monopoly-bank-dev`, and avoids accidentally deploying development changes to production. The development configuration drops the Analytics Engine binding so the Worker can deploy in accounts where that service is not enabled.

## Staging release

Before the first staging run, create the following GitHub `staging` environment configuration:

| Kind     | Name                                  | Purpose                                                                   |
| -------- | ------------------------------------- | ------------------------------------------------------------------------- |
| secret   | `CLOUDFLARE_API_TOKEN`                | Least-privilege token for the staging Worker and staging D1 only.         |
| secret   | `CLOUDFLARE_ACCOUNT_ID`               | Cloudflare account identifier.                                            |
| variable | `CLOUDFLARE_STAGING_D1_DATABASE_NAME` | Isolated staging D1 database name.                                        |
| variable | `CLOUDFLARE_STAGING_WORKER_NAME`      | Optional non-production Worker name; defaults to `monopoly-bank-staging`. |

When transactional email is re-enabled, set `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, and `APP_ORIGIN` as staging Worker secrets before a release. `APP_ORIGIN` must equal the HTTPS staging custom domain. The workflow verifies only secret names; it never prints values. While email delivery is disabled the workflow skips this check.

Run **Staging release** manually with its isolated HTTPS URL and a non-sensitive existing staging game ID. It records in the GitHub job log:

- lint, unit tests, clean-DB migrations, and upgraded-fixture migrations;
- resolved staging D1 ID plus generated Worker/D1/DO binding validation;
- required Worker secret names;
- a pre-deploy D1 export restored into a disposable local D1, with foreign-key and schema checks plus a fixture lookup;
- migration application, Worker deployment, and HTTPS smoke checks for the app shell, unauthenticated API boundary, and security headers.

The export is kept only in the runner workspace for the restore rehearsal and is deleted before the job finishes. Do not upload it as a CI artifact or log its contents.

**Staging browser quality** is a second manual workflow that runs the Playwright suite against the staging URL and uploads the Playwright report; see the [testing pyramid](testing-pyramid.md).

## Database delivery contract

Every database change follows this sequence:

1. **Expand**: add nullable columns, additive tables or indexes only.
2. **Backward-compatible code**: deploy code that works against both pre- and post-expand schemas.
3. **Backfill**: run a resumable, idempotent, observable job in staging first; record counts and reconciliation queries in the release evidence.
4. **Contract**: only after all supported Worker versions and backfills are confirmed, remove obsolete reads/writes in a later release.

Never combine expand and contract in one migration. D1 migrations are append-only and are applied in filename order; `npm run test:d1` verifies both a blank database and a fixture first migrated through `0010`, then upgraded through the current migration set.

## Production deployment

After the database setup above:

```bash
npx wrangler d1 migrations apply MONOPOLY_BANK_DB --remote
npm run deploy
```

Run the migration command before every deployment that introduces a new file in `migrations/`. The first deployment also applies the `v1` Durable Object class migration declared in `wrangler.jsonc`; see [Real-time Durable Objects](realtime-durable-objects.md).

### Manual production release

Production releases are manual only:

1. Merge the release PR from `dev` into `main` after its required checks and review.
2. Open **Actions → Deploy → Run workflow**.
3. Select `main`, enable `confirm_production_release`, provide the production HTTPS URL for smoke testing, and run the workflow.

The workflow re-runs lint, tests, and the production build, validates the production bindings, performs a `wrangler deploy --dry-run`, applies production D1 migrations, deploys `monopoly-bank`, and runs `npm run smoke:deployment` against the supplied URL. It does not create or substitute production D1 IDs and must not be triggered without separate authorization. Configure required reviewers on the GitHub `production` environment if an additional approval gate is desired.

Before production approval: review staging evidence, confirm native D1 backup/time-travel retention, run the same backup/restore rehearsal against a sanitized or access-restricted export, confirm pending migrations are expand-safe, and save the current Worker version ID from `wrangler versions list`.

### Rollback

If post-deploy smoke fails, first stop further releases, then run `wrangler rollback` (or select the recorded version) for the Worker only. Do **not** attempt to reverse an already-applied D1 migration. Stabilize with forward-compatible code, preserve the incident evidence, and use D1 point-in-time recovery only under an approved data-recovery runbook. Re-run smoke tests after rollback.

## Release history

The frozen release assessments from 2026-09-06 are kept under [`docs/archive/`](archive/release-candidate-report.md). They record a NO-GO decision at that date and do not describe the current system.
