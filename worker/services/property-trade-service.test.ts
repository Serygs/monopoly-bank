import { describe, expect, it, vi } from 'vitest';
import type { PropertyTrade } from '../../shared/contracts/api.js';
import type { CreatePropertyTradeInput } from '../repositories/property-trade-repository.js';
import { DefaultPropertyTradeService } from './property-trade-service.js';
import { ada, brownOne, brownTwo, gameId, lin, makeWorld, railroad } from './property-fixtures.test-support.js';

const tradeId = '00000000-0000-4000-8000-0000000000d1';

function tradeRepository(seed: PropertyTrade[] = []) {
  const trades = new Map(seed.map((trade) => [trade.id, trade]));
  return {
    trades,
    create: vi.fn(async (input: CreatePropertyTradeInput) => { trades.set(input.trade.id, { ...input.trade, items: [...input.items], createdAt: '2026-06-01T12:00:00.000Z', resolvedAt: null, transactionId: null }); }),
    getById: async (_gameId: string, id: string) => trades.get(id) ?? null,
    listByGameId: async () => [...trades.values()],
    expirePending: vi.fn(async () => { for (const [id, trade] of trades) if (trade.state === 'PENDING' && trade.expiresAt <= '2026-06-01T12:00:00.000Z') trades.set(id, { ...trade, state: 'EXPIRED' }); }),
    resolve: vi.fn(async (_gameId: string, id: string, state: 'DECLINED' | 'CANCELLED') => { const trade = trades.get(id); if (trade === undefined || trade.state !== 'PENDING') return false; trades.set(id, { ...trade, state }); return true; }),
  };
}

function service(world: ReturnType<typeof makeWorld>, trades: ReturnType<typeof tradeRepository>) {
  // The fake persist marks the trade accepted the way the settlement statement does in D1.
  world.settleTrade = (id, transactionId) => { const trade = trades.trades.get(id); if (trade !== undefined) trades.trades.set(id, { ...trade, state: 'ACCEPTED', transactionId }); };
  return new DefaultPropertyTradeService({ ...world.dependencies, trades } as never);
}

const pending = (overrides: Partial<PropertyTrade> = {}): PropertyTrade => ({ id: tradeId, gameId, proposerPlayerId: ada, responderPlayerId: lin, cashFromProposer: 100, cashFromResponder: 0, items: [{ boardSpaceId: brownOne, fromPlayerId: ada, mortgageResolution: null }], state: 'PENDING', expiresAt: '2999-01-01T00:00:00.000Z', createdAt: '', resolvedAt: null, transactionId: null, ...overrides });

describe('DefaultPropertyTradeService', () => {
  it('validates a proposal against the current slice and stores the trade with its items', async () => {
    const world = makeWorld({ properties: { [brownOne]: { ownerPlayerId: ada }, [railroad]: { ownerPlayerId: lin, mortgaged: true } }, ids: [tradeId] });
    const trades = tradeRepository();
    const response = await service(world, trades).propose(gameId, { proposerPlayerId: ada, responderPlayerId: lin, cashFromProposer: 100, propertiesFromProposer: [{ boardSpaceId: brownOne }], propertiesFromResponder: [{ boardSpaceId: railroad, mortgageResolution: 'REDEEM' }] });

    expect(trades.create).toHaveBeenCalledTimes(1);
    expect(trades.create.mock.calls[0][0]).toEqual({
      trade: { id: tradeId, gameId, proposerPlayerId: ada, responderPlayerId: lin, cashFromProposer: 100, cashFromResponder: 0, state: 'PENDING', expiresAt: '2026-06-02T12:00:00.000Z' },
      items: [{ boardSpaceId: brownOne, fromPlayerId: ada, mortgageResolution: null }, { boardSpaceId: railroad, fromPlayerId: lin, mortgageResolution: 'REDEEM' }],
      boardId: 'board-classic',
    });
    expect(response.trade.state).toBe('PENDING');
    expect(response.transaction).toBeUndefined();
    expect(world.persist).not.toHaveBeenCalled();
  });

  it('refuses a deed the proposer does not own, a mortgaged deed without a resolution and a deed carrying buildings', async () => {
    const world = makeWorld({ properties: { [brownOne]: { ownerPlayerId: ada, houses: 1 }, [brownTwo]: { ownerPlayerId: ada, houses: 1 }, [railroad]: { ownerPlayerId: lin, mortgaged: true } } });
    const trades = tradeRepository();
    const trade = service(world, trades);
    await expect(trade.propose(gameId, { proposerPlayerId: ada, responderPlayerId: lin, propertiesFromProposer: [{ boardSpaceId: railroad }] })).rejects.toMatchObject({ code: 'TRADE_PROPERTY_NOT_OWNED', status: 409 });
    await expect(trade.propose(gameId, { proposerPlayerId: ada, responderPlayerId: lin, propertiesFromResponder: [{ boardSpaceId: railroad }] })).rejects.toMatchObject({ code: 'MORTGAGE_RESOLUTION_REQUIRED', status: 400 });
    await expect(trade.propose(gameId, { proposerPlayerId: ada, responderPlayerId: lin, propertiesFromProposer: [{ boardSpaceId: brownOne }] })).rejects.toMatchObject({ code: 'BUILDINGS_PRESENT', status: 409, details: { colorGroup: 'BROWN' } });
    await expect(trade.propose(gameId, { proposerPlayerId: ada, responderPlayerId: lin })).rejects.toMatchObject({ code: 'TRADE_EMPTY', status: 400 });
    expect(trades.create).not.toHaveBeenCalled();
  });

  it('accepts a pending trade, applies it through the domain and settles it in the same persist call', async () => {
    const world = makeWorld({ properties: { [brownOne]: { ownerPlayerId: ada } }, ids: ['00000000-0000-4000-8000-0000000000c9'] });
    const trades = tradeRepository([pending()]);
    const response = await service(world, trades).accept(gameId, tradeId);

    expect(world.persist).toHaveBeenCalledTimes(1);
    const input = world.persist.mock.calls[0][0];
    expect(input.transaction).toMatchObject({ type: 'PROPERTY_TRADE', amount: 100, participants: [{ playerId: ada, balanceDelta: -100 }, { playerId: lin, balanceDelta: 100 }] });
    expect(input.propertyChanges).toEqual([{ previous: { boardSpaceId: brownOne, ownerPlayerId: ada, houses: 0, mortgaged: false }, change: { boardSpaceId: brownOne, ownerPlayerId: lin, houses: 0, mortgaged: false } }]);
    expect(input.tradeSettlement).toEqual({ tradeId });
    expect(response.trade).toMatchObject({ state: 'ACCEPTED', transactionId: '00000000-0000-4000-8000-0000000000c9' });
    expect(response.transaction?.type).toBe('PROPERTY_TRADE');
    expect(response.properties?.find((property) => property.boardSpaceId === brownOne)?.ownerPlayerId).toBe(lin);
    expect(response.players.map((player) => player.balance)).toEqual([1400, 1600]);
  });

  it('refuses to accept when a deed moved since the offer and writes nothing', async () => {
    const world = makeWorld({ properties: { [brownOne]: { ownerPlayerId: ada, mortgaged: true } } });
    const trades = tradeRepository([pending()]);
    await expect(service(world, trades).accept(gameId, tradeId)).rejects.toMatchObject({ code: 'TRADE_STATE_CHANGED', status: 409 });
    const sold = makeWorld({ properties: { [brownOne]: { ownerPlayerId: lin } } });
    await expect(service(sold, tradeRepository([pending()])).accept(gameId, tradeId)).rejects.toMatchObject({ code: 'TRADE_STATE_CHANGED', status: 409 });
    expect(world.persist).not.toHaveBeenCalled();
    expect(sold.persist).not.toHaveBeenCalled();
  });

  it('reads an overdue offer as EXPIRED and does not accept it', async () => {
    const world = makeWorld({ properties: { [brownOne]: { ownerPlayerId: ada } } });
    const trades = tradeRepository([pending({ expiresAt: '2026-01-01T00:00:00.000Z' })]);
    const trade = service(world, trades);
    await expect(trade.get(gameId, tradeId)).resolves.toMatchObject({ state: 'EXPIRED' });
    await expect(trade.accept(gameId, tradeId)).rejects.toMatchObject({ code: 'TRADE_NOT_PENDING', status: 409, details: { state: 'EXPIRED' } });
    expect(world.persist).not.toHaveBeenCalled();
  });

  it('declines, cancels and lists trades; a repeated accept replays the settled trade', async () => {
    const world = makeWorld({ properties: { [brownOne]: { ownerPlayerId: ada } }, ids: ['00000000-0000-4000-8000-0000000000c9', '00000000-0000-4000-8000-0000000000c9'] });
    const trades = tradeRepository([pending(), pending({ id: '00000000-0000-4000-8000-0000000000d2', items: [] }), pending({ id: '00000000-0000-4000-8000-0000000000d3', items: [] })]);
    const trade = service(world, trades);
    await expect(trade.decline(gameId, '00000000-0000-4000-8000-0000000000d2')).resolves.toMatchObject({ trade: { state: 'DECLINED' } });
    await expect(trade.cancel(gameId, '00000000-0000-4000-8000-0000000000d3')).resolves.toMatchObject({ trade: { state: 'CANCELLED' } });
    const accepted = await trade.accept(gameId, tradeId);
    const replay = await trade.accept(gameId, tradeId);
    expect(world.persist).toHaveBeenCalledTimes(1);
    expect(replay.transaction?.id).toBe(accepted.transaction?.id);
    await expect(trade.list(gameId)).resolves.toHaveLength(3);
    await expect(trade.accept(gameId, '00000000-0000-4000-8000-0000000000ff')).rejects.toMatchObject({ code: 'TRADE_NOT_FOUND', status: 404 });
  });
});
