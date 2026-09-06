# Production test pyramid

`npm test` is the fast unit, domain, route, and Durable Object contract layer.
`npm run test:d1` applies every migration to a fresh local D1 database and checks
the database constraints that protect balances and command idempotency.

Browser integration is deliberately opt-in and must target an isolated HTTPS
staging deployment with configured transactional email:

```bash
E2E_BASE_URL=https://monopoly-bank-staging.example E2E_RUN=true npm run test:e2e
```

It uses six independent browser contexts for invitation/guest join, verifies a
local secondary wallet, guest-to-account upgrade, FAST retry idempotency,
CONFIRMATION flow, finish/statistics, reconnect, keyboard focus, and captures
the EN/UK × 320/390/768/1280 × light/dark × reduced-motion visual matrix as
Playwright report attachments. Install the browser once per runner with
`npx playwright install --with-deps chromium`.

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
