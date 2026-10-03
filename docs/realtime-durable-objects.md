# Real-time Durable Objects

The `GAME_SESSIONS` Durable Object binding is declared in `wrangler.jsonc`. `GameSession` uses Cloudflare's WebSocket Hibernation API and one deterministic object name per game ID. D1 remains the durable source for game data, history, and statistics.

Run these commands from the repository root; replace the environment name only if you deploy a named Wrangler environment.

```sh
# 1. Apply all pending D1 migrations to the production database.
npx wrangler d1 migrations apply monopoly-bank --remote

# 2. Apply the Durable Object class migration and Worker configuration.
#    Wrangler applies the configured `v1` new_sqlite_classes migration on deploy.
npm run build
npx wrangler deploy

# 3. For normal subsequent Worker/application deployments.
npm run deploy
```

For local development, `npm run setup` applies the migrations to the local D1 database before `npm run dev`; the equivalent manual command is `npx wrangler d1 migrations apply monopoly-bank --local`.

Do not manually create a second Durable Object class migration with the same `v1` tag. Any future class rename or deletion needs a new Wrangler migration tag.

The full release procedure, including the isolated development and staging environments, is in [deployment](deployment.md).
