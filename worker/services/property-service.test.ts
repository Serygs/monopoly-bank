import { describe, expect, it } from 'vitest';
import { DefaultPropertyService } from './property-service.js';
import { BoardRequiredError } from './errors.js';
import { ada, brownOne, brownTwo, gameId, lin, makeWorld, utility } from './property-fixtures.test-support.js';

function service(world: ReturnType<typeof makeWorld>) { return new DefaultPropertyService(world.dependencies as never); }

describe('DefaultPropertyService', () => {
  it('buys a deed at the catalogue price and persists deed, balance and PROPERTY_PURCHASE together', async () => {
    const world = makeWorld();
    const response = await service(world).purchase(gameId, { playerId: ada, boardSpaceId: brownOne });

    expect(world.persist).toHaveBeenCalledTimes(1);
    const input = world.persist.mock.calls[0][0];
    expect(input.transaction).toMatchObject({ type: 'PROPERTY_PURCHASE', amount: 60, totalAmount: 60 });
    expect(input.propertyChanges).toEqual([{ previous: { boardSpaceId: brownOne, ownerPlayerId: null, houses: 0, mortgaged: false }, change: { boardSpaceId: brownOne, ownerPlayerId: ada, houses: 0, mortgaged: false } }]);
    expect(input.buildingBankDelta).toEqual({ houses: 0, hotels: 0 });
    expect(response.transaction.type).toBe('PROPERTY_PURCHASE');
    expect(response.players.find((player) => player.id === ada)?.balance).toBe(1440);
    expect(response.properties.find((property) => property.boardSpaceId === brownOne)?.ownerPlayerId).toBe(ada);
  });

  it('replays a purchase whose transaction already exists without persisting again', async () => {
    const world = makeWorld({ ids: ['00000000-0000-4000-8000-0000000000c1', '00000000-0000-4000-8000-0000000000c1'] });
    const first = await service(world).purchase(gameId, { playerId: ada, boardSpaceId: brownOne });
    const second = await service(world).purchase(gameId, { playerId: ada, boardSpaceId: brownOne });
    expect(world.persist).toHaveBeenCalledTimes(1);
    expect(second.transaction.id).toBe(first.transaction.id);
  });

  it('refuses every operation on a game without a board', async () => {
    const world = makeWorld({ game: { boardId: null } });
    await expect(service(world).purchase(gameId, { playerId: ada, boardSpaceId: brownOne })).rejects.toBeInstanceOf(BoardRequiredError);
    await expect(service(world).state(gameId)).rejects.toMatchObject({ code: 'BOARD_REQUIRED', status: 400 });
    expect(world.persist).not.toHaveBeenCalled();
  });

  it('surfaces domain errors with their own code and status', async () => {
    const world = makeWorld({ properties: { [brownOne]: { ownerPlayerId: lin } } });
    await expect(service(world).purchase(gameId, { playerId: ada, boardSpaceId: brownOne })).rejects.toMatchObject({ code: 'PROPERTY_ALREADY_OWNED', status: 409 });
    await expect(service(world).build(gameId, { playerId: lin, boardSpaceId: brownOne, count: 1 })).rejects.toMatchObject({ code: 'INCOMPLETE_COLOR_GROUP', status: 409 });
    await expect(service(world).purchase(gameId, { playerId: ada, boardSpaceId: 'board-classic-space-99' })).rejects.toMatchObject({ code: 'PROPERTY_NOT_FOUND', status: 404 });
    expect(world.persist).not.toHaveBeenCalled();
  });

  it('commits FAST rent immediately as PROPERTY_RENT between payer and owner', async () => {
    const world = makeWorld({ properties: { [brownOne]: { ownerPlayerId: lin } } });
    const response = await service(world).chargeRent(gameId, { payerPlayerId: ada, boardSpaceId: brownOne, chargedByOwner: true });
    expect('transaction' in response && response.transaction.type).toBe('PROPERTY_RENT');
    expect(world.persist.mock.calls[0][0].transaction.participants).toEqual([{ playerId: ada, balanceDelta: -2 }, { playerId: lin, balanceDelta: 2 }]);
    expect(world.persist.mock.calls[0][0].propertyChanges).toEqual([]);
  });

  it('turns an owner-raised CONFIRMATION rent into a payment request pinned to the deed with the payer as approver', async () => {
    const world = makeWorld({ game: { paymentMode: 'CONFIRMATION' }, properties: { [brownOne]: { ownerPlayerId: lin }, [brownTwo]: { ownerPlayerId: lin } } });
    const response = await service(world).chargeRent(gameId, { payerPlayerId: ada, boardSpaceId: brownOne, chargedByOwner: true });
    expect(world.persist).not.toHaveBeenCalled();
    expect('paymentRequests' in response).toBe(true);
    if (!('paymentRequests' in response)) throw new Error('expected a payment request');
    expect(response.paymentRequests[0]).toMatchObject({ id: '00000000-0000-4000-8000-0000000000c1', boardSpaceId: brownOne, payerPlayerId: ada, recipientPlayerId: lin, creatorPlayerId: lin, approverPlayerId: ada, amount: 4, state: 'PENDING', expiresAt: '2026-06-01T12:05:00.000Z' });
  });

  it('commits CONFIRMATION rent at once when the payer initiates it', async () => {
    const world = makeWorld({ game: { paymentMode: 'CONFIRMATION' }, properties: { [brownOne]: { ownerPlayerId: lin } } });
    const response = await service(world).chargeRent(gameId, { payerPlayerId: ada, boardSpaceId: brownOne });
    expect(world.persist).toHaveBeenCalledTimes(1);
    expect('transaction' in response).toBe(true);
  });

  it('prices utility rent from the payer\'s last recorded roll when the request carries no dice total', async () => {
    const world = makeWorld({ properties: { [utility]: { ownerPlayerId: lin } }, players: { ada: { lastRollTotal: 7 } } });
    await service(world).chargeRent(gameId, { payerPlayerId: ada, boardSpaceId: utility });
    expect(world.persist.mock.calls[0][0].transaction.amount).toBe(28);
    const noRoll = makeWorld({ properties: { [utility]: { ownerPlayerId: lin } } });
    await expect(service(noRoll).chargeRent(gameId, { payerPlayerId: ada, boardSpaceId: utility })).rejects.toMatchObject({ code: 'DICE_TOTAL_REQUIRED', status: 400 });
  });

  it('builds on a whole group and returns houses to the bank when selling', async () => {
    const world = makeWorld({ properties: { [brownOne]: { ownerPlayerId: ada }, [brownTwo]: { ownerPlayerId: ada } } });
    const built = await service(world).build(gameId, { playerId: ada, boardSpaceId: brownOne, count: 1 });
    expect(built.transaction).toMatchObject({ type: 'PROPERTY_BUILD', amount: 50, totalAmount: 50 });
    expect(built.buildingBank).toEqual({ housesAvailable: 31, hotelsAvailable: 12 });
    const sold = await service(world).sellBuildings(gameId, { playerId: ada, boardSpaceId: brownOne, count: 1 });
    expect(sold.transaction).toMatchObject({ type: 'PROPERTY_SELL_BUILDINGS', amount: 25 });
    expect(sold.buildingBank).toEqual({ housesAvailable: 32, hotelsAvailable: 12 });
    expect(world.persist.mock.calls[1][0].propertyChanges?.[0].previous.houses).toBe(1);
  });

  it('mortgages and redeems a deed with the board interest', async () => {
    const world = makeWorld({ properties: { [brownOne]: { ownerPlayerId: ada } } });
    const mortgaged = await service(world).mortgage(gameId, { playerId: ada, boardSpaceId: brownOne });
    expect(mortgaged.transaction).toMatchObject({ type: 'PROPERTY_MORTGAGE', amount: 30 });
    expect(mortgaged.properties.find((property) => property.boardSpaceId === brownOne)?.mortgaged).toBe(true);
    const redeemed = await service(world).unmortgage(gameId, { playerId: ada, boardSpaceId: brownOne });
    expect(redeemed.transaction).toMatchObject({ type: 'PROPERTY_UNMORTGAGE', amount: 33 });
    await expect(service(world).unmortgage(gameId, { playerId: ada, boardSpaceId: brownOne })).rejects.toMatchObject({ code: 'PROPERTY_NOT_MORTGAGED' });
  });

  it('records an auction of a free deed at a price the catalogue does not bound as one PROPERTY_AUCTION persist', async () => {
    const world = makeWorld();
    const response = await service(world).recordAuction(gameId, { winnerPlayerId: lin, boardSpaceId: brownOne, price: 410 });
    expect(world.persist).toHaveBeenCalledTimes(1);
    const input = world.persist.mock.calls[0][0];
    expect(input.transaction).toMatchObject({ type: 'PROPERTY_AUCTION', amount: 410, totalAmount: 410, participants: [{ playerId: lin, balanceDelta: -410 }] });
    expect(input.propertyChanges).toEqual([{ previous: { boardSpaceId: brownOne, ownerPlayerId: null, houses: 0, mortgaged: false }, change: { boardSpaceId: brownOne, ownerPlayerId: lin, houses: 0, mortgaged: false } }]);
    expect(response.transaction.type).toBe('PROPERTY_AUCTION');
    expect(response.players.find((player) => player.id === lin)?.balance).toBe(1090);
    expect(response.properties.find((property) => property.boardSpaceId === brownOne)?.ownerPlayerId).toBe(lin);
  });

  it('refuses to auction a deed somebody already holds without writing anything', async () => {
    const world = makeWorld({ properties: { [brownOne]: { ownerPlayerId: ada } } });
    await expect(service(world).recordAuction(gameId, { winnerPlayerId: lin, boardSpaceId: brownOne, price: 10 })).rejects.toMatchObject({ code: 'PROPERTY_ALREADY_OWNED' });
    expect(world.persist).not.toHaveBeenCalled();
  });

  it('pays bail from the board fee and clears the jail flag in the same persist call', async () => {
    const world = makeWorld({ players: { ada: { isInJail: true } } });
    const response = await service(world).payJailBail(gameId, { playerId: ada });
    expect(response.transaction).toMatchObject({ type: 'JAIL_BAIL', amount: 50 });
    expect(world.persist.mock.calls[0][0].jailChange).toEqual({ playerId: ada, isInJail: false });
    expect(response.players.find((player) => player.id === ada)).toMatchObject({ balance: 1450, isInJail: false });
  });

  it('rejects bail for a player who is not in jail without writing anything', async () => {
    const world = makeWorld();
    await expect(service(world).payJailBail(gameId, { playerId: ada })).rejects.toMatchObject({ code: 'PLAYER_NOT_IN_JAIL' });
    expect(world.persist).not.toHaveBeenCalled();
  });

  it('records a roll and sends the third consecutive double to jail without touching the ledger', async () => {
    const world = makeWorld({ players: { ada: { consecutiveDoubles: 2 } } });
    const response = await service(world).recordDiceRoll(gameId, { playerId: ada, first: 3, second: 3 });
    expect(response.thirdDouble).toBe(true);
    expect(world.dependencies.players.updateGameplayState).toHaveBeenCalledWith(ada, { lastRollTotal: 6, lastRollAt: '2026-06-01T12:00:00.000Z', consecutiveDoubles: 0, isInJail: true });
    expect(response.player).toMatchObject({ id: ada, isInJail: true, lastRollTotal: 6 });
    expect(world.persist).not.toHaveBeenCalled();
  });

  it('records a plain roll and resets the doubles streak', async () => {
    const world = makeWorld({ players: { ada: { consecutiveDoubles: 1 } } });
    const response = await service(world).recordDiceRoll(gameId, { playerId: ada, first: 2, second: 5 });
    expect(response.thirdDouble).toBe(false);
    expect(world.dependencies.players.updateGameplayState).toHaveBeenCalledWith(ada, { lastRollTotal: 7, lastRollAt: '2026-06-01T12:00:00.000Z', consecutiveDoubles: 0 });
  });

  it('resolves the stored owner of a space for the rent route', async () => {
    const world = makeWorld({ properties: { [brownOne]: { ownerPlayerId: lin } } });
    await expect(service(world).ownerOf(gameId, brownOne)).resolves.toBe(lin);
    await expect(service(world).ownerOf(gameId, brownTwo)).resolves.toBeNull();
  });
});
