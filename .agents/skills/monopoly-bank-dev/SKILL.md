---
name: monopoly-bank-dev
description: Develop the Monopoly Bank repository efficiently and safely. Use whenever implementing, modifying, testing, debugging, refactoring, reviewing, or architecting its React/Vite UI, TypeScript domain logic, Cloudflare Worker/D1 persistence, banking transactions, or dice roller.
---

# Monopoly Bank development

## UI design authority

- Before UI work, read `docs/ui-design-system.md`. It is the repository's sole authority for visual styles, colour modes, tokens, responsive behaviour, overlays, motion, accessibility, and visual validation.
- Treat current CSS and screenshots as implementation evidence, not as instructions to reproduce a visual treatment. Do not create a parallel design brief in this skill or another agent file.

## Work efficiently

- Start with the smallest relevant file set: `package.json`, then the affected feature, its caller, and its test. Read Wrangler configuration before touching Worker, D1, bindings, migrations, or deployment.
- Reuse installed dependencies and established patterns. The production repository has a React/Vite client in `src/`, a Cloudflare Worker in `worker/`, shared contracts/domain code in `shared/`, D1 migrations in `migrations/`, and configured D1/Durable Object bindings. Extend the existing architecture; do not replace configuration with boilerplate.
- Keep diffs focused. Do not scan, reformat, or refactor unrelated areas. Do not reread files already known unless the task may have changed them.
- For a small task: inspect, change, run the narrowest check, report. Give a short plan only for cross-cutting work.
- Follow strict TypeScript configurations (`noUnusedLocals`, `noUnusedParameters`, `erasableSyntaxOnly`); use explicit shared types and integer money values.

## Boundaries and persistence

- Keep React components focused on presentation and interaction. Put money rules in domain/application services; keep SQL and D1 access in Worker/repository code.
- Validate API input at the Worker boundary. Do not expose implementation errors. Keep secrets in Cloudflare bindings/secrets, never source.
- Treat persisted D1 data as the source of truth. Add schema changes as migrations and update Wrangler bindings deliberately.
- Make every multi-balance operation plus its transaction record all-or-nothing. Failed validation must leave every balance unchanged. Never store a bank balance.
- Persist explicit transaction records and support global and player-filtered history; never derive history from balances or add undo/editing of past transactions.

## Product rules

- Treat `AGENTS.md`, `shared/contracts/`, and `shared/domain/` as the current product and financial contract; do not revive assumptions from an earlier MVP.
- Keep Monopoly Bank a banking companion rather than a board engine. Do not add property ownership, board position, or turn-order state.
- Reject insufficient funds and negative balances without writes; return safe structured balance details where the established API contract provides them.
- Interpret player→all amounts per recipient and all→player amounts per payer, validating every affected wallet before any write.
- Require the established review/confirmation flow for balance changes, including source, destination, amount, relevant total, and resulting balances.
- Keep dice behaviour within the existing bounded dice/jail contract. Its presentation and motion follow `docs/ui-design-system.md`.

## Validation

- Use the scripts and tooling actually present in `package.json`; run the narrowest relevant test/check first, then `npm run lint` or `npm run build` when scope warrants it.
- When adding banking logic, cover successful and insufficient-funds paths for every operation, negative-balance prevention, and transaction creation. Test atomic multi-player failures. Keep dice tests deterministic and avoid animation-timing tests.
- Use the existing Vitest, Playwright, D1 validation, lint, and build scripts. Extend the established suite instead of creating a parallel test system.
