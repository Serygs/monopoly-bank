# Release readiness report

> **Archived.** This is a frozen assessment dated 2026-09-06, retained for history. It is not a description of the current system. For the live release procedure and environment isolation rules see [deployment](../deployment.md).

**Assessment date:** 2026-09-06  
**Scope:** release controls and local evidence only. No staging or production deployment was performed.

## Evidence collected

| Control                  | Evidence                                                                                                                                                                                 | Result                                           |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| Empty-database schema    | `npm run test:d1` applies all migrations to isolated local D1 and asserts financial constraints and foreign keys.                                                                        | Pass                                             |
| Upgrade path             | The same command creates a fixture at migration `0015`, then applies `0016` and later migrations and verifies identity preservation and foreign keys.                                    | Pass                                             |
| Application quality      | `npm test`                                                                                                                                                                               | 39 files / 137 tests passed                      |
| Static validation        | `npm run lint`                                                                                                                                                                           | Pass with 2 pre-existing generated-type warnings |
| Production build         | `npm run build`                                                                                                                                                                          | Pass                                             |
| Staging isolation        | Generated config with an injected non-production D1 UUID passed `npm run check:bindings`.                                                                                                | Pass                                             |
| Deployment configuration | `wrangler deploy --dry-run --config dist/monopoly_bank/wrangler.staging.json` reported only `GAME_SESSIONS`, `MONOPOLY_BANK_DB`, and `ENVIRONMENT=staging`; it exited before deployment. | Pass                                             |

The D1 migration runner is the authoritative verification for migration ordering: D1 records applied files in its migration table and applies them in filename order. See [Cloudflare D1 migrations](https://developers.cloudflare.com/d1/reference/migrations/).

## Release gates still required

1. Configure the isolated GitHub `staging` environment and Worker secrets described in [deployment](../deployment.md) (formerly `docs/release-readiness.md`).
2. Execute one manual **Staging release**. Its backup export is restored only into disposable local D1; verify the job log shows successful integrity, foreign-key, and fixture checks.
3. Run the staged browser and realtime load suites against that staging URL and attach their results to the release approval.
4. Have an authorized reviewer approve the GitHub `production` environment. Provide the production HTTPS URL only at manual dispatch time.
5. Record the prior Worker version before production approval, confirm D1 backup/time-travel availability, and verify every pending migration follows expand → compatible code → backfill → contract.

## Decision

**Not yet approved for production.** The codebase has local release controls and an isolated staging path, but production readiness requires a successful real staging rehearsal and explicit production approval. This report deliberately contains no production database IDs, tokens, invitation URLs, financial data, or customer identifiers.
