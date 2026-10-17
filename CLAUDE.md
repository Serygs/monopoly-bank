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
- Every balance change goes through the review/confirmation flow (source, destination, amount, total, resulting balances) and writes an explicit transaction record. History is never derived from balances; a stored transaction is never edited or deleted. A mistake is corrected only by a new `REVERSAL` transaction (`reverseTransaction` in `shared/domain/banking.ts`) that moves exactly the original deltas back and links to it (`reverses_transaction_id`, unique, so once per transaction). A reversal itself and a bankruptcy transfer cannot be reversed; every participant must still be active and hold the money. A transaction is also refused (`REVERSAL_BLOCKED_BY_LATER_OPERATION`) while a later mortgage, loan, auction payment, Free Parking step or bankruptcy by one of the same players builds on it (`findReversalDependency` in `shared/domain/reversal.ts`; the Worker checks all later transactions, the Activity ledger shows the reason from what it has loaded). The Reverse button lives in the Activity ledger (All and Mine); the wallet's history link opens that tab. The game owner may reverse any transaction; a player only one made from a wallet they control (`reversalInitiatorPlayerId`), within `REVERSAL_WINDOW_MS`. Statistics skip a reversed transaction and its reversal, since the game did not move that money.
- Optional house rules (`Game.rules`: double reward on exact GO, player loans, bank loans, Free Parking jackpot, auctions) are chosen at game creation, all off by default, and never change afterwards. Every service method behind a rule calls `assertRuleEnabled` (`worker/services/rule-guard.ts`), which rejects with `RULE_DISABLED`; the UI only hides controls. `Game.settings` is a snapshot of amounts derived from the starting balance (`shared/domain/game-rules.ts`: money unit = S/150 rounded to a 1-2-5 value, taxes, jail fine, loan and auction limits); games created before it have `settings: null`.
- Mortgages: a player mortgages a property to the bank (`MORTGAGE`, free-text name up to 60 characters, value from the property card, paid by the bank) and redeems it later for the value plus 10% (`MORTGAGE_REDEMPTION`, `redemptionCost` in `shared/domain/mortgage.ts`). The `mortgages` table only remembers which properties are currently mortgaged (never who owns what); each step is an explicit transaction written in the same batch, a player can have one active mortgage per name (case-insensitive), and neither transaction can be reversed. When a player goes bankrupt their active mortgages move to the creditor (so the creditor can redeem them), or are released when the bankruptcy is to the bank; both happen in the bankruptcy's own batch. Without a board, rent is not enforced: paying a player shows their mortgaged properties as a hint.
- Player loans (rule `playerLoans`): a borrower asks (`LOAN_ISSUE`, always a pending payment request of kind `LOAN` the lender must accept, whatever the payment mode); accepting writes the `LOAN_ISSUE` transaction and the `loans` row in one batch. The borrower repays any part with `LOAN_REPAYMENT` (`loans` + `loan_repayments`, guarded by CHECKs so a stale or double repayment rolls back). Loans are banking state like mortgages, carry no interest, and neither transaction can be reversed. On bankruptcy the player's debts are written off and loans they made pass to the creditor (written off when the creditor is the borrower or the bank). Loan transactions are left out of sent/received statistics.
- Bank loans (rule `bankLoans`): `LOAN_ISSUE` with `lenderKind: 'BANK'` is paid at once (no payment request), at most `settings.bankLoanMax`, one active per player (`BANK_LOAN_ALREADY_ACTIVE`, unique partial index). It is repaid in full with `LOAN_REPAYMENT` plus interest on the principal at 0/10/20% (`interestRatePercent`, half up; the interest leaves the game), recorded in `loan_repayments`. The suggested rate follows the loan's _round_, which is only a hint derived on read from whose operations follow the loan in the transaction log (`shared/domain/round-tracking.ts`): never stored, never enforced, never a turn order. Round 4 is shown as overdue; after repaying, borrowing again within 2 rounds needs `acknowledgeCooldown` (`BANK_LOAN_COOLDOWN`, stored as `loans.cooldown_acknowledged`). With the rule on, every response and live event carries `loans` (bank loans with `rounds`) and `bankLoanCooldowns`, since any operation can advance a round. On bankruptcy the bank is paid first (principal, then interest at the suggested rate) from the wallet, before a player creditor gets the rest; a loan whose principal is covered is `REPAID`, otherwise `WRITTEN_OFF`.
- Free Parking jackpot (rule `freeParkingJackpot`): the pot is banking state, the one allowed game-level balance (`games.jackpot_balance`, `CHECK >= 0`, scoped to this rule; there is still no general bank balance). It starts at 0, changes only in the same D1 batch as a `TO_JACKPOT` transaction (a player pays a tax into the pot; the UI sends it for the income-tax and luxury-tax chips only, the jail fine stays `PLAYER_TO_BANK`) or a `JACKPOT_PAYOUT` (the player takes the whole pot, amount read on the server; the request carries `expectedAmount`, the pot the player reviewed, and a pot that differs is refused before any write with `JACKPOT_CHANGED` (`details.jackpot`, `details.expectedAmount`), an empty pot with `JACKPOT_EMPTY`; the batch is still guarded by a compare-and-set, so a pot that changed in between rolls back and is reported the same way). Neither can be reversed (a correction is a new operation); bankruptcy leaves the pot untouched. Statistics count them as money the player sent / received, not as bank or player-to-player money. With the rule on, every response, `GameDetails` and `GAME_COMMITTED` carries `jackpot`.
- Auctions (rule `auctions`): one lot at a time, a free-text name (up to 60 characters) and no ownership tracking; the app only records who pays the bank. `START_AUCTION` sets a server-side `endsAt` 30 seconds out (a bid moves `endsAt` to at least 10 seconds after the bid, `AUCTION_BID_EXTENSION_MS`, and never earlier); `PLACE_BID` sends a `step` from `settings.auctionBidSteps` plus the `expectedVersion` the bidder saw (compare-and-set on the auction `version`: `AUCTION_BID_STALE`, `AUCTION_ALREADY_LEADING`, `AUCTION_CLOSED`, `INVALID_BID_STEP`, `INSUFFICIENT_AVAILABLE_FUNDS`; one running auction per game: `AUCTION_ALREADY_ACTIVE`). The leading bid is reserved on the leader (derived, never stored, `auctionReserve` in `shared/domain/auction.ts`): every debit path in `banking-service` (and payment-request creation) leaves the leader at least that much, else `INSUFFICIENT_AVAILABLE_FUNDS`; outbidding releases it. When the time is up the Durable Object (alarm, and lazily before commands and snapshots) settles exactly once: a sale is one guarded D1 batch (balance, `AUCTION_PAYMENT` transaction with the lot name as comment, auction `SOLD`), otherwise `NO_SALE` (no bid, bankrupt or short leader). A bankrupt leader withdraws the bid in the bankruptcy batch. `AUCTION_PAYMENT` counts as paid to the bank and is reversible like a `PLAYER_TO_BANK` payment (the auction row stays closed). `GameDetails.auction` shows the running or the last closed auction for two minutes; live event `AUCTION_UPDATED`; REST `GET /api/games/:id/auction`, `POST /api/games/:id/auctions`, `POST /api/games/:id/auctions/:auctionId/bids`, all through the game object.
- Board games (`Game.settings.board`, preset in `shared/board/`): the tile registry `game_properties` is the one place ownership lives, seeded at start and changed only by `PROPERTY_PURCHASE`, tile `MORTGAGE`/`MORTGAGE_REDEMPTION`, tile auctions, bankruptcy (and later building/trades), each with `property_changes` diffs that a `REVERSAL` inverts. `PAY_RENT` computes rent on the server (`rentFor` in `shared/domain/property.ts`; utilities take a payer-entered `diceSum` 2-12). Games without a board keep the free-text flows.
- Payment requests, dice rolls (bounded dice/jail contract), and statistics are persisted features alongside the ledger.
- Banking tests cover success, insufficient funds, negative-balance prevention, transaction creation, and atomic multi-player failure. Dice tests stay deterministic.

## Architecture

Three TypeScript layers with enforced import boundaries (see `eslint.config.js`):

- `src/` — React 19 client. `src/api/monopoly-bank-api.ts` is the typed REST/WebSocket client; `src/components/ui/` is the UI kit, `src/components/game/` the domain composites.
- `worker/` — Cloudflare Worker (`worker/index.ts`: fetch + daily scheduled cleanup). Request flow: origin/security checks → `validation/api-validation.ts` → `routes/api-router.ts` → `services/*` → `repositories/*` (parameterized D1 SQL). Live mutations are routed via `services/game-live-gateway.ts` into the per-game `GameSession` Durable Object (`worker/game-session.ts`), which serializes commands, deduplicates by command ID, persists through D1-backed services and broadcasts versioned snapshots over WebSocket. Durable Object storage only coordinates; D1 stays the source of truth.
- `shared/` — code imported by both sides: `contracts/` (API + live-event shapes), `domain/` (banking, player-control, winner, summary rules), `types/`.

Tests are colocated (`*.test.ts`); `*.sqlite.test.ts` repository tests run against real SQLite. Vitest uses jsdom for `src/**` and Node for everything else (jsdom breaks `new URL(..., import.meta.url)` in migration tests). In test mode the Cloudflare Vite plugin is disabled, so tests use mocked Worker/D1 boundaries.

Migrations are numbered sequentially (`0001`…`0026`; next is `0027`). Never edit an applied migration. Constraint tests sit next to the SQL (`migrations/NNNN_*.test.ts`), and `npm run test:d1` must pass after any schema change.

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
