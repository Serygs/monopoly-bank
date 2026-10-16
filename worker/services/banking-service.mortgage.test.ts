import { describe, expect, it, vi } from 'vitest';
import { MortgageNotFoundError } from '../../shared/domain/banking.js';
import type { Game, Mortgage, Player } from '../../shared/types/monopoly.js';
import { defaultGameRules } from '../../shared/types/monopoly.js';
import { DefaultBankingService } from './banking-service.js';
import { ConflictError, DatabaseError } from './errors.js';

const playerId = '11111111-1111-4111-8111-111111111111';
const otherId = '22222222-2222-4222-8222-222222222222';
const mortgageId = '33333333-3333-4333-8333-333333333333';

const game: Game = {
  id: 'game',
  name: 'Table',
  startingBalance: 1500,
  passGoReward: 200,
  currency: 'K',
  paymentMode: 'FAST',
  rules: defaultGameRules,
  settings: null,
  status: 'ACTIVE',
  createdAt: '',
  updatedAt: '',
};

const player = (id: string, balance: number): Player => ({
  id,
  gameId: 'game',
  name: id,
  color: '#000',
  balance,
  status: 'ACTIVE',
  createdAt: '',
});

const boardwalk: Mortgage = {
  id: mortgageId,
  gameId: 'game',
  playerId,
  propertyName: 'Boardwalk',
  mortgageValue: 400,
  createdAt: '',
};

function service(options: { active?: Mortgage[]; balance?: number; persistError?: Error }) {
  let persistedType: string | null = null;
  const persist = vi.fn(async (input: unknown) => {
    if (options.persistError !== undefined) throw options.persistError;
    persistedType = (input as { transaction: { type: string } }).transaction.type;
  });
  const listActive = vi.fn(async () => options.active ?? []);
  const banking = new DefaultBankingService({
    games: { getById: async () => game } as never,
    players: {
      listByGameId: async () => [player(playerId, options.balance ?? 1000), player(otherId, 1000)],
    } as never,
    transactions: {
      getById: async (_gameId: string, id: string) =>
        persistedType !== null && id === 'command-id' ? { id, type: persistedType } : null,
    } as never,
    operations: { persist } as never,
    paymentRequests: {} as never,
    mortgages: {
      listActive,
      getActive: async (_gameId: string, id: string) =>
        (options.active ?? []).find((item) => item.id === id) ?? null,
    } as never,
    createId: () => 'command-id',
  });
  return { banking, persist, listActive };
}

const persistedInput = (persist: ReturnType<typeof service>['persist']) =>
  persist.mock.calls[0]![0] as {
    transaction: {
      type: string;
      comment: string;
      newMortgage?: unknown;
      redeemedMortgageId?: string;
    };
    balanceChanges: { balanceAfter: number }[];
    recentAmount?: number;
  };

describe('mortgaging a property', () => {
  const request = {
    type: 'MORTGAGE' as const,
    playerId,
    propertyName: ' Park  Place ',
    amount: 350,
  };

  it('pays the bank amount, stores the mortgage and returns the active list', async () => {
    const { banking, persist, listActive } = service({});
    const response = await banking.createTransaction('game', request);

    const input = persistedInput(persist);
    expect(input.transaction).toMatchObject({
      type: 'MORTGAGE',
      comment: 'Park Place',
      newMortgage: { playerId, propertyName: 'Park Place', mortgageValue: 350 },
    });
    expect(input.balanceChanges.map((change) => change.balanceAfter)).toEqual([1350]);
    // The mortgage list is not a "recent amount" the table reuses.
    expect(input.recentAmount).toBeUndefined();
    expect(listActive).toHaveBeenCalled();
    expect(response).toHaveProperty('mortgages');
  });

  it('refuses a property the player already has mortgaged, ignoring case, without writing', async () => {
    const { banking, persist } = service({ active: [boardwalk] });
    const error = await banking
      .createTransaction('game', { ...request, propertyName: 'BOARDWALK' })
      .catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ConflictError);
    expect(error).toMatchObject({ code: 'MORTGAGE_ALREADY_ACTIVE' });
    expect(persist).not.toHaveBeenCalled();
  });

  it('lets another player mortgage a property with the same name', async () => {
    const { banking, persist } = service({ active: [{ ...boardwalk, playerId: otherId }] });
    await banking.createTransaction('game', { ...request, propertyName: 'Boardwalk' });
    expect(persist).toHaveBeenCalledOnce();
  });

  it('turns the loser of a race on the unique name into "already mortgaged"', async () => {
    let calls = 0;
    const racing = service({
      persistError: new DatabaseError({ operation: 'persist', cause: new Error('UNIQUE') }),
    });
    racing.listActive.mockImplementation(async () => (calls++ === 0 ? [] : [boardwalk]));
    await expect(
      racing.banking.createTransaction('game', { ...request, propertyName: 'Boardwalk' }),
    ).rejects.toMatchObject({ code: 'MORTGAGE_ALREADY_ACTIVE' });
  });
});

describe('redeeming a mortgage', () => {
  const request = { type: 'MORTGAGE_REDEMPTION' as const, playerId, mortgageId };

  it('charges the value plus 10% and closes that mortgage in the same write', async () => {
    const { banking, persist } = service({ active: [boardwalk] });
    await banking.createTransaction('game', request);

    const input = persistedInput(persist);
    expect(input.transaction).toMatchObject({
      type: 'MORTGAGE_REDEMPTION',
      comment: 'Boardwalk',
      redeemedMortgageId: mortgageId,
    });
    expect(input.balanceChanges.map((change) => change.balanceAfter)).toEqual([560]);
  });

  it('reports a mortgage that is missing or already redeemed without writing', async () => {
    const { banking, persist } = service({ active: [] });
    await expect(banking.createTransaction('game', request)).rejects.toBeInstanceOf(
      MortgageNotFoundError,
    );
    expect(persist).not.toHaveBeenCalled();
  });

  it("refuses to redeem another player's mortgage without writing", async () => {
    const { banking, persist } = service({ active: [{ ...boardwalk, playerId: otherId }] });
    await expect(banking.createTransaction('game', request)).rejects.toBeInstanceOf(
      MortgageNotFoundError,
    );
    expect(persist).not.toHaveBeenCalled();
  });

  it('refuses the redemption when the player cannot afford it, without writing', async () => {
    const { banking, persist } = service({ active: [boardwalk], balance: 100 });
    await expect(banking.createTransaction('game', request)).rejects.toMatchObject({
      code: 'INSUFFICIENT_FUNDS',
    });
    expect(persist).not.toHaveBeenCalled();
  });
});

describe('other operations', () => {
  it('do not load the mortgage list', async () => {
    const { banking, listActive } = service({});
    await banking.createTransaction('game', {
      type: 'PLAYER_TO_BANK',
      playerId,
      amount: 10,
    });
    expect(listActive).not.toHaveBeenCalled();
  });
});

describe('bankruptcy and mortgages', () => {
  function bankruptcyService(active: Mortgage[]) {
    let stored = false;
    const persist = vi.fn(async (_input: unknown) => {
      stored = true;
    });
    const banking = new DefaultBankingService({
      games: { getById: async () => game } as never,
      players: {
        listByGameId: async () => [player(playerId, 100), player(otherId, 1000)],
      } as never,
      transactions: {
        getById: async (_gameId: string, id: string) =>
          stored ? { id, type: 'BANKRUPTCY_TRANSFER' } : null,
      } as never,
      operations: { persist } as never,
      paymentRequests: {} as never,
      mortgages: { listActive: async () => active, getActive: async () => null } as never,
      createId: () => 'command-id',
    });
    return { banking, persist };
  }

  it('passes the creditor on as the heir of the mortgages and returns the new list', async () => {
    const afterwards = [{ ...boardwalk, playerId: otherId }];
    const { banking, persist } = bankruptcyService(afterwards);

    const response = await banking.declareBankruptcy('game', {
      playerId,
      creditorPlayerId: otherId,
    });

    expect(persist).toHaveBeenCalledWith(
      expect.objectContaining({ bankruptPlayerId: playerId, mortgageHeirPlayerId: otherId }),
    );
    expect(response.mortgages).toEqual(afterwards);
  });

  it('has no heir when the player goes bankrupt to the bank', async () => {
    const { banking, persist } = bankruptcyService([]);

    const response = await banking.declareBankruptcy('game', { playerId });

    expect(persist).toHaveBeenCalledWith(
      expect.objectContaining({ bankruptPlayerId: playerId, mortgageHeirPlayerId: null }),
    );
    expect(response.mortgages).toEqual([]);
  });
});
