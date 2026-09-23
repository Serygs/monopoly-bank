# API errors and request correlation

Every API response includes `X-Request-ID`. Error responses use one contract: `{ "error": { "code", "message", "requestId", "details?" } }`. Codes are stable machine identifiers (for example `VALIDATION_ERROR`, `UNAUTHORIZED`, `INSUFFICIENT_FUNDS`, `GAME_FINISHED`, and `INTERNAL_ERROR`); the HTTP status carries the error category. `details` is present only for safe, structured information such as an invalid field or a required balance.

The same request ID is included in structured Worker logs. Client responses never include stacks, D1/SQL diagnostics, credentials, cookies, or other internals. For a 5xx, use the request ID to find the server-side log, where the original cause chain is retained and sensitive fields are redacted.

## Error classes

The Worker raises errors through the `AppError` hierarchy in `worker/services/errors.ts`. Each class fixes the HTTP status and, unless noted, the code. Messages are written to be safe for clients; internal errors additionally set `expose: false`, so the client sees only `Internal server error.`

| HTTP status | Code                                                     | Raised when                                                                                                                                                                                                  |
| ----------- | -------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 400         | `VALIDATION_ERROR`                                       | Request input failed validation. `details` may name the offending field.                                                                                                                                     |
| 401         | `UNAUTHORIZED`                                           | The route requires an authenticated session.                                                                                                                                                                 |
| 401         | `INVALID_CREDENTIALS`                                    | Nickname or password did not match.                                                                                                                                                                          |
| 401         | `INVALID_GAME_PASSWORD`                                  | The game password supplied on join is wrong.                                                                                                                                                                 |
| 403         | `FORBIDDEN`                                              | The actor is authenticated but not allowed to perform the operation.                                                                                                                                         |
| 403         | `GAME_NOT_MEMBER`                                        | The actor is not a member of the game. The response deliberately does not disclose whether the game exists.                                                                                                  |
| 403         | `GAME_OWNER_REQUIRED`                                    | The operation is reserved for the game owner.                                                                                                                                                                |
| 404         | `NOT_FOUND`, `<RESOURCE>_NOT_FOUND`, `INVALID_JOIN_CODE` | The resource does not exist. Resource-specific variants such as `PAYMENT_REQUEST_NOT_FOUND` follow the same shape.                                                                                           |
| 409         | `CONFLICT` and domain codes                              | The request conflicts with current state. Domain services pass their own codes, for example `INVALID_GAME_STATE`, `LOBBY_CLOSED`, `INVITATION_NOT_ACTIVE`, `STATISTICS_UNAVAILABLE` and `DUPLICATE_COMMAND`. |
| 429         | `RATE_LIMITED`                                           | A rate-limit bucket is exhausted.                                                                                                                                                                            |
| 503         | `EMAIL_DELIVERY_UNAVAILABLE`                             | The transactional email provider failed. The unsent token is discarded so a later retry can issue a new one.                                                                                                 |
| 500         | `DATABASE_ERROR`                                         | A D1 operation failed. Not exposed; the operation name stays in the server log.                                                                                                                              |
| 500         | `REALTIME_ERROR`                                         | The Durable Object or WebSocket path failed. Not exposed.                                                                                                                                                    |
| 500         | `INTERNAL_ERROR`                                         | Any other unexpected failure, including persistence consistency violations. Not exposed.                                                                                                                     |

Banking rules in `shared/domain/banking.ts` and the `GameSession` Durable Object contribute further stable codes that reach the client through the same envelope, among them `INSUFFICIENT_FUNDS`, `GAME_FINISHED`, `INVALID_AMOUNT`, `PLAYER_BANKRUPT`, `PLAYER_NOT_FOUND` and `SAME_SOURCE_AND_DESTINATION`. The live WebSocket protocol reuses these codes in its error events; see `shared/contracts/live.ts`.

## Rules for adding a code

- Codes are part of the API contract. Add a new one only when the client has to react differently; otherwise reuse an existing class.
- Keep `message` free of user data, identifiers, SQL text and provider responses.
- Put structured, non-sensitive facts in `details` (a field name, a required balance). Never put credentials, cookies, or other players' data there.
- Map the code to the HTTP status of its category. A 5xx must set `expose: false`.
