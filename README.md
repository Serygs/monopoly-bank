# Monopoly Bank

A responsive English/Ukrainian banking companion for an in-person Monopoly game. It stores games, player wallets, and explicit banking history in Cloudflare D1; it does not implement board or game-engine rules. The UI language switch is available in the header and the preference is retained in the browser.

## Database setup

`wrangler.jsonc` contains the production `MONOPOLY_BANK_DB` binding. If a new production D1 database is created, update that binding's `database_id` deliberately before running remote migrations or deploying.

```bash
npx wrangler d1 create monopoly-bank
```

## Local development

```bash
npm install
npx wrangler d1 migrations apply MONOPOLY_BANK_DB --local
npm run dev
```

The Vite Cloudflare plugin runs the React UI and Worker together. Local D1 data is held in `.wrangler/`, which is ignored by Git.

## Validation

```bash
npm test
npm run lint
npm run build
```

`npm run build` includes the TypeScript project build; there is no separate typecheck script.

## Production deployment

After the database setup above:

```bash
npx wrangler d1 migrations apply MONOPOLY_BANK_DB --remote
npm run deploy
```

Run the migration command before every deployment that introduces a new file in `migrations/`. Do not commit account credentials or Cloudflare API tokens.

## GitHub Actions deployments

### Cloudflare credentials

Create a Cloudflare API token scoped to the account that owns the Worker. It needs `Workers Scripts: Edit` and `D1: Edit` account permissions. Copy the account ID from the Cloudflare dashboard.

In GitHub, open **Settings → Environments** and create both `development` and `production`. Add these environment secrets to each environment:

- `CLOUDFLARE_API_TOKEN` — the Cloudflare API token;
- `CLOUDFLARE_ACCOUNT_ID` — the Cloudflare account ID.

Environment secrets are separate: adding credentials to `production` does not make them available to `development`. Do not store either value in source code or as a plain GitHub variable.

### Automatic development deployment

Pushes to `dev` deploy automatically to the separate `monopoly-bank-dev` Worker and D1 database. Create that database once while authenticated to the same Cloudflare account:

```bash
npx wrangler d1 create monopoly-bank-dev --location eeur
```

- secrets: `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`;
- optionally, the `CLOUDFLARE_DEV_D1_DATABASE_NAME` variable when the database is not named `monopoly-bank-dev`.

The workflow resolves the development D1 database UUID from its name, so no database ID needs to be stored in GitHub. The database must identify the development database, not `monopoly-bank`. Pending migrations are applied to that development database before each deployment.

After committing the workflow to `dev`, push or merge a change into `dev`. The `CI` workflow validates the revision, resolves the development D1 database, applies migrations, and deploys `monopoly-bank-dev`.

### Manual production release

Production releases are manual only:

1. Merge the release PR from `dev` into `main` after its required checks and review.
2. Open **Actions → Deploy → Run workflow**.
3. Select `main`, enable `confirm_production_release`, and run the workflow.

The workflow re-runs lint, tests, and the production build, applies production D1 migrations, and then deploys `monopoly-bank`. Configure required reviewers on the GitHub `production` environment if an additional approval gate is desired.
