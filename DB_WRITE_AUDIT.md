# D1 write audit

Production D1 runs on the Workers Free plan: 100,000 rows written per day. This audit covers every D1
write in the Worker, what each one costs, and what this branch changed. Money conservation and
player-visible behaviour are unchanged.

## Summary

- **The day the limit was hit was caused by migrations, not by play.** Over the last 7 days D1
  Insights shows about 107k rows written by table-rebuild migrations (0021, 0022, 0029, 0031 copy
  every transaction and participant row into a backup and back). The participant copy alone ran 18
  times for 82,296 rows, although only four migrations contain it, so about 14 attempts were rolled
  back and still billed. Gameplay over the same week wrote about 12k rows.
- Gameplay per operation is now 30–40% cheaper. The measured scenario dropped from **976 to 618
  rows** and a production-average game from **about 4,300 to 2,960 rows**.
- Five changes landed, one commit each, and a write-budget test keeps them from regressing.

|                                         | before                      | after  |
| --------------------------------------- | --------------------------- | ------ |
| Requested scenario (rows)               | 976                         | 618    |
| Scenario games / day                    | 102                         | 161    |
| Production-average game (rows, no dice) | ~4,295                      | ~2,959 |
| Production-average games / day          | 23 (21 with 100 dice rolls) | 33     |

The production-average game uses the real mix of the 9 finished production games: about 197
transactions, 203 commands and 3.8 players per game. Its per-type costs are the measured ones below.

## Method

1. **Static audit.** Every `INSERT`/`UPDATE`/`DELETE`/upsert under `worker/` was traced to its route
   or command, and every index was checked with `EXPLAIN QUERY PLAN` on an in-memory SQLite built
   from all migrations.
2. **Calibration.** D1 counts one row per table row plus one per index entry, including the implicit
   `sqlite_autoindex_*` behind a TEXT `PRIMARY KEY` or `UNIQUE`. Local workerd D1 (through
   `getPlatformProxy`) reports the same `rows_written` as production Insights: a transaction insert
   writes 6, a participant 4, a ledger insert 3, a balance update 1, an UPDATE that matches nothing 0. A DELETE costs 1 per row, and so does a delete made by a trigger. `DROP INDEX` writes 0 rows.
   `ALTER TABLE ADD COLUMN` rewrites nothing.
3. **Measurement.** `worker/write-budget.d1.test.ts` plays the scenario through the real Worker
   `fetch` handler and real `GameSession` objects, against a throwaway local D1. A wrapper adds up
   `meta.rows_written` per operation. It is now a committed check (`npm run test:write-budget`, in
   CI), so no temporary logging was added to production code.

Scenario: two registered players, board lobby, join, start, 20 transfers (P2P / P2B / B2P), a pass
GO, 5 purchases, a rent, 2 trades (request + accept), 2 tile mortgages, 30 dice rolls, 10 reconnects,
10 tab switches (version, game, trade requests, payment requests, pending activity), finish, and the
deferred ledger cleanup.

## Measured rows written per operation

| operation                                 | path                                  | before        | after            | change                    |
| ----------------------------------------- | ------------------------------------- | ------------- | ---------------- | ------------------------- |
| create board lobby                        | `POST /api/games`                     | 100           | 72               | P1                        |
| join                                      | `POST /api/games/join` → `JOIN_LOBBY` | 19            | 17               | P1, P3                    |
| start                                     | `START_GAME`                          | 5             | 3                | P1, P3                    |
| transfer (avg / max)                      | `CREATE_TRANSACTION`                  | 20.5 / 24     | 13.4 / 16        | P1, P2, P3                |
| pass GO                                   | `CREATE_TRANSACTION`                  | 15            | 11               | P1, P3                    |
| property purchase                         | `CREATE_TRANSACTION`                  | 20            | 15               | P1, P3                    |
| pay rent                                  | `CREATE_TRANSACTION`                  | 20            | 15               | P1, P3                    |
| trade request                             | `CREATE_TRADE_REQUEST`                | 9             | 7                | P1, P3                    |
| trade accept (1↔1 + cash)                 | `ACCEPT_TRADE_REQUEST`                | 34            | 27               | P1, P3                    |
| tile mortgage                             | `CREATE_TRANSACTION`                  | 26            | 21               | P1, P3                    |
| dice roll                                 | `POST …/dice-rolls`                   | 3             | **0** (1 DO row) | P4                        |
| refused command (e.g. insufficient funds) | any                                   | 2–3           | **0**            | P3                        |
| reconnect                                 | `GET …/live`                          | 0             | 0                | —                         |
| tab switch / resync                       | 5 GETs                                | 0             | 0                | P5 removes the write path |
| finish (30 rolls in the game)             | `FINISH_GAME`                         | 43            | 11               | P4                        |
| deferred ledger cleanup                   | daily cron                            | 1 per command | 1 per command    | —                         |
| **scenario total**                        |                                       | **976**       | **618**          |                           |

Rows read: dice reads fell from 1,198 to 182 for 30 rolls (the old insert trimmed with a scan).
Reconnects read about 315 rows each and resyncs about 95. Reads have a 5M/day budget and were not
the target here.

## Schema and indexes

Write cost per row = 1 + indexes (autoindexes included).

| table                                                                                                                 | indexes (after)                                                                      | used by                                                                                                               | verdict                                                              |
| --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| transactions                                                                                                          | PK, UNIQUE(id, game_id), UNIQUE(reverses_transaction_id), `by_game_id_created_at_id` | PK lookups; composite FK target; one reversal per transaction; activity/history paging                                | **dropped `transactions_by_game_id_created_id`**, an exact duplicate |
| transaction_participants                                                                                              | PK(transaction_id, player_id), `by_game_player_transaction`                          | membership filter via PK; statistics join and FK child check via game/player                                          | **dropped `by_player_id`**: no query leads with player_id alone      |
| players                                                                                                               | PK, UNIQUE(id, game_id), `by_game_id`                                                | FK target; game listing                                                                                               | kept                                                                 |
| games                                                                                                                 | PK, `by_owner_user_id`, `by_join_code` (partial), `by_deleted_at` (partial)          | listing, join, purge                                                                                                  | kept                                                                 |
| game_properties                                                                                                       | PK(game_id, tile_id)                                                                 | registry reads by game; FK child check by owner uses the PK prefix                                                    | **dropped `game_properties_by_owner`**                               |
| property_changes                                                                                                      | PK, `by_game_tile`                                                                   | reads by transaction (PK); `by_game_tile` is the FK child index for the cascade on purge                              | kept                                                                 |
| command_ledger                                                                                                        | PK(game_id, command_id)                                                              | dedupe; cleanup by game uses the PK prefix                                                                            | **dropped `by_game_created`**                                        |
| payment_requests                                                                                                      | PK, UNIQUE(transaction_id), `inbox`, `by_game_created`                               | inbox/expiry/listing use `by_game_created` or `inbox` by game                                                         | **dropped `payment_requests_recipient`**                             |
| user_sessions                                                                                                         | PK, UNIQUE(token_hash)                                                               | session lookup                                                                                                        | **dropped `by_token_hash`**, a duplicate of the UNIQUE               |
| game_invitations                                                                                                      | PK, `by_short_code`, `active_by_game`, `by_expiry`                                   | revoke/list by game                                                                                                   | **dropped `by_game_id`**, a prefix of `active_by_game`               |
| mortgages, loans, auctions, trade_requests, game_members, player_controllers, dice_rolls, game_recent_amounts, others | as defined                                                                           | each index serves a query or an FK child check (e.g. `player_controllers_by_user_game` for the guest-cleanup cascade) | kept                                                                 |

`migrations/0033_drop_unused_indexes.test.ts` runs `EXPLAIN QUERY PLAN` on every query that could
have used a dropped index and asserts it still searches an index, never a full scan.

## Write paths (before this branch)

| area                                    | statements                                                                                                                                                                                                                    | rows                |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------- |
| Transfer / bank operation               | one CASE `UPDATE players` (all wallets, compare-and-set), `INSERT transactions`, `INSERT transaction_participants` × n, three statements on `game_recent_amounts`, ledger `INSERT` + `UPDATE`                                 | 18–24               |
| Property purchase / rent / build / sell | as above + `UPDATE game_properties` + `INSERT property_changes` per tile                                                                                                                                                      | 20                  |
| Mortgage (tile)                         | + `INSERT mortgages` (2 autoindexes + 3 partial/explicit indexes)                                                                                                                                                             | 26                  |
| Trade                                   | `INSERT trade_requests`; accept = transaction + participants + per tile registry update and change + request update                                                                                                           | 9 + 34              |
| Payment request (CONFIRMATION mode)     | `INSERT payment_requests` (6); settle = balances, transaction, participants, request update, recent amounts                                                                                                                   | ~6 + ~20            |
| Bankruptcy                              | balances, transaction, participants, player status (same row as the balance update: 1 extra row), mortgages, loans, registry, auction bid, trade requests                                                                     | depends on holdings |
| Lobby                                   | games, players, game_members, player_controllers, 28 × game_properties for a board game                                                                                                                                       | 100                 |
| Join / leave                            | players, game_members, player_controllers / three deletes                                                                                                                                                                     | 12 + ledger         |
| Status changes                          | `UPDATE games` (status, timestamps); finish also writes completion rows (trigger updates users), final snapshot, and the dice trigger deletes every roll                                                                      | 5–43                |
| Dice roll                               | `INSERT dice_rolls` + trim `DELETE`                                                                                                                                                                                           | 3 (+1 at finish)    |
| Auth / sessions                         | register/login insert a session (4); renewal at most once per 24 h per session (1); rate limits upsert one bucket (1–2) on auth/join/invite routes only                                                                       | per request         |
| Heartbeat / presence / version          | Durable Object memory and storage only                                                                                                                                                                                        | 0 D1                |
| Statistics / activity                   | computed on read; one final snapshot row at finish                                                                                                                                                                            | 0 per event         |
| Daily cron                              | expires pending requests, deletes expired sessions/tokens/invitations/rate limits/old requests, completed ledger rows of finished games (1 per row), guests, and purges soft-deleted games after 30 days (cascade, 1 per row) | deferred            |

## Classification

- **Essential source of truth**: players (balance, status), transactions, transaction_participants,
  game_properties, property_changes, mortgages, loans and loan_repayments, auctions, games (settings,
  rules, status, jackpot), membership and controllers, payment and trade requests while pending.
- **Derivable**: `games.updated_at` (written only on lifecycle changes, never per event, so there is
  nothing to save), statistics and activity (already computed on read), final snapshots (one row).
- **Ephemeral**: dice rolls (moved to the Durable Object), presence and heartbeat (already
  Durable-Object-only), command-ledger results (a dedupe cache), recent amounts (a UI convenience).
- **Client-local candidates**: none that keep behaviour. Recent amounts and dice history are shared
  across players and devices; favourites are per game and written only on a tap.

## Hidden writes found

| where                                        | finding                                                                                                  | outcome                                                                                    |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `GET /activity?scope=PENDING`                | expired payment requests with an `UPDATE` before listing                                                 | **removed** (P5); the listing filters on `expires_at` instead                              |
| Refused commands                             | left a PENDING ledger row (2–3 rows) that the cleanup never removed; production shows 32 in the last day | **removed** (P3)                                                                           |
| Finishing a game                             | the dice trigger deleted every roll (1 row each)                                                         | **gone** for new rolls (P4)                                                                |
| Session renewal on any authenticated request | at most once per 24 h per session, 1 row                                                                 | kept: removing it would end the 14-day sliding login                                       |
| Mutation authorizers                         | `getPaymentRequest`/`getTradeRequest` expire stale requests first                                        | kept: mutation path, writes only rows that are due anyway                                  |
| Connect / snapshot / auction read            | settle an overdue auction lazily                                                                         | kept: a deferred settlement, not a read write; nothing is written unless an auction is due |
| Bankruptcy                                   | updates the bankrupt player's row twice                                                                  | kept: at most players − 1 rows per game                                                    |
| Reconnect, resync, heartbeat, version        | none                                                                                                     | verified 0 by the budget test                                                              |

## Proposals and decisions

| #   | proposal                                                                                                                                                              | estimate                                              | measured                                                          | decision                                                                                                                                                                                                                               |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- | ----------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| P1  | Drop 7 unused or duplicate indexes (`0033`)                                                                                                                           | −1/tx, −1/participant, −1/ledger row, −28/board lobby | scenario 976 → 829; transfer 20.5 → 17.2; lobby 100 → 72          | **done**                                                                                                                                                                                                                               |
| P2  | Recent amounts as one JSON column on `games` (`0034`), written in the operation's batch with the client's move-to-front rule; legacy table read until the first write | −5/transfer                                           | −2.8/transfer (deletes cost 1 per row, not 3); scenario 829 → 774 | **done**                                                                                                                                                                                                                               |
| P3  | Command ledger written once, already COMPLETED; the claim is a read                                                                                                   | −1/command, refused 3 → 0                             | −1/command, refused → 0; scenario 774 → 738                       | **done**                                                                                                                                                                                                                               |
| P4  | Dice rolls in the game Durable Object (one key per player, newest 100)                                                                                                | −3/roll, −1/roll at finish                            | dice 3 → 0, finish 41 → 11; scenario 738 → 618                    | **done**                                                                                                                                                                                                                               |
| P5  | No `UPDATE` on the pending-activity read                                                                                                                              | 0 rows                                                | 0 rows                                                            | **done** (rule compliance)                                                                                                                                                                                                             |
| P6  | Write-budget test with per-operation ceilings                                                                                                                         | —                                                     | runs in CI                                                        | **done**                                                                                                                                                                                                                               |
| —   | Sender and receiver balance in one CASE `UPDATE`                                                                                                                      | —                                                     | already the case (`worker/repositories/balance-statements.ts`)    | nothing to do                                                                                                                                                                                                                          |
| —   | Journal-only writes with derived balances and periodic snapshots                                                                                                      | −1 row per wallet touched                             | —                                                                 | **rejected**: loses `CHECK (balance >= 0)` and the compare-and-set that makes every transfer all-or-nothing, and every balance read becomes a SUM over the game's ledger. The CASE update keeps conservation enforced by the database. |
| —   | Derive `games.updated_at` from events                                                                                                                                 | 0                                                     | —                                                                 | no-op: not written per event                                                                                                                                                                                                           |
| —   | Multi-tile actions as one event row                                                                                                                                   | ~2 per extra tile (~3% of a game)                     | —                                                                 | **rejected**: reversal and tile-dependency checks read `property_changes` per tile; needs a rebuild and backfill                                                                                                                       |
| —   | Partial unique index for `reverses_transaction_id`                                                                                                                    | −1/tx                                                 | —                                                                 | **deferred**: needs a `transactions` rebuild, which rewrites every row (the cost that caused this incident)                                                                                                                            |
| —   | Command ledger in Durable Object storage                                                                                                                              | −2/command more                                       | —                                                                 | **deferred**: needs a pruning policy for object storage, which changes how long a retried command replays                                                                                                                              |
| —   | Lazy `game_properties` seeding                                                                                                                                        | ~−20 per board lobby                                  | —                                                                 | **rejected**: every registry read and the `property_changes` FK would need the missing-row case                                                                                                                                        |
| —   | `db.batch()` everywhere                                                                                                                                               | 0 rows                                                | —                                                                 | stated: batching saves round trips, not rows; every money write already runs in one batch                                                                                                                                              |
| —   | Client-side statistics or activity                                                                                                                                    | 0 rows                                                | —                                                                 | nothing to save: both are derived on read today                                                                                                                                                                                        |

## Money conservation

No change touches how money moves. Every balance change is still one compare-and-set CASE update
in the same D1 batch as its transaction and participant rows. The ledger change keeps
exactly-once because the transaction id is the command id. Tests:

- `worker/game-session.ledger.sqlite.test.ts`: a real `GameSession` on SQLite. A replay writes
  nothing, a refused command writes nothing, a crash right after the commit cannot move money twice,
  and 12 concurrent transfers in both directions keep the total and every wallet equal to its ledger.
- `worker/write-budget.d1.test.ts`: after the scenario, each wallet equals its starting balance plus
  the sum of its ledger deltas.
- The existing banking, reversal, bankruptcy and repository suites pass unchanged, apart from tests
  that inspected the old recent-amounts table or the old ledger rows directly.

## Migration plan

| migration                       | change                                                                | production cost           | reverse                                                                                                               |
| ------------------------------- | --------------------------------------------------------------------- | ------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `0033_drop_unused_indexes.sql`  | `DROP INDEX IF EXISTS` × 7                                            | 0 rows written (measured) | the seven `CREATE INDEX` statements below                                                                             |
| `0034_games_recent_amounts.sql` | `ALTER TABLE games ADD COLUMN recent_amounts TEXT CHECK (json array)` | no row rewrite            | `ALTER TABLE games DROP COLUMN recent_amounts` (the old table is still there and still read while the column is NULL) |

Reverse of `0033` (each index is rebuilt once, about 1 written row per indexed row):

```sql
CREATE INDEX transactions_by_game_id_created_id ON transactions(game_id, created_at DESC, id DESC);
CREATE INDEX transaction_participants_by_player_id ON transaction_participants(player_id, transaction_id);
CREATE INDEX command_ledger_by_game_created ON command_ledger(game_id, created_at DESC);
CREATE INDEX game_properties_by_owner ON game_properties(game_id, owner_player_id);
CREATE INDEX payment_requests_recipient ON payment_requests(game_id, recipient_player_id, state, expires_at);
CREATE INDEX user_sessions_by_token_hash ON user_sessions(token_hash);
CREATE INDEX game_invitations_by_game_id ON game_invitations(game_id);
```

No backfill. A game without the column keeps reading `game_recent_amounts` until its next recorded
transfer. Dice rolls already in `dice_rolls` are read by the game object and carried over on the
player's next roll. Rolling back the Worker after deploy is safe: old code ignores the new column
and the object storage, and keeps writing the old tables. Recent amounts and dice written by the
new code would not show until the rollforward.

Follow-up once no game started before this deploy is still active: a migration that drops
`game_recent_amounts`, `dice_rolls` and the `dice_rolls_deleted_when_game_finishes` trigger.

Dice retention: `FINISH_GAME` deletes the object's `dice:` keys (Durable Object writes, not D1). A
game soft-deleted while still ACTIVE keeps them hidden, because deletion runs in the Worker. That is
at most 100 rolls per player per game. Routing the delete or the purge through the game object
would remove them, if that ever matters.

## Recommendations beyond this branch

1. **Treat table rebuilds as a budgeted operation.** One rebuild of `transactions` plus
   `transaction_participants` costs about 2 rows per stored row per table, and a failed attempt is
   billed the same as a successful one. Prefer `ADD COLUMN`, new tables, or triggers. If a rebuild
   is unavoidable, apply it once, through the deploy workflow, after a dry run on a copy of
   production with `npm run test:d1`. Never retry it in a loop.
2. Apply production migrations only through `deploy.yml`. Migrations 0028–0032 were applied at
   18:36–18:44 on 2026-10-17, outside the only deploy run that day (15:32).
3. Watch `npx wrangler d1 insights monopoly-bank --sort-by writes` after each release.

## Not verified

- **Why the rebuild statement ran 18 times.** Insights shows the count, not the failures; the
  attempts were made outside CI.
- **Local and production counts.** They matched for single statements (6 / 4 / 3 / 1). The full
  scenario was measured only locally.
- **Durable Object storage costs.** Durable Object storage has its own free quota. Dice rolls now
  write 1 object row each, and the existing `stateVersion` write is 1 per command. These were not
  measured against Cloudflare billing.
- **The production dice volume.** Finished games have no dice rows left, so the per-game figures
  exclude dice and the "with 100 dice rolls" line is an assumption.
- **Node version.** Tests ran on Node 24, not the pinned Node 22, which was not installed here.
- **Recent amounts within one second.** Old rows had second precision, so two transfers in the same
  second were ordered by amount. The new list is strictly move-to-front, which is what the client
  already shows.
