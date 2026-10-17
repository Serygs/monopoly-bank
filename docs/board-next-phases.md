# Board registry: remaining phases (handoff)

Read `AGENTS.md`, `CLAUDE.md` (Board games bullet) and `docs/ui-design-system.md` (by `##` heading) first.
Skip `npm run test:visual` (decision of 2026-10-17). Checks per PR: `npm run lint`, `npm run typecheck`, `npm test`, and `npm run test:d1` whenever a migration changes. Commit headers must be 100 characters or fewer (commitlint). Node 22.

## Where things stand

| PR  | Content                                                                                                                     | State                                               |
| --- | --------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| #57 | Preset, snapshot (`Game.settings.board`), `game_properties`, read-only Property tab                                         | merged                                              |
| #58 | Buy / mortgage / redeem / auction by tile, automatic rent, registry diffs (`property_changes`)                              | merged                                              |
| A   | #58 cleanup, `priceOverride`, auction settles as `PROPERTY_PURCHASE`, reversible board mortgage / redeem (migration `0030`) | PR open, branch `feat/board-purchase-reversibility` |

PR A is done; start PR B from `main` after it is merged (or from `feat/board-purchase-reversibility` if it is not). Migration `0029_property_actions.sql` already allows the transaction types `PROPERTY_BUILD`, `PROPERTY_SELL_BUILDING`, `PROPERTY_TRADE` (reserved, never written). Next migration number: `0031`.

Leftovers from the #58 review were fixed in PR A (kept for reference):

- A rent payment on a tile whose rent was doubled by a full colour group does not block reversing the purchase of another tile of that group.
- Missing tests: guarded `UPDATE game_properties` with a stale before-state rolling everything back in SQLite; service paths `BOARD_DISABLED`, `TILE_REQUIRED`, `PROPERTY_IN_AUCTION`, `PROPERTY_CHANGED` on reversal; tile auction start on an owned tile and a tile auction that ends `NO_SALE`.

## Decisions (final, from the product owner)

1. **Mortgage / redeem become reversible for board games** (registry-backed). Same reversal rules as everything else: actor only (owner may reverse any), within `REVERSAL_WINDOW_MS`, refused while a dependent later operation exists (building after redeem, trade of that tile, auction), balances must still be valid. Remove the "neither can be reversed" rule for registry-backed games only; free-text mortgages in legacy / "no board" games stay non-reversible. Update `isReversibleType` / `nonReversibleTypes` in `shared/domain/reversal.ts` (make it depend on `tileId`, e.g. a `reversibleTransaction(tx)` helper) and the CLAUDE.md Mortgages bullet.
2. **Zero-price trades are allowed** (gifts, swaps). New transaction type `PROPERTY_TRANSFER` with `amount >= 0`; relax the amount CHECKs for that type only. No fake amounts. See the migration notes below.
3. **Mortgaged tile in a trade or bankruptcy:** the receiver pays 10% of the mortgage value to the bank immediately (`redemptionCost(mortgageValue) - mortgageValue`, same rounding as redeem). The tile stays mortgaged; a later redeem costs mortgage x 1.1 as usual. Trades: validate the receiver's cash before confirming. Bankruptcy to a player: charge the creditor; if short, the creditor goes through the existing settlement flow (mortgage / sell, see the `settleLoan` and `sellBuildingsToBank` patterns in `BankingDialog` and `WalletsSection`). Bankruptcy to the bank: tiles return unowned and unmortgaged (the active mortgage rows are released, as today).
4. **Bankruptcy with buildings:** sell every building back to the bank at 50% of house cost (`floor(houseCost * board.rules.sellBuildingRefund)` per building, a hotel counts as 4 houses plus 1 house cost, i.e. 5 buildings) before the transfer. The proceeds go into the bankrupt wallet and so count toward the creditor's claim; in a bank bankruptcy they are simply part of the wallet that leaves the game. Everything is ONE operation with ONE registry diff per tile so it reverts atomically (keep `BANKRUPTCY_TRANSFER` non-reversible as today, so "reverts atomically" means one diff set, not a new reversal path).
5. **Purchase:** `PROPERTY_PURCHASE` at the snapshot list price, with an optional `priceOverride` (positive integer) that needs an extra confirmation and is logged as overridden (store a flag, e.g. a nullable `price_override` / `overridden` column on `transactions`, shown in the ledger). It replaces manual amount entry. When an auction winner pays for a board tile, settle with a `PROPERTY_PURCHASE` (source `auction`, price = winning bid) instead of `AUCTION_PAYMENT`. `AUCTION_PAYMENT` stays for free-text lots and historical games.
6. Bank house/hotel supply (32/12): not modelled.
7. Custom board: out of scope. The stepper only offers "No board" and "Monopoly RU 2012" (already the case; keep the Custom option hidden, not disabled).

## PR A - cleanup of #58 + purchase / reversibility rework (decisions 1, 5)

Files: `shared/domain/reversal.ts` (+test), `shared/domain/banking.ts` (`propertyPurchase`, `reverseTransaction`, mortgage / redeem reversal), `worker/services/banking-service.ts`, `worker/services/auction-service.ts` + `shared/domain/auction.ts` (settle as `PROPERTY_PURCHASE`), `worker/repositories/banking-operation-repository.ts`, `worker/validation/api-validation.ts`, `shared/contracts/api.ts` (`PropertyPurchaseTransactionRequest.priceOverride?: number`), `src/pages/game/BankingDialog.tsx` (override confirmation), `src/utils/transaction-history.ts`, `src/components/game/TransactionRow.tsx`, i18n EN + UK.

Notes:

- Migration `0030` (small): add the override flag to `transactions` (ALTER TABLE ADD COLUMN, no rebuild needed) and, if the auction settle changes the stored type, nothing else. Do not edit 0029.
- Reversing a registry-backed mortgage or redemption needs the mortgage row restored / re-activated: `mortgages.state` goes back (ACTIVE <-> REDEEMED) in the reversal batch, and `findReversalDependency` must treat a later redeem of the same mortgage, a building, a trade or an auction on that tile as blocking (already keyed on `tileId` via `registryTypes`; add the new types there).
- Statistics: `PROPERTY_PURCHASE` from an auction counts as paid to the bank; an overridden purchase is flagged only in the ledger.
- Fix the two #58 leftovers listed above and add the missing tests.

## PR B - building (decision 4 groundwork)

Contract to add in `shared/contracts/api.ts` (and to the `CreateTransactionRequest` union):

```ts
export interface PropertyBuildTransactionRequest extends Omit<TransactionRequestBase, 'comment'> {
  type: 'PROPERTY_BUILD';
  playerId: string;
  tileId: string;
}
export interface PropertySellBuildingTransactionRequest extends Omit<
  TransactionRequestBase,
  'comment'
> {
  type: 'PROPERTY_SELL_BUILDING';
  playerId: string;
  tileId: string;
}
```

Rules (all values from the game snapshot `board`, never the preset):

- Build: the player owns the street, holds the full colour group (`holdsFullGroup`), no tile of the group is mortgaged, tile `houses < 5`, even building (the tile's houses equal the group minimum, so the max difference stays 1). Cost = `houseCost` paid to the bank; the 5th building is the hotel and costs one `houseCost`. Debit respects the auction reserve and funds checks like every other debit.
- Sell: owner, `houses > 0`, even selling (tile houses equal the group maximum). Refund = `floor(houseCost * board.rules.sellBuildingRefund)` from the bank; hotel (5) goes to 4 houses.
- `shared/domain/property.ts`: add `canBuild` / `canSellBuilding` (boolean, `(board, registry, tileId, playerId)`) plus asserting variants throwing `AppError` subclasses with distinct codes (`BUILD_REQUIRES_FULL_GROUP`, `BUILD_UNEVEN`, `BUILD_MORTGAGED_GROUP`, `NO_BUILDINGS`, `MAX_BUILDINGS`). Mortgage already refuses buildings in the group.
- Mirror `propertyPurchase` / `payRent` end to end: domain function in `shared/domain/banking.ts`, handler in `banking-service.ts`, validation (`readTileId`), registry diff stored in `property_changes` in the same batch, no new migration (types exist since 0029).
- Both are reversible (registry-backed). Add them to `registryTypes` in `reversal.ts`; a later build or sell on the same colour group should also block (needs group lookup: the Worker has the board, the Activity ledger only has what it loaded, so keep the client check conservative and let the Worker be authoritative).
- Statistics: like a bank payment / bank payout.
- UI: extend `TileIntent` / `tileIntents` in `src/utils/property-view.ts` with `PROPERTY_BUILD` and `PROPERTY_SELL_BUILDING` (offered only when `canBuild` / `canSellBuilding`), labels in `PropertyScreen` `intentLabelKeys`, review / confirm in `BankingDialog` like `PROPERTY_PURCHASE`, history text in `game-page-helpers.ts` and `TransactionRow.tsx`, EN + UK strings.
- Tests: even-building matrix, full-group requirement, mortgaged tile in group, hotel replaces 4, refund rounding, insufficient funds writes nothing, reversal of both, validation, legacy game rejection (`BOARD_DISABLED`).

## PR C - trades (decisions 2, 3)

Migration `0030`/`0031` (check numbering against PR A): rebuild `transactions` (copy the 0029 pattern exactly, including the backup / participants tables and all four indexes) to:

- add type `PROPERTY_TRANSFER` (drop the never-written `PROPERTY_TRADE`; confirm with a grep that nothing writes it);
- relax `amount > 0` and `total_amount > 0` to `>= 0` only when `type = 'PROPERTY_TRANSFER'` (e.g. `CHECK (amount > 0 OR (type = 'PROPERTY_TRANSFER' AND amount = 0))`), same for `total_amount`.

Watch out: `transaction_participants.balance_delta` has `CHECK (balance_delta <> 0)`, so a zero-money gift has no participant rows and would disappear from "Mine" history, reversal initiator lookup (`reversalInitiatorPlayerId`) and statistics. Decide in the PR: either relax that CHECK for transfers too (a participant row with delta 0 so both players appear), or add a `transaction_players` link. Prefer the participant row with delta 0 (relax the CHECK only when the parent type is `PROPERTY_TRANSFER`, which needs a trigger or dropping the CHECK and enforcing in the domain; pick the simpler and add a constraint test in `migrations/NNNN_*.test.ts`). Hidden from "moved funds" and "biggest operation" statistics when amount is 0.

Flow: a trade offer is a pending request the counterparty accepts (reuse the payment-request pattern in `worker/services/payment-request-service.ts`, a new kind, or an owner-confirmed direct action if simpler; decide and document). One atomic batch: validate ownership of every offered tile, no buildings in the colour groups of traded tiles (classic rule; ask the user if unsure), cash each way, the 10% mortgage fee from the receiver to the bank for each mortgaged tile received, the `PROPERTY_TRANSFER` transaction, registry diffs. The tile stays mortgaged and the `mortgages` row moves to the new owner (as bankruptcy does today). Validate the receiver's cash (including the fee) before confirming.

Reversal: allowed under the common rules (decision 1 generalised): actor, window, no dependent later operation on any traded tile, funds still valid. A trade that carried a fee is reversed by restoring the exact deltas.

UI: trade entry from the Property tab (tile sheet "Trade") and the wallet menu Property group: pick counterparty, tiles on both sides, optional cash each way, review screen with the fee line. Reuse `TilePicker`, glass sheets, `PlayerPicker`.

Tests: swap, gift (0 money), cash-plus-tile, mortgaged tile with fee, receiver short of cash, building in group refused, stale registry rolls back, reversal and blocked reversal, statistics skip zero-money transfers, legacy game rejection.

## PR D - bankruptcy with asset transfer (decisions 3, 4)

Today `bankruptcyRegistryChanges` (`shared/domain/banking.ts`) only moves every tile of the bankrupt player to the creditor (or the bank). Extend inside `declareBankruptcy` so it is one operation:

1. Sell all buildings back to the bank (50% refund, hotel = 5 buildings), refunds go into the bankrupt wallet before the transfer (so they count toward the creditor's claim); buildings set to 0 in the diff.
2. Player creditor: tiles transfer; each mortgaged tile costs the creditor the 10% fee, charged to the creditor in the same batch. If the creditor cannot pay, reject before any write with a code that sends the UI into the existing settlement flow (same idea as `settleLoan`), then retry.
3. Bank creditor: tiles become unowned, unmortgaged, houses 0; the active mortgages are released (existing behavior).
4. One registry diff per tile (before = original state, after = final state).

UI: `BankruptcyDialog.tsx` lists the tiles that pass on, the buildings sold and the proceeds, the fees, and the creditor's shortfall hint. Tests: buildings sold and proceeds, hotel refund, mortgaged tile fee, creditor short, bank creditor release, atomic rollback, auction reserve interaction, the existing bankruptcy suites stay green.

## Housekeeping after each PR

- Update the Board games bullet in `CLAUDE.md` (and the `AGENTS.md` registry sentence if the scope changes), `docs/security-threat-model.md` (who may do what) and `docs/api-errors.md` for new error codes.
- `i18n-auditor` after UI changes, `invariant-reviewer` before opening the PR, then `gh pr create` against `main` with the attribution line used in earlier PRs.
- Data still to verify by the product owner against the physical cards: Рублівське шосе and Ростовська наб. rent rows, GO reward 2,000,000 ("М200м" on the board), tile positions.
