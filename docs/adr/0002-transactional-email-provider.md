# ADR 0002: transactional email provider

## Status

Accepted.

## Context

Account verification and password recovery need a transactional email channel
from a Cloudflare Worker. The application must not persist raw credentials or
provider tokens, and provider-specific code must not leak into authentication
rules.

## Decision

Use a small `TransactionalEmailProvider` interface and an initial Resend HTTP
adapter. The adapter uses the Worker Fetch API directly, sends a provider
idempotency key per auth token, and reads `RESEND_API_KEY` and
`RESEND_FROM_EMAIL` only from Worker secrets. No email SDK dependency is added.

## Alternatives considered

- **Resend HTTP API** — selected: small HTTPS surface, direct Worker support,
  and idempotency support.
- **Cloudflare Email Routing** — rejected: it receives mail but is not a
  transactional outbound-email service.
- **Provider SDK** — rejected: adds runtime dependency and Worker compatibility
  surface without value over one authenticated HTTP request.

## Consequences

An adapter can be replaced without changing account, token, or route logic.
Before deployment, set `RESEND_API_KEY` and `RESEND_FROM_EMAIL` with
`wrangler secret put`; verify the sender domain with the provider. A failed
email send does not expose provider details to the client.
