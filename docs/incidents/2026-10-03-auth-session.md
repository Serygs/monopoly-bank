# Authentication incident, 3 October 2026

## Evidence and limits

The supplied Workers Logs export contains 208 events from 16:19 to 16:39 UTC
(19:19–19:39 in Kyiv). It contains no account identifiers or login request
bodies, and cookie values are redacted. Requests cannot be conclusively assigned
to a named account. Production D1 was inspected read-only after the incident.

| Kyiv time         | Observation                                                                                        |
| ----------------- | -------------------------------------------------------------------------------------------------- |
| 19:21:33          | An iPhone request to the game's live endpoint returns `UNAUTHORIZED`; the Cookie header is absent. |
| 19:21:35 onward   | Transactions and profile checks from that browser also lack cookies and return `UNAUTHORIZED`.     |
| 19:21:51–19:35:44 | 16 login failures report `INVALID_CREDENTIALS`.                                                    |
| 19:25:11          | A different profile request has a cookie but returns `UNAUTHORIZED`.                               |
| 19:25:14          | One login succeeds.                                                                                |
| 19:26:44          | Another live request has a cookie but returns `UNAUTHORIZED`.                                      |

There are 12 missing-cookie authentication failures and two failures with a
cookie present. No `429`, rate-limit rejection, or `5xx` is present in the export.
The stored rate-limit count of 10 therefore does not establish rate limiting as
the cause of the observed login failures.

The older Bsenkiv player record was created on 19 September at 19:21:24 Kyiv
time. The first missing-cookie failure occurs almost exactly 14 days later.
The previous code issued a cookie and D1 session with a fixed 14-day lifetime
and never renewed them. Browser cookie expiry is consequently the leading
explanation, but the original session row is no longer available to verify its
exact expiry. The original account is also no longer linked to those player
records; the currently stored `bsenkiv` account was created on 3 October at
19:45:32, after the exported window.

Previously `INVALID_CREDENTIALS` covered three branches: account not found,
guest account, and password mismatch. The export cannot distinguish them.
Deleting sessions cannot repair these branches; changing a hash and salt cannot
repair a missing nickname match or turn a guest into a registered account.
Nickname lookup was case-sensitive. Password verification still requires the
matching PBKDF2/SHA-256 hash and salt with the configured 100,000 iterations.

## Corrected behavior

- Active HTTP sessions renew their D1 expiry and cookie after at least one day,
  giving an inactivity lease of approximately 14 days. Expired or revoked
  sessions are never revived. Concurrent renewals cannot shorten the lease.
- A successful login creates a new session without deleting other devices'
  sessions. Explicit revoke-all, password reset, guest upgrade and account
  deletion retain their existing revocation behavior.
- Exact nickname identity is preserved. A unique registered account can be
  found through an ASCII case-insensitive fallback; ambiguous matches fail.
- Per-account/source login allowances prevent one player on shared Wi-Fi from
  consuming another player's small allowance; a separate source cap remains.
  This corrects a separate reliability issue, not an observed `429` incident.
- The client treats only confirmed `UNAUTHORIZED` profile responses as requiring
  sign-in. Temporary errors offer retry. Browser resume/connectivity restoration
  rechecks the session, and successful sign-in retains the current game route.
- Authentication logs record fixed rejection reasons and request IDs without
  nicknames, passwords, salt, hash, or cookie values. API responses use `no-store`.

## Verification

Regression coverage includes concurrent logins, failed session issuance,
logout/revoke-all, expiry, renewal and revocation races, SQLite cleanup and
monotonic expiry, nickname ambiguity, shared-source rate limits, temporary
profile errors, renewal response headers and EN/UK credential messages.

The old account/session cannot be reconstructed from this export. These changes
require deployment before production behavior changes.
