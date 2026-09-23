# Monopoly Bank

A responsive English/Ukrainian banking companion for an in-person Monopoly game. It stores games, player wallets, and explicit banking history in Cloudflare D1; it does not implement board or game-engine rules. The UI language switch is available in the header and the preference is retained in the browser.

D1 is the source of truth for games, wallets and the transaction ledger. Monopoly Bank does not move tokens, track turn order, own properties or draw chance cards: the players do that at the table, and the app keeps the money honest.

## Quick Start

Requires Node.js 22 (`.nvmrc` pins it; run `nvm use` first).

```bash
npm install
npm run setup
npm run dev
```

`npm run setup` checks your Node.js version and applies the D1 migrations to a local database under `.wrangler/`. It never contacts Cloudflare. `npm run dev` then serves the React client and the Worker together on one local origin.

Browser scenarios need Chromium once per machine: `npx playwright install chromium`. Everything else is covered in [local development](docs/local-development.md).

## Commands

| Command             | What it does                                                                                                          |
| ------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `npm run dev`       | Vite dev server with the Worker and local D1. See [local development](docs/local-development.md).                     |
| `npm run build`     | `tsc -b` plus the Vite production build of client and Worker into `dist/`.                                            |
| `npm run typecheck` | `tsc -b` on its own, without emitting.                                                                                |
| `npm run lint`      | ESLint over the repository.                                                                                           |
| `npm run format`    | Prettier writes formatting for the whole tree; `npm run format:check` only verifies.                                  |
| `npm test`          | Vitest unit, domain, route and Durable Object tests. See the [testing pyramid](docs/testing-pyramid.md).              |
| `npm run test:e2e`  | Opt-in Playwright suite against an isolated staging URL. See the [testing pyramid](docs/testing-pyramid.md).          |
| `npm run test:d1`   | Applies every migration to a throwaway local D1 and checks the financial constraints. See [scripts](docs/scripts.md). |

## Architecture

The same React 19 single-page client serves owners, registered players and guests from a phone, tablet or desktop browser, optionally installed as a PWA. It talks to a Cloudflare Worker over same-origin `/api/*` JSON and a per-game WebSocket. The Worker applies origin checks, validation, sessions, access control and rate limits, then routes banking mutations through one `GameSession` Durable Object per game, which serializes commands, makes retries idempotent and fans out versioned snapshots. Cloudflare D1 is the durable source of truth; Analytics Engine receives aggregate operational metrics and a daily cron cleans up expired data. Shared TypeScript contracts and domain rules are imported by both sides.

The full component diagram, runtime flow and tooling table are in [architecture](docs/architecture.md).

## Repository map

| Path                 | Role                                                                                                                                 |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `src/`               | React application, pages, reusable UI, localization, browser utilities, and the typed API client.                                    |
| `public/`            | PWA manifest, service worker, favicon, and install icons copied as static assets.                                                    |
| `shared/`            | Contracts, domain rules, and types shared by the client and Worker.                                                                  |
| `worker/`            | Worker entry point, API routing/validation, services, D1 repositories, security, metrics, email integration, and the Durable Object. |
| `migrations/`        | Ordered D1 schema migrations and database constraints.                                                                               |
| `scripts/`           | Local setup, D1 migration checks, deployment configuration generators, binding validation, smoke/load tests, and restore rehearsal.  |
| `e2e/`               | Playwright browser scenarios (`production-pyramid.spec.ts`), opt-in against an isolated staging deployment.                          |
| `docs/`              | Reference library; start at [docs/README.md](docs/README.md).                                                                        |
| `.github/workflows/` | CI plus development, staging, and production delivery workflows.                                                                     |

UI work is governed by the canonical [UI design system](docs/ui-design-system.md). Current CSS and screenshots describe builds; they do not define a separate design contract. The implemented visual styles are `classic-bank` and `liquid-glass`, each supporting light, dark and system colour modes.

## Documentation

| Document                                                      | Purpose                                                                                |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| [docs/README.md](docs/README.md)                              | Index of every document with its live/archived status.                                 |
| [Architecture](docs/architecture.md)                          | Component diagram, runtime flow and components-and-tools table.                        |
| [Local development](docs/local-development.md)                | Setup, dev server, validation commands, browser tests, disabled email settings.        |
| [Deployment](docs/deployment.md)                              | Environment isolation, credentials, development/staging/production releases, rollback. |
| [Scripts](docs/scripts.md)                                    | Every file under `scripts/` with its npm alias, purpose and requirements.              |
| [API errors](docs/api-errors.md)                              | Error envelope, request correlation and stable error codes.                            |
| [Real-time Durable Objects](docs/realtime-durable-objects.md) | `GAME_SESSIONS` binding, WebSocket Hibernation and class-migration rules.              |
| [Testing pyramid](docs/testing-pyramid.md)                    | Test layers and how to run the opt-in browser and load suites.                         |
| [Operations runbooks](docs/operations-runbooks.md)            | Telemetry, alerts, retention and incident procedures.                                  |
| [Security threat model](docs/security-threat-model.md)        | Trust boundaries, threats, mitigations and the authorization matrix.                   |
| [UI design system](docs/ui-design-system.md)                  | The sole authority for the UI.                                                         |
| [Legacy game ownership](docs/legacy-game-ownership.md)        | Assigning owners to pre-account games.                                                 |
| [ADRs](docs/adr/README.md)                                    | Architecture decision records.                                                         |
| [Archive](docs/archive/release-candidate-report.md)           | Frozen 2026-09-06 release assessments, kept for history.                               |

## Contributing and license

Monopoly Bank is licensed under the [MIT License](LICENSE). Contributions are welcome; see [CONTRIBUTING.md](CONTRIBUTING.md) for the branch model, the commit hooks and the pre-PR checklist. For security vulnerabilities, follow the private reporting process in [SECURITY.md](SECURITY.md) rather than opening a public issue.
