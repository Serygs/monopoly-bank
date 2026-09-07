# Monopoly Bank security threat model

## Assets and trust boundaries

| Asset | Boundary | Primary controls |
| --- | --- | --- |
| Registered and guest sessions | Browser cookie ↔ Worker | Secure, HttpOnly, SameSite=Lax cookies; origin and Fetch-Metadata checks; expiry and rotation |
| Verification, reset, and invitation tokens | Email/QR/browser ↔ Worker | Opaque random values, hashed at rest, short expiry, fragment URLs, no token logging |
| Wallet control and payment approval | Actor ↔ API ↔ Durable Object ↔ D1 | Membership and controller checks immediately before command execution; durable command ledger |
| Balances and ledger | Durable Object ↔ D1 | Atomic repository writes, idempotency command IDs, authoritative snapshots |
| Live game state | Browser WebSocket ↔ Durable Object | Authenticated connect, same-origin upgrade, validated protocol, versioned snapshots |

## Threats and decisions

| Threat | Risk | Mitigation | Residual risk |
| --- | --- | --- | --- |
| Cross-site cookie mutation | Payment, invitation or profile change | Reject cross-origin unsafe requests and cross-site Fetch-Metadata; cookies remain SameSite=Lax | Non-browser API clients must use a same-origin deployment gateway |
| Session theft/fixation | Account takeover | Opaque hashed sessions, Secure/HttpOnly, rotation at login and guest upgrade, revoke-all, expiry cleanup | A compromised browser remains in scope until revocation |
| Account enumeration/reset abuse | Email harvesting and email flooding | Generic reset response, per-address rate limit bucket, token hashing and expiry | Email provider remains an external dependency |
| Invitation leakage | Unwanted lobby access | Fragment invitation URLs, `no-referrer`, CSP, opaque hashed tokens, expiry/revocation | A recipient can intentionally forward an invite |
| Owner changing another wallet | Financial integrity failure | Actor controller check in router and again in the per-game Durable Object immediately before write | Existing D1 permissions must remain service-only |
| Replay/race in approval or payment | Duplicate ledger entry | Durable command ledger, per-game coordinator, idempotent command IDs and atomic D1 operations | Recovery may require authoritative snapshot after delivery failure |
| WebSocket hijacking | Read state or presence disclosure | Member authorization and exact Origin check before upgrade | Same-origin XSS is mitigated separately by CSP, not eliminated |
| Log disclosure | Tokens, PII, comments, amounts | Structured security events contain category/requestId/gameId only; request payloads are never logged | Provider-side logs require operational retention controls |

## Authorization matrix

| Endpoint family | Anonymous | Member | Owner | Controller of target wallet |
| --- | --- | --- | --- | --- |
| Auth register/login/reset | Allowed, rate limited | Allowed | Allowed | N/A |
| Join by invitation | Allowed, rate limited | Allowed | Allowed | N/A |
| Game/read/activity | Denied | Allowed | Allowed | Own controlled wallet history only |
| Create/approve/cancel payment | Denied | Denied | Not sufficient | Required |
| Finish/start/delete/invitations | Denied | Denied | Required | N/A |
| Live socket | Denied | Allowed | Allowed | N/A |

## Operational follow-up

- Run expiry cleanup on a scheduled Worker invocation before production launch; the migration also keeps all read paths expiry-safe.
- Set `APP_ORIGIN`, email provider secrets, and a production custom domain before deployment.
- Review Cloudflare access logs and email-provider retention independently; application security events intentionally omit PII and financial payloads.
