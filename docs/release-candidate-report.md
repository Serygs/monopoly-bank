# Release candidate report — 2026-09-06

## Decision: NO-GO

No production deployment was attempted. The local release artifact is valid, but
the required isolated staging evidence has not been produced. Production is not
eligible until every blocking item below is closed and independently reviewed.

## Evidence collected

| Gate | Result | Evidence |
| --- | --- | --- |
| Unit, domain, route, and Durable Object tests | PASS | `npm test`: 39 files, 138 tests passed. |
| Focused Worker integration | PASS | `npm run test:worker`: 2 files, 32 tests passed. |
| D1 migrations and constraints | PASS | `npm run test:d1`: clean database and upgraded production-like fixture completed successfully. |
| Local restore rehearsal | PASS | `npm run test:restore` against `scripts/fixtures/restore-rehearsal.sql` restored into disposable local D1; foreign keys, schema, and fixture lookup passed. |
| Lint | PASS WITH WARNINGS | `npm run lint`: zero errors; two pre-existing, generated `worker-configuration.d.ts` unused-disable warnings. |
| Production build | PASS | `npm run build`: Worker and client production artifacts built successfully. |
| Production binding validation | PASS | Generated config matches the approved Worker name, D1 ID/name, and Durable Object binding. |
| Deployment dry-run | PASS | `npx wrangler deploy --dry-run`: artifact assembled; no Worker or D1 changes made. |
| Security regression suite | PARTIAL | Covered by the 138 local tests; a deployed-origin security/header check remains pending staging. |
| Playwright six-device, visual, keyboard, and accessibility matrix | NOT RUN | `npm run test:e2e` discovered 35 tests and skipped all because isolated staging URL and test data were absent. |
| Staging migration dry-run and real migration application | NOT RUN | No staging D1 name or Cloudflare staging credentials were available. |
| 2x peak soak | NOT RUN | No private 60-game staging scenario or isolated staging endpoint was available. |

The load runner now accepts only explicit, bounded levels: 30 games (peak) or
60 games (2x peak). The 2x scenario opens 360 sockets and must run for 30–60
minutes. It must report zero HTTP mutation failures, zero negative balance
violations, and no duplicate/lost ledger operations in the post-run audit.

## Blocking risks and required evidence

1. Run the **Staging release** workflow with an isolated HTTPS Worker, D1
   database, required Worker secrets, and a non-sensitive fixture game ID.
   Preserve its output for binding validation, backup/restore, migration, and
   smoke evidence.
2. Run **Staging browser quality** against that deployment. Review all 35
   Playwright cases and the attached EN/UK × 320/390/768/1280 × light/dark ×
   reduced-motion captures; record keyboard and screen-reader audit findings.
3. Supply a private 60-game / 360-session staging scenario and run the 2x peak
   soak for 60 minutes. Retain aggregate server metrics and a ledger
   reconciliation query result; never retain test cookies in source control.
4. Validate post-deploy security headers, authenticated origin/CSRF behavior,
   WebSocket Origin rejection, email-provider failure behavior, and D1
   migration state in staging.
5. Configure and test alert delivery for Worker/D1, Durable Object/WebSocket,
   authentication, email, cleanup, and PWA update metrics. The binding exists,
   but alert destinations are account configuration and cannot be evidenced from
   this repository.

## Rollback procedure

1. Freeze further releases and retain request IDs, Worker version ID, D1
   migration list, and aggregate operational metrics.
2. If the failure is Worker-only, select the recorded previous Worker version
   with `wrangler rollback` (or Cloudflare dashboard rollback), then rerun HTTPS
   smoke checks. This does not alter D1.
3. Never reverse an applied D1 migration. Use forward-compatible remediation
   first. Use D1 point-in-time recovery only through the approved incident
   procedure and after confirming the recovery point and data-loss scope.
4. Keep writes disabled or return retryable errors if Durable Object/WebSocket
   coordination is unhealthy; do not bypass the authoritative command path.
5. Reconcile ledger operations and non-negative balance invariants before
   reopening the service.

## Post-deploy checklist (after explicit approval)

- Record deployed Worker version and timestamp before and after release.
- Confirm `wrangler d1 migrations list MONOPOLY_BANK_DB --remote` has the
  expected applied migration state.
- Run `npm run smoke:deployment` against the approved HTTPS production URL.
- Verify CSP, HSTS, frame, content-type, and referrer headers at the edge.
- Exercise login, guest join, invitation deep link, one FAST payment, one
  CONFIRMATION payment, reconnect, and PWA update/reload using non-production
  test accounts only where possible.
- Confirm analytics has only aggregate dimensions and alert routes receive a
  controlled test alert; do not inspect PII or financial comments.
- Check Worker errors, D1 failures, Durable Object/WebSocket close/reconnect
  rates, email-provider availability, and PWA update events for at least the
  agreed observation window.
