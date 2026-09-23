# Production test pyramid

`npm test` is the fast unit, domain, route, and Durable Object contract layer.
`npm run test:d1` applies every migration to a fresh local D1 database and checks
the database constraints that protect balances, command idempotency, the seeded
board catalogue and property ownership.

## Local browser run (`npm run test:e2e:local`)

Between the D1 layer and the staging browser suite sits a local browser run that
needs no staging deployment, no transactional email and no environment variable.
`scripts/e2e-local.mjs` builds the client and Worker with Vite, applies every
migration to a D1 in a temporary directory, starts `wrangler dev --local` from the
built configuration on a free loopback port, runs the Playwright `local` project
(`e2e/property.spec.ts`, one worker, no retries) against it, then stops Wrangler
and deletes the temporary directory. `wrangler.jsonc` is only read; the remote
databases are never touched. Install the browser once with
`npx playwright install chromium`; arguments after `--` go to Playwright:

```bash
npm run test:e2e:local
npm run test:e2e:local -- --grep "custom copy"
npm run test:e2e:local -- --update-snapshots
```

It covers what only a real browser against the real Worker can prove: the owner
registers with a nickname and password, a second player joins as a guest through
an invitation created over the API, and every table action goes through the UI in
two browser contexts. Scenarios: the classic board in FAST mode (purchase, rent
paid by the other player, auction, building, selling buildings, mortgage and
redemption with the on-screen figures compared to the ledger); a trade accepted
in the other player's browser with both panels updating live; three doubles
through the roll button, the jail badge and bail; the owner's rent bill in
CONFIRMATION mode; a renamed custom copy of the classic board with classic prices
and a refused deletion while a game uses it; a game without a board (no property
element, a local dice roll, working payments and a reference screenshot); and a
reconnect from a fresh context that must see the same deeds and capital. Every
scenario switches the UI to Ukrainian at least once and checks a deed name and an
action.

It does not cover what the staging suite owns: HTTPS-only behaviour (the lobby
invitation dialog, clipboard), transactional email and guest upgrade, QR joins by
six devices, the visual matrix and load. Scenarios marked `test.fixme` document an
open defect and are skipped until it is fixed; the reason sits in the comment
above each one.

The board-less game page has one reference screenshot,
`e2e/property.spec.ts-snapshots/board-less-game-local-darwin.png`, taken at
1280×900 with reduced motion and the owner's nickname masked. Playwright names the
file per platform, so a runner on another OS needs its own baseline: run
`npm run test:e2e:local -- --update-snapshots`, review the new image, and commit
it. Refresh the same way after an intentional change to the game page.

## Staging browser suite

Browser integration against a deployment is deliberately opt-in and must target an
isolated HTTPS staging deployment with configured transactional email:

```bash
E2E_BASE_URL=https://monopoly-bank-staging.example E2E_RUN=true npm run test:e2e
```

It uses six independent browser contexts for invitation/guest join, verifies a
local secondary wallet, guest-to-account upgrade, FAST retry idempotency,
CONFIRMATION flow, finish/statistics, reconnect, and keyboard focus. The same
suite uses deterministic API interception for non-mutating visual coverage of
Saved Games, Profile, Create Game, Join Game, Game, Operations, Statistics, and
Settings at 320, 390, 430, 768, 1024, 1280, and 1440 CSS pixels. It covers EN/UK,
Classic Bank light/dark modes, reduced motion, long names, large balances,
scrolling dialogs, and focus restoration according to the
[UI design system](./ui-design-system.md). Screenshots are diagnostic Playwright
report attachments, not design baselines. Install the browser once per runner with
`npx playwright install --with-deps chromium`. The register, lobby, guest-join and
ledger helpers shared by both browser layers live in `e2e/helpers.ts`.

## Load

The load runner is also opt-in. It never uses production credentials: provide a
private scenario created in an isolated staging database, then run it for 30–60
minutes.

```bash
LOAD_TEST_SCENARIO=./.private/load-scenario.json LOAD_TEST_DURATION_MINUTES=30 npm run test:load
```

For the release-candidate 2x peak gate, use a separate 60-game scenario:

```bash
LOAD_TEST_SCENARIO=./.private/load-scenario-2x.json LOAD_TEST_GAME_COUNT=60 LOAD_TEST_DURATION_MINUTES=60 npm run test:load
```

The private JSON is intentionally not part of the repository. It contains a
`baseUrl` and exactly 30 (or 60 for 2x peak) games, each with six `{ cookie, playerId }` participant
entries. Cookies are test sessions only. The runner opens 180 authenticated
or 360 authenticated sockets respectively, sends idempotent FAST bank payments with a unique command ID, then
audits every game for an HTTP failure or a negative balance. A pass is evidence
of zero observed negative-balance violations; ledger duplicate checks remain
covered deterministically by the Durable Object test suite and D1 unique
constraint test.
