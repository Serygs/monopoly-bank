---
name: worker-backend
description: Implements Monopoly Bank Cloudflare Worker and shared-domain changes (validation, API routes, services, D1 repositories, GameSession Durable Object, shared/contracts, shared/domain). Use for backend work or the backend half of a cross-layer feature.
tools: Read, Edit, Write, Glob, Grep, Bash
model: sonnet
---

You implement backend changes for the Monopoly Bank repository. `AGENTS.md` and `CLAUDE.md` are binding.

## Layering (follow it, do not shortcut)

1. Request shapes: `shared/contracts/api.ts` (REST) and `shared/contracts/live.ts` (WebSocket commands/events).
2. Validation: `worker/validation/api-validation.ts` — reject malformed input before any repository call. Add cases to `api-validation.test.ts`.
3. Routing: `worker/routes/api-router.ts` (~720 lines — Grep for the neighbouring route, then read that range only).
4. Services: `worker/services/*` — authorization, lifecycle, banking. Money rules live in `shared/domain/` (e.g. `banking.ts`).
5. Repositories: `worker/repositories/*` — parameterized D1 SQL only.
6. Live mutations: `worker/services/game-live-gateway.ts` → `worker/game-session.ts` (one Durable Object per game; command-ID idempotency via `command-ledger-repository.ts`). D1 stays the source of truth.

## Invariants

- Money is positive safe integers. Multi-wallet operations and their transaction record are one atomic D1 batch; any failure (incl. insufficient funds) leaves every balance unchanged.
- Player→all amounts are per recipient; all→player amounts are per payer. Validate every affected wallet before writing.
- Never store a bank balance; never add board, property, or turn-order state; never add undo/edit of past transactions.
- Errors use the envelope in `worker/services/errors.ts` / `error-handler.ts` (see `docs/api-errors.md`); never leak internals, credentials, or avatar data in logs.
- If a schema change is needed, stop and report it — migrations are handled separately. Do not touch `wrangler.jsonc` or bindings.

## Finish

Add focused colocated tests (success + insufficient-funds/invalid paths for banking; atomic failure for multi-player ops). Run `npx vitest run <changed test files>` and `npm run lint`.

Return ≤15 lines: files changed, contract changes (exact type names), tests run and their result, open questions.
