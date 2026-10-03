# Production observability, alerts, and runbooks

## Telemetry contract

The Worker writes aggregate operational events to the `monopoly_bank_operational` Analytics Engine dataset. The only dimensions are component, fixed operation name, and outcome; numeric fields are count, duration, and HTTP status. The source code forbids user identifiers, game IDs, nickname, email, avatar, invitation/reset token, financial amount, and transaction comment from this dataset.

Enable Workers Logs and traces in Cloudflare for request-level diagnosis, but retain them only in an access-controlled destination. Do not add request bodies, Cookie, Authorization, URLs containing fragments/query values, or D1 result rows to logs.

## Alert configuration

Configure these alerts in the production Cloudflare account after the staging rehearsal. Alert destinations and account IDs are intentionally not stored in this repository.

| Signal                             | Threshold                                                           | First response                                                                  |
| ---------------------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Worker 5xx rate                    | >2% for 5 minutes                                                   | Stop release, inspect version and D1 errors.                                    |
| API `unavailable` events           | >10 in 5 minutes                                                    | Check Worker/D1/DO status and rollback only Worker code if needed.              |
| D1 latency or errors               | p95 >500 ms or any sustained D1 error for 5 minutes                 | Pause nonessential traffic; do not retry mutations blindly.                     |
| WebSocket unavailable/close rate   | >5% for 5 minutes                                                   | Serve read-only/reconnect UX; verify no direct banking fallback is enabled.     |
| Auth failure surge                 | >5× baseline for 10 minutes                                         | Review rate-limit and origin-rejection aggregates; do not inspect credentials.  |
| Email provider unavailable/failure | >3 in 10 minutes                                                    | Disable nonessential email campaigns; sessions and guest play remain available. |
| PWA update failures                | update-ready events rise without update-applied events for 24 hours | Inspect service-worker cache/version and keep the current shell available.      |
| Scheduled cleanup failure          | any failure                                                         | Re-run only the idempotent cleanup after D1 health is restored.                 |

## Retention and privacy policy

| Data                                        | Retention / action                                                                                                                             |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Sessions                                    | 14-day maximum; expired records are deleted daily.                                                                                             |
| Verification/reset tokens                   | Expired immediately; consumed tokens after 7 days.                                                                                             |
| Rate-limit buckets                          | Expired buckets are deleted by scheduled cleanup.                                                                                              |
| Unused guest accounts                       | Deleted after 30 days only when they have no game membership.                                                                                  |
| Expired/revoked invitations                 | Deleted after 30 days.                                                                                                                         |
| Resolved payment requests                   | Deleted after 90 days; expired reservations are released first.                                                                                |
| Durable command replay records              | Deleted after 90 days only for finished games.                                                                                                 |
| Transactions, participants, final snapshots | Retained; they are the financial and game audit record.                                                                                        |
| Deleted accounts                            | Sessions/tokens are revoked and direct identifiers are anonymized after active games are finished or left. Game/ledger history remains intact. |

`GET /api/account/export` returns the authenticated account profile and its membership metadata only. It excludes sessions, token hashes, invitation material, transaction comments, other players' profile data, and credentials. `DELETE /api/account` is deliberately refused while the account participates in an active or lobby game.

## Incident runbooks

### D1 degradation or restore

1. Freeze releases and capture the current Worker version ID.
2. Check D1/Workers status and the aggregate `api unavailable`/cleanup metrics.
3. Do not replay banking commands with new IDs. The original command ID is the only safe retry key.
4. For corruption or accidental destructive data change, use an approved D1 point-in-time restore bookmark in an isolated recovery procedure. Restore creates a backup first; validate `PRAGMA integrity_check`, `PRAGMA foreign_key_check`, fixture counts, and a read-only game before reopening traffic.
5. Record the restored bookmark, operator, validation query results, elapsed recovery time, and data-loss window. Never paste export content into an issue or CI log.

### Durable Object / WebSocket outage

1. Mark live state reconnecting/read-only in the client; do not fall back to direct D1 banking writes.
2. Check DO invocation errors, WebSocket close rate, and Worker version. Isolate a broken socket rather than closing healthy game participants.
3. Reconnect with the existing client state version. Retry a mutation only with its original command ID after authoritative resync.
4. Confirm command-ledger uniqueness and balance/transaction reconciliation before closing the incident.

### Authentication or email outage

1. Keep existing session validation and guest lobby play available.
2. Treat email verification/reset as deferred: failed delivery discards the unsent token so a later retry can issue a new one.
3. Check provider status and aggregate email outcome metrics. Do not log recipient addresses or message contents.
4. Rotate provider credentials only through Worker secrets and test a staging delivery before resuming email sends.

### PWA update incident

1. Do not force-update a payment sheet or an active transaction confirmation.
2. Confirm the versioned shell still serves a cold offline shell only, with no authenticated payload cache.
3. Roll back the Worker/static asset version if the new service worker cannot activate; verify game and invitation deep links after recovery.

## Restore drill record

The automated staging release performs an export-to-disposable-local-D1 restore rehearsal and integrity/foreign-key/fixture checks. A real staging drill remains a release gate because this workspace has no staging credentials or safe export fixture.

| Measure                           | Current value                                                       | Status                                   |
| --------------------------------- | ------------------------------------------------------------------- | ---------------------------------------- |
| RPO target                        | ≤ 24 hours, subject to verified D1 point-in-time retention          | Target; confirm in staging/prod account. |
| RTO target                        | ≤ 60 minutes from approved incident to validated read-only recovery | Target; needs timed staging drill.       |
| Local migration recovery evidence | Empty DB and upgraded fixture pass `npm run test:d1`                | Verified.                                |
| Remote restore evidence           | Staging export → isolated restore workflow                          | Pending authorized staging run.          |
