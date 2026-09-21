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
- Reuse installed dependencies and established patterns. This repository currently has the generated React/Vite/Cloudflare starter: Worker code is in `worker/`, UI is in `src/`, and Wrangler has no D1 binding yet. Extend it; do not replace configuration with boilerplate.
- Keep diffs focused. Do not scan, reformat, or refactor unrelated areas. Do not reread files already known unless the task may have changed them.
- For a small task: inspect, change, run the narrowest check, report. Give a short plan only for cross-cutting work.
- Follow strict TypeScript configurations (`noUnusedLocals`, `noUnusedParameters`, `erasableSyntaxOnly`); use explicit shared types and integer money values.

## Boundaries and persistence

- Keep React components focused on presentation and interaction. Put money rules in domain/application services; keep SQL and D1 access in Worker/repository code.
- Validate API input at the Worker boundary. Do not expose implementation errors. Keep secrets in Cloudflare bindings/secrets, never source.
- Treat persisted D1 data as the source of truth. Add schema changes as migrations and update Wrangler bindings deliberately.
- Make every multi-balance operation plus its transaction record all-or-nothing. Failed validation must leave every balance unchanged. Never store a bank balance.
- Persist explicit transaction records and support global and player-filtered history; never derive history from balances or add undo/editing of past transactions.

## MVP rules

- Support 2–6 players with `id`, name, color, and balance. Starting balance and Pass GO reward are shared game settings fixed at game start. Values are integer thousands with no currency label.
- Implement only banking: player→player (including manual Pay Rent), player→bank, bank→player, player→all, all→player, and Pass GO. Do not introduce board, properties, turn, position, jail, or game-engine behavior.
- Reject insufficient funds and negative balances without writes; return the affected player's current balance and required amount.
- Interpret player→all amount per recipient and require the payer to cover `amount × recipient count`. Interpret all→player amount per payer and require every payer to afford it before any write.
- Require a UI confirmation for every balance change showing operation, source, destination, amount, relevant total, and practical resulting balances. Allow an optional transaction comment.
- Keep the dice roller standalone: two independent 1–6 dice, total, and doubles indicator. Do not connect it to banking or game state. Its presentation and motion follow `docs/ui-design-system.md`.

## Validation

- Use the scripts and tooling actually present in `package.json`; run the narrowest relevant test/check first, then `npm run lint` or `npm run build` when scope warrants it.
- When adding banking logic, cover successful and insufficient-funds paths for every operation, negative-balance prevention, and transaction creation. Test atomic multi-player failures. Keep dice tests deterministic and avoid animation-timing tests.
- The starter currently has no test script or Vitest dependency. Before adding test infrastructure, inspect the current package configuration; add it only when needed for the change and keep it minimal.
