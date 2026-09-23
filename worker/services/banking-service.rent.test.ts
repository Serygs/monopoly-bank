import { describe, expect, it } from 'vitest';
import type { PaymentRequest } from '../../shared/contracts/api.js';
import { DefaultBankingService } from './banking-service.js';
import { ada, brownOne, brownTwo, gameId, lin, makeWorld } from './property-fixtures.test-support.js';

const requestId = '00000000-0000-4000-8000-0000000000e1';
const rentRequest = (): PaymentRequest => ({ id: requestId, gameId, payerPlayerId: ada, recipientPlayerId: lin, creatorPlayerId: lin, approverPlayerId: ada, amount: 4, comment: null, state: 'PENDING', expiresAt: '2999-01-01T00:00:00.000Z', createdAt: '', resolvedAt: null, transactionId: null, boardSpaceId: brownOne });

describe('accepting a rent confirmation', () => {
  it('reprices the rent from the deed as it stands now and settles the request in the same persist call', async () => {
    // Quoted at 4 (whole brown group, undeveloped); Lin has since built two houses, so the deed now earns 30.
    const world = makeWorld({ game: { paymentMode: 'CONFIRMATION' }, properties: { [brownOne]: { ownerPlayerId: lin, houses: 2 }, [brownTwo]: { ownerPlayerId: lin, houses: 2 } }, ids: ['00000000-0000-4000-8000-0000000000c1'] });
    world.paymentRequests.set(requestId, rentRequest());
    const service = new DefaultBankingService(world.dependencies as never);

    const response = await service.acceptPaymentRequest(gameId, requestId);

    expect(world.persist).toHaveBeenCalledTimes(1);
    expect(world.dependencies.paymentRequests.settle).not.toHaveBeenCalled();
    const input = world.persist.mock.calls[0][0];
    expect(input.transaction).toMatchObject({ type: 'PROPERTY_RENT', amount: 30, participants: [{ playerId: ada, balanceDelta: -30 }, { playerId: lin, balanceDelta: 30 }] });
    expect(input.paymentRequestSettlement).toEqual({ requestId });
    expect(response.paymentRequest).toMatchObject({ state: 'ACCEPTED', transactionId: '00000000-0000-4000-8000-0000000000c1' });
    expect(response.transaction?.amount).toBe(30);
    expect(response.players.map((player) => player.balance)).toEqual([1470, 1530]);
  });

  it('refuses to settle when the deed was mortgaged after the claim, leaving the request pending', async () => {
    const world = makeWorld({ game: { paymentMode: 'CONFIRMATION' }, properties: { [brownOne]: { ownerPlayerId: lin, mortgaged: true } } });
    world.paymentRequests.set(requestId, rentRequest());
    const service = new DefaultBankingService(world.dependencies as never);
    await expect(service.acceptPaymentRequest(gameId, requestId)).rejects.toMatchObject({ code: 'PROPERTY_MORTGAGED', status: 409 });
    expect(world.persist).not.toHaveBeenCalled();
    expect(world.paymentRequests.get(requestId)?.state).toBe('PENDING');
  });

  it('still settles a plain player-to-player request through the payment request repository', async () => {
    const world = makeWorld({ game: { paymentMode: 'CONFIRMATION' } });
    world.paymentRequests.set(requestId, { ...rentRequest(), boardSpaceId: null, amount: 100 });
    world.dependencies.paymentRequests.settle.mockImplementation(async ({ transactionId }: { transactionId: string }) => { world.transactions.set(transactionId, { id: transactionId, gameId, type: 'PLAYER_TO_PLAYER', amount: 100, totalAmount: 100, comment: null, createdAt: '', participants: [] }); world.paymentRequests.set(requestId, { ...world.paymentRequests.get(requestId) as PaymentRequest, state: 'ACCEPTED', transactionId }); });
    const service = new DefaultBankingService(world.dependencies as never);
    await service.acceptPaymentRequest(gameId, requestId);
    expect(world.dependencies.paymentRequests.settle).toHaveBeenCalledTimes(1);
    expect(world.persist).not.toHaveBeenCalled();
  });
});
