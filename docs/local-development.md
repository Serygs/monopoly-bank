# Local development

Monopoly Bank runs the React client and the Cloudflare Worker together on one local origin, backed by a local D1 database. Nothing in this page contacts Cloudflare.

## Prerequisites

- Node.js 22. `.nvmrc` pins the version; run `nvm use` (or install Node 22) before anything else. `package.json#engines` rejects other majors.
- npm (bundled with Node).
- Chromium for Playwright, only if you run browser scenarios: `npx playwright install chromium` once per machine.

## First-time setup

```bash
npm install
npm run setup
npm run dev
```

`npm run setup` runs `scripts/setup.mjs`. It checks the Node.js version against `.nvmrc`, confirms `node_modules` contains Wrangler, and applies every migration in `migrations/` to the local D1 database with `wrangler d1 migrations apply MONOPOLY_BANK_DB --local`. Re-running it is safe: Wrangler skips migrations it has already applied. The script never uses `--remote`, never logs in, and never touches the production binding.

`npm install` also installs the husky Git hooks (`prepare` script). See [CONTRIBUTING.md](../CONTRIBUTING.md) for what they run.

## What `npm run dev` does

The Vite Cloudflare plugin runs the React UI and Worker together. Vite serves the client with hot module replacement and proxies `/api/*` and the per-game WebSocket to the Worker, which runs in the local workerd runtime with the bindings declared in `wrangler.jsonc`: the `MONOPOLY_BANK_DB` D1 database, the `GAME_SESSIONS` Durable Object and the Analytics Engine dataset.

Local D1 data is held in `.wrangler/`, which is ignored by Git. Delete `.wrangler/state/` to start from an empty local database, then run `npm run setup` again.

## Validation commands

| Command             | What it checks                                                                                                                            |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `npm test`          | Vitest unit, domain, route and Durable Object contract tests.                                                                             |
| `npm run lint`      | ESLint over the whole repository with the client/Worker/shared import zones.                                                              |
| `npm run typecheck` | `tsc -b` over every project reference without emitting.                                                                                   |
| `npm run build`     | `tsc -b` followed by the Vite production build of the client and the Worker into `dist/`.                                                 |
| `npm run test:d1`   | Applies every migration to a throwaway local D1, asserts the financial constraints, then replays an upgrade from migration `0010` onward. |
| `npm run check`     | `npm run lint && npm test`.                                                                                                               |
| `npm run format`    | Prettier writes formatting for the whole tree; `npm run format:check` verifies without writing.                                           |

`npm run build` includes the TypeScript project build; `npm run typecheck` runs the same `tsc -b` on its own.

## Browser and load tests

`npm run test:e2e` runs the Playwright suite in `e2e/`. It is deliberately opt-in and targets an isolated HTTPS staging deployment; without `E2E_BASE_URL` and `E2E_RUN=true` every test is skipped:

```bash
E2E_BASE_URL=https://monopoly-bank-staging.example E2E_RUN=true npm run test:e2e
```

The repository does not currently ship a runner that builds the Worker, starts `wrangler dev --local` and drives Chromium against it. Install Chromium once with `npx playwright install chromium` before running the suite. The [testing pyramid](testing-pyramid.md) describes what the suite and the opt-in load runner (`npm run test:load`) cover.

## Transactional email (temporarily disabled)

Account registration and sign-in use a nickname and password only; email is not collected. Email verification and password reset are temporarily hidden until transactional email is configured. The Resend setup below is retained for re-enabling those delivery flows later.

- `RESEND_API_KEY` — a Resend API key allowed to send from the configured domain;
- `RESEND_FROM_EMAIL` — a sender address on a verified Resend domain, for example `Monopoly Bank <accounts@example.com>`;
- `APP_ORIGIN` — the public HTTPS origin used in email links, without a trailing path.

Set each value against the intended Worker configuration, for example:

```bash
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put RESEND_FROM_EMAIL
npx wrangler secret put APP_ORIGIN
```

Development and staging deployments must pass their generated `--config` file to the same commands. Release workflows currently skip the email secret check while delivery is disabled; see the comments in `.github/workflows/`. The provider choice is recorded in [ADR 0002](adr/0002-transactional-email-provider.md).

## Lobby invitations

Lobby owners create a secure invitation link from the lobby screen. The link contains a random bearer token, never the game password; only its SHA-256 hash is persisted. Tokens expire after seven days and cannot join a game after the lobby has started.

The Invite dialog can copy the link or open the device's default mail client with a populated invitation. No email address is sent to or stored by Monopoly Bank. SMS/phone delivery is not configured in the current Worker because there is no SMS provider binding; add a provider-specific Worker binding and delivery service before offering server-sent SMS.
