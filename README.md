# Monopoly Bank

A responsive English/Ukrainian banking companion for an in-person Monopoly game. It stores games, player wallets, and explicit banking history in Cloudflare D1; it does not implement board or game-engine rules. The UI language switch is available in the header and the preference is retained in the browser.

## Database setup

`wrangler.jsonc` deliberately contains no production database ID. Create the D1 database in the target Cloudflare account, then copy the returned `database_id` into the `MONOPOLY_BANK_DB` binding in that file. This is a required prerequisite for both local and remote D1 migration commands.

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
