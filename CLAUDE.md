# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

`AGENTS.md` holds the binding project rules (architecture boundaries, UI/localization, API/security, validation). Read it first; it is not repeated here. `docs/ui-design-system.md` is required reading before any UI work.

## Commands

Node 22 only (`.nvmrc`, enforced by `engines`).

```bash
npm install && npm run setup   # first time: applies migrations to the local D1 (.wrangler/)
npm run dev                    # Vite + Worker (workerd) on one origin, local D1
npm test                       # Vitest (dom + node projects)
npx vitest run path/to/file.test.ts           # single file
npx vitest run -t "test name"                 # single test by name
npm run lint                   # ESLint, also enforces client/Worker/shared import zones
npm run typecheck              # tsc -b over all project references
npm run build                  # tsc -b + vite build
npm run test:worker            # game-session + api-router tests only
npm run test:d1                # migration/constraint checks on a throwaway local D1
npm run test:visual            # Playwright visual project (required for visible UI changes)
npm run test:visual:update -- -g '<name>'     # re-record ONE baseline; never a blanket update
npm run check                  # lint + test
```

`npm run test:e2e` is opt-in: it needs `E2E_BASE_URL` and `E2E_RUN=true` against a staging deployment, otherwise tests skip. Husky + commitlint enforce conventional commits (see `CONTRIBUTING.md`).

On Windows, run `test:visual*`, `test:e2e`, and any script with an inline env prefix through the Bash tool; they fail under PowerShell/cmd.

## Product model

A banking companion for an in-person Monopoly table — it keeps money honest, the players run the board. Rules from `.agents/skills/monopoly-bank-dev/SKILL.md` (a Codex-format skill Claude Code does not auto-load):

- Roles: game owner, registered player, guest. Authorization is enforced in the Worker (`docs/security-threat-model.md` has the matrix).
- Game status `LOBBY` → `ACTIVE` → `FINISHED`; player status `ACTIVE` | `BANKRUPT`. Deleted games are soft-deleted and restorable for 30 days.
- Transfers: player↔player, player↔bank, player→all (amount is per recipient), all→player (amount is per payer). Validate every affected wallet before any write; insufficient funds is rejected with no writes.
- Every balance change goes through the review/confirmation flow (source, destination, amount, total, resulting balances) and writes an explicit transaction record. History is never derived from balances; there is no undo or editing of past transactions.
- Payment requests, dice rolls (bounded dice/jail contract), and statistics are persisted features alongside the ledger.
- Banking tests cover success, insufficient funds, negative-balance prevention, transaction creation, and atomic multi-player failure. Dice tests stay deterministic.

## Architecture

Three TypeScript layers with enforced import boundaries (see `eslint.config.js`):

- `src/` — React 19 client. `src/api/monopoly-bank-api.ts` is the typed REST/WebSocket client; `src/components/ui/` is the UI kit, `src/components/game/` the domain composites.
- `worker/` — Cloudflare Worker (`worker/index.ts`: fetch + daily scheduled cleanup). Request flow: origin/security checks → `validation/api-validation.ts` → `routes/api-router.ts` → `services/*` → `repositories/*` (parameterized D1 SQL). Live mutations are routed via `services/game-live-gateway.ts` into the per-game `GameSession` Durable Object (`worker/game-session.ts`), which serializes commands, deduplicates by command ID, persists through D1-backed services and broadcasts versioned snapshots over WebSocket. Durable Object storage only coordinates; D1 stays the source of truth.
- `shared/` — code imported by both sides: `contracts/` (API + live-event shapes), `domain/` (banking, player-control, winner, summary rules), `types/`.

Tests are colocated (`*.test.ts`); `*.sqlite.test.ts` repository tests run against real SQLite. Vitest uses jsdom for `src/**` and Node for everything else (jsdom breaks `new URL(..., import.meta.url)` in migration tests). In test mode the Cloudflare Vite plugin is disabled, so tests use mocked Worker/D1 boundaries.

Migrations are numbered sequentially (`0001`…`0019`; next is `0020`). Never edit an applied migration. Constraint tests sit next to the SQL (`migrations/NNNN_*.test.ts`), and `npm run test:d1` must pass after any schema change.

Further detail: `docs/architecture.md`, `docs/realtime-durable-objects.md`, `docs/api-errors.md`, `docs/security-threat-model.md`, `docs/local-development.md`.

## Reading budget

These files are large. Grep for the relevant part and read only that range:

- `docs/ui-design-system.md` (~860 lines): read by `##` heading.
- `src/i18n/translations.ts` (~900 lines): `english` catalog first, then `ukrainian`. The latter is typed `Record<TranslationKey, string>`, so `tsc` enforces key parity.
- `worker/routes/api-router.ts` (~720 lines): Grep for the neighbouring route.

## Orchestration

The main session is the only orchestrator, because subagents cannot spawn subagents. Project agents live in `.claude/agents/`:

| Agent                | Model  | Use for                                                                 |
| -------------------- | ------ | ----------------------------------------------------------------------- |
| `test-runner`        | haiku  | Any test/lint/build/test:d1/test:visual run; returns only failures.     |
| `ui-builder`         | sonnet | `src/` changes, i18n strings, UI tests.                                 |
| `worker-backend`     | sonnet | `worker/`, `shared/contracts`, `shared/domain` changes and their tests. |
| `d1-migration`       | sonnet | New migration + `test:d1`; only when a schema change is required.       |
| `i18n-auditor`       | haiku  | Read-only scan for hard-coded or untranslated strings after UI changes. |
| `invariant-reviewer` | opus   | Read-only review of the diff against `AGENTS.md` and the product model. |

- Small or single-layer tasks: work inline. A spawn starts cold, so delegate only for parallel fan-out or to keep noisy output out of context.
- Cross-layer features:
  1. Settle the `shared/contracts` types in the main session.
  2. Run `d1-migration` if the schema changes.
  3. Run `worker-backend` and `ui-builder` in parallel.
  4. Run `test-runner`.
  5. Run `invariant-reviewer`, plus `i18n-auditor` if the UI changed.
- Pass subagents exact file paths and the contract so they don't re-explore. Act on their summaries rather than re-reading their work.
- Use the built-in `Explore` agent only when the location is unknown and the search is broad. Otherwise use Grep/Read directly.
