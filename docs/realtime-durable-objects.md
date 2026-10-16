# Real-time Durable Objects

The `GAME_SESSIONS` Durable Object binding is declared in `wrangler.jsonc`. `GameSession` uses Cloudflare's WebSocket Hibernation API and one deterministic object name per game ID. D1 remains the durable source for game data, history, and statistics.

Run these commands from the repository root; replace the environment name only if you deploy a named Wrangler environment.

```sh
# 1. Apply all pending D1 migrations to the production database.
npx wrangler d1 migrations apply monopoly-bank --remote

# 2. Apply the Durable Object class migration and Worker configuration.
#    Wrangler applies the configured `v1` new_sqlite_classes migration on deploy.
npm run build
npx wrangler deploy

# 3. For normal subsequent Worker/application deployments.
npm run deploy
```

For local development, `npm run setup` applies the migrations to the local D1 database before `npm run dev`; the equivalent manual command is `npx wrangler d1 migrations apply monopoly-bank --local`.

Do not manually create a second Durable Object class migration with the same `v1` tag. Any future class rename or deletion needs a new Wrangler migration tag.

The full release procedure, including the isolated development and staging environments, is in [deployment](deployment.md).

## Auctions (rule `auctions`)

An auction is settled by the game's Durable Object, never by a client.

- `START_AUCTION` stores `{ gameId, auctionId, endsAt }` under the `auctionDeadline` key and sets the Durable Object alarm to `endsAt` (the server sets it 30 seconds after the start; a bid moves it to at least 10 seconds after the bid and re-arms the alarm).
- `alarm()` settles the auction. The same settlement also runs lazily at the start of every mutation, whenever a snapshot is built (connect) and on `GET /api/games/:id/auction`, so a missed or late alarm cannot leave an auction stuck. A snapshot also re-arms an ACTIVE auction whose deadline is missing from storage. Settlements are single-flight per object.
- Settlement uses the system command ID `auction-settle:<auctionId>` (actor `system`) in the command ledger. The D1 write is idempotent and guarded (the sale's balance change, its `AUCTION_PAYMENT` transaction and the auction row are one batch that rolls back if the auction is no longer ACTIVE at the version read), so a concurrent settlement writes nothing. After the write the object bumps `stateVersion` once, completes the ledger entry, broadcasts `AUCTION_UPDATED` and, for a sale, `GAME_COMMITTED` with the same version, then clears the deadline and the alarm. A failing alarm throws so the platform retries.
- `START_AUCTION` and `PLACE_BID` are ordinary commands (command-ID idempotency, version bump) that broadcast `AUCTION_UPDATED { stateVersion, auction }`. A bankruptcy of the leading bidder withdraws the bid in its own batch and also broadcasts `AUCTION_UPDATED`.
- REST: `GET /api/games/:id/auction` (polling fallback, `AuctionResponse`), `POST /api/games/:id/auctions` (`StartAuctionRequest`, 201) and `POST /api/games/:id/auctions/:auctionId/bids` (`PlaceBidRequest` without `auctionId`, 200) all go through the game object. Auctions need the live gateway.

### Ordering guarantee

Every mutation (including its lazy auction settlement) and every alarm/lazy settlement runs through one FIFO promise-chain queue inside the game object, so two commands never overlap even though each awaits D1. A failing task does not block the queue, and a duplicate command ID returns the same in-flight promise. This is what keeps the auction reserve check (read, then write) from going stale between a debit and a bid; D1 compare-and-set guards remain as the last line of defence (the bid statement also subtracts the bidder's pending payment requests). The settlement transaction gets a server-generated random id, so no client command ID can occupy it, and the `auction-settle:<auctionId>` ledger key cannot collide with a client command (those must be UUID v4). If the deadline is missing from object storage (a crash between the D1 insert and the storage write), the first command, read or snapshot after a wake finds the running auction in D1 and arms it from `ends_at`.
