import { describe, expect, it } from 'vitest';
import type { Loan } from '../../../shared/types/monopoly';
import { players } from '../../test/game-page-fixtures';
import { previewBalances } from './game-page-helpers';

describe('previewBalances for every request type', () => {
  const deltas = (previews: ReturnType<typeof previewBalances>) =>
    previews.map((entry) => entry.delta);
  const afters = (previews: ReturnType<typeof previewBalances>) =>
    previews.map((entry) => entry.after);

  it('keeps the player and reports the balance after the change', () => {
    const preview = previewBalances(
      { type: 'PLAYER_TO_PLAYER', sourcePlayerId: 'p1', destinationPlayerId: 'p2', amount: 30 },
      players,
      200,
    );
    expect(preview.map((entry) => entry.player)).toEqual(players);
    expect(afters(preview)).toEqual([970, 530, 100]);
  });

  it('charges a bank payment to one wallet and a bank income to one wallet', () => {
    expect(
      deltas(previewBalances({ type: 'PLAYER_TO_BANK', playerId: 'p2', amount: 30 }, players, 200)),
    ).toEqual([0, -30, 0]);
    expect(
      deltas(previewBalances({ type: 'BANK_TO_PLAYER', playerId: 'p2', amount: 30 }, players, 200)),
    ).toEqual([0, 30, 0]);
    expect(
      deltas(previewBalances({ type: 'TO_JACKPOT', playerId: 'p3', amount: 30 }, players, 200)),
    ).toEqual([0, 0, -30]);
  });

  it('pays out the whole pot to the collector', () => {
    expect(
      deltas(
        previewBalances(
          { type: 'JACKPOT_PAYOUT', playerId: 'p2', expectedAmount: 90 },
          players,
          200,
          0,
          [],
          0,
          90,
        ),
      ),
    ).toEqual([0, 90, 0]);
  });

  it('charges everyone or one player in the all-player payments', () => {
    expect(
      deltas(
        previewBalances(
          { type: 'PLAYER_TO_ALL', payerPlayerId: 'p1', amountPerPlayer: 20 },
          players,
          200,
        ),
      ),
    ).toEqual([-40, 20, 20]);
    expect(
      deltas(
        previewBalances(
          { type: 'ALL_TO_PLAYER', recipientPlayerId: 'p1', amountPerPlayer: 20 },
          players,
          200,
        ),
      ),
    ).toEqual([40, -20, -20]);
  });

  it('pays the Pass GO reward given, not the game default', () => {
    expect(deltas(previewBalances({ type: 'PASS_GO', playerId: 'p3' }, players, 400))).toEqual([
      0, 0, 400,
    ]);
  });

  it('pays a mortgage the typed amount, or the tile value for a board mortgage', () => {
    expect(
      deltas(
        previewBalances(
          { type: 'MORTGAGE', playerId: 'p1', propertyName: 'X', amount: 70 },
          players,
          200,
        ),
      ),
    ).toEqual([70, 0, 0]);
    expect(
      deltas(
        previewBalances(
          { type: 'MORTGAGE', playerId: 'p1', tileId: 'zhitna' },
          players,
          200,
          0,
          [],
          0,
          0,
          { amount: 300 },
        ),
      ),
    ).toEqual([300, 0, 0]);
  });

  it('charges a purchase and a build the tile amount and pays a sale', () => {
    const tile = { amount: 250 };
    for (const type of ['PROPERTY_PURCHASE', 'PROPERTY_BUILD'] as const)
      expect(
        deltas(
          previewBalances(
            { type, playerId: 'p2', tileId: 'zhitna' },
            players,
            200,
            0,
            [],
            0,
            0,
            tile,
          ),
        ),
      ).toEqual([0, -250, 0]);
    expect(
      deltas(
        previewBalances(
          { type: 'PROPERTY_SELL_BUILDING', playerId: 'p2', tileId: 'zhitna' },
          players,
          200,
          0,
          [],
          0,
          0,
          tile,
        ),
      ),
    ).toEqual([0, 250, 0]);
  });

  it('moves rent from the payer to the owner, and charges only the payer when the owner is unknown', () => {
    const request = { type: 'PAY_RENT', payerPlayerId: 'p1', tileId: 'zhitna' } as const;
    expect(
      deltas(
        previewBalances(request, players, 200, 0, [], 0, 0, { amount: 60, ownerPlayerId: 'p3' }),
      ),
    ).toEqual([-60, 0, 60]);
    expect(deltas(previewBalances(request, players, 200, 0, [], 0, 0, { amount: 60 }))).toEqual([
      -60, 0, 0,
    ]);
    expect(
      deltas(
        previewBalances(request, players, 200, 0, [], 0, 0, { amount: 60, ownerPlayerId: null }),
      ),
    ).toEqual([-60, 0, 0]);
  });

  it('charges a redemption the cost given', () => {
    expect(
      deltas(
        previewBalances(
          { type: 'MORTGAGE_REDEMPTION', playerId: 'p1', mortgageId: 'm' },
          players,
          200,
          330,
        ),
      ),
    ).toEqual([-330, 0, 0]);
  });

  it('moves no money for a player loan request and pays a bank loan at once', () => {
    expect(
      deltas(
        previewBalances(
          { type: 'LOAN_ISSUE', borrowerPlayerId: 'p1', lenderPlayerId: 'p2', amount: 90 },
          players,
          200,
        ),
      ),
    ).toEqual([0, 0, 0]);
    expect(
      deltas(
        previewBalances(
          { type: 'LOAN_ISSUE', lenderKind: 'BANK', playerId: 'p1', amount: 90 },
          players,
          200,
        ),
      ),
    ).toEqual([90, 0, 0]);
  });

  it('pays a repayment to the lender, with the interest leaving the game', () => {
    const loan = (lenderPlayerId: string | null): Loan => ({
      id: 'l1',
      gameId: 'g1',
      lenderKind: lenderPlayerId === null ? 'BANK' : 'PLAYER',
      lenderPlayerId,
      borrowerPlayerId: 'p1',
      principal: 100,
      repaidAmount: 0,
      state: 'ACTIVE',
      createdAt: '',
      closedAt: null,
    });
    const request = { type: 'LOAN_REPAYMENT', playerId: 'p1', loanId: 'l1', amount: 40 } as const;
    expect(deltas(previewBalances(request, players, 200, 0, [loan('p2')], 0))).toEqual([
      -40, 40, 0,
    ]);
    expect(deltas(previewBalances(request, players, 200, 0, [loan(null)], 8))).toEqual([-48, 0, 0]);
    expect(deltas(previewBalances(request, players, 200, 0, [], 0))).toEqual([-40, 0, 0]);
  });
});
