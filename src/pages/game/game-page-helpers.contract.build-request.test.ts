import { describe, expect, it } from 'vitest';
import { buildRequest } from './game-page-helpers';

describe('buildRequest for every action', () => {
  it.each([
    [
      'PLAYER_TO_PLAYER',
      { type: 'PLAYER_TO_PLAYER', sourcePlayerId: 'p1', destinationPlayerId: 'p2', amount: 50 },
    ],
    ['PLAYER_TO_BANK', { type: 'PLAYER_TO_BANK', playerId: 'p1', amount: 50 }],
    ['BANK_TO_PLAYER', { type: 'BANK_TO_PLAYER', playerId: 'p1', amount: 50 }],
    ['TO_JACKPOT', { type: 'TO_JACKPOT', playerId: 'p1', amount: 50 }],
    ['PLAYER_TO_ALL', { type: 'PLAYER_TO_ALL', payerPlayerId: 'p1', amountPerPlayer: 50 }],
    ['ALL_TO_PLAYER', { type: 'ALL_TO_PLAYER', recipientPlayerId: 'p1', amountPerPlayer: 50 }],
  ] as const)('%s takes a trimmed comment and drops a blank one', (action, base) => {
    expect(buildRequest(action, 'p1', 'p2', 50, '  rent  ')).toEqual({ ...base, comment: 'rent' });
    const blank = buildRequest(action, 'p1', 'p2', 50, '   ');
    expect(blank).toEqual(base);
    expect(blank).not.toHaveProperty('comment');
    expect(buildRequest(action, 'p1', 'p2', 50, '')).toEqual(base);
  });

  it('needs a destination for a player payment and a lender for a loan', () => {
    expect(buildRequest('PLAYER_TO_PLAYER', 'p1', '', 50, '')).toBeNull();
    expect(buildRequest('LOAN_ISSUE', 'p1', '', 50, '')).toBeNull();
    expect(buildRequest('LOAN_ISSUE', 'p1', 'p2', 50, 'ignored')).toEqual({
      type: 'LOAN_ISSUE',
      borrowerPlayerId: 'p1',
      lenderPlayerId: 'p2',
      amount: 50,
    });
  });

  it('sends the reviewed pot for a collection, with no comment', () => {
    expect(buildRequest('JACKPOT_PAYOUT', 'p1', '', 300, 'note')).toEqual({
      type: 'JACKPOT_PAYOUT',
      playerId: 'p1',
      expectedAmount: 300,
    });
  });

  it('sends the exact-landing flag on Pass GO only when it is true', () => {
    expect(buildRequest('PASS_GO', 'p1', '', 0, '', { exactLanding: true })).toEqual({
      type: 'PASS_GO',
      playerId: 'p1',
      exactLanding: true,
    });
    for (const exactLanding of [false, undefined]) {
      const request = buildRequest('PASS_GO', 'p1', '', 0, '', { exactLanding });
      expect(request).toEqual({ type: 'PASS_GO', playerId: 'p1' });
      expect(request).not.toHaveProperty('exactLanding');
    }
    expect(buildRequest('PASS_GO', 'p1', '', 0, ' hi ')).toEqual({
      type: 'PASS_GO',
      playerId: 'p1',
      comment: 'hi',
    });
  });

  it('builds a mortgage by tile, by name, and refuses an empty tile', () => {
    expect(buildRequest('MORTGAGE', 'p1', '', 0, '', { tileId: 'zhitna' })).toEqual({
      type: 'MORTGAGE',
      playerId: 'p1',
      tileId: 'zhitna',
    });
    expect(buildRequest('MORTGAGE', 'p1', '', 0, '', { tileId: '' })).toBeNull();
    expect(
      buildRequest('MORTGAGE', 'p1', '', 70, 'ignored', { propertyName: 'Boardwalk' }),
    ).toEqual({
      type: 'MORTGAGE',
      playerId: 'p1',
      propertyName: 'Boardwalk',
      amount: 70,
    });
    expect(buildRequest('MORTGAGE', 'p1', '', 70, '')).toEqual({
      type: 'MORTGAGE',
      playerId: 'p1',
      propertyName: '',
      amount: 70,
    });
  });

  it('builds a redemption only for a chosen mortgage', () => {
    expect(buildRequest('MORTGAGE_REDEMPTION', 'p1', '', 0, '', { mortgageId: 'm1' })).toEqual({
      type: 'MORTGAGE_REDEMPTION',
      playerId: 'p1',
      mortgageId: 'm1',
    });
    expect(buildRequest('MORTGAGE_REDEMPTION', 'p1', '', 0, '')).toBeNull();
    expect(buildRequest('MORTGAGE_REDEMPTION', 'p1', '', 0, '', { mortgageId: '' })).toBeNull();
  });

  it('builds a purchase, a build and a sale for a tile, and refuses a missing or empty tile', () => {
    for (const action of [
      'PROPERTY_PURCHASE',
      'PROPERTY_BUILD',
      'PROPERTY_SELL_BUILDING',
    ] as const) {
      expect(buildRequest(action, 'p1', '', 0, '', { tileId: 'zhitna' })).toEqual({
        type: action,
        playerId: 'p1',
        tileId: 'zhitna',
      });
      expect(buildRequest(action, 'p1', '', 0, '')).toBeNull();
      expect(buildRequest(action, 'p1', '', 0, '', { tileId: '' })).toBeNull();
    }
  });

  it('sends the agreed price of a purchase only when there is one', () => {
    expect(
      buildRequest('PROPERTY_PURCHASE', 'p1', '', 0, '', { tileId: 'zhitna', priceOverride: 1 }),
    ).toMatchObject({ priceOverride: 1 });
    expect(
      buildRequest('PROPERTY_PURCHASE', 'p1', '', 0, '', { tileId: 'zhitna' }),
    ).not.toHaveProperty('priceOverride');
  });

  it('builds a build or a sale from the final levels, ignoring empty targets', () => {
    for (const action of ['PROPERTY_BUILD', 'PROPERTY_SELL_BUILDING'] as const) {
      expect(
        buildRequest(action, 'p1', '', 0, '', {
          targets: { zhitna: 2, nagatinska: 1 },
          tileId: 'x',
        }),
      ).toEqual({ type: action, playerId: 'p1', targets: { zhitna: 2, nagatinska: 1 } });
      expect(buildRequest(action, 'p1', '', 0, '', { targets: {} })).toBeNull();
      expect(buildRequest(action, 'p1', '', 0, '', { targets: {}, tileId: 'zhitna' })).toEqual({
        type: action,
        playerId: 'p1',
        tileId: 'zhitna',
      });
    }
  });

  it('builds a rent payment with an optional dice sum', () => {
    expect(buildRequest('PAY_RENT', 'p1', '', 0, '', { tileId: 'zhitna' })).toEqual({
      type: 'PAY_RENT',
      payerPlayerId: 'p1',
      tileId: 'zhitna',
    });
    expect(
      buildRequest('PAY_RENT', 'p1', '', 0, '', { tileId: 'power_plant', diceSum: 7 }),
    ).toEqual({
      type: 'PAY_RENT',
      payerPlayerId: 'p1',
      tileId: 'power_plant',
      diceSum: 7,
    });
    expect(buildRequest('PAY_RENT', 'p1', '', 0, '')).toBeNull();
    expect(buildRequest('PAY_RENT', 'p1', '', 0, '', { tileId: '' })).toBeNull();
  });

  it('builds a repayment only for a chosen loan, with the confirmed rate when given', () => {
    expect(buildRequest('LOAN_REPAYMENT', 'p1', '', 40, '', { loanId: 'l1' })).toEqual({
      type: 'LOAN_REPAYMENT',
      playerId: 'p1',
      loanId: 'l1',
      amount: 40,
    });
    expect(
      buildRequest('LOAN_REPAYMENT', 'p1', '', 40, '', { loanId: 'l1', interestRatePercent: 0 }),
    ).toMatchObject({ interestRatePercent: 0 });
    expect(buildRequest('LOAN_REPAYMENT', 'p1', '', 40, '')).toBeNull();
    expect(buildRequest('LOAN_REPAYMENT', 'p1', '', 40, '', { loanId: '' })).toBeNull();
  });

  it('builds a bank loan with the cooldown acknowledgement only when it is true', () => {
    expect(buildRequest('BANK_LOAN', 'p1', '', 400, '')).toEqual({
      type: 'LOAN_ISSUE',
      lenderKind: 'BANK',
      playerId: 'p1',
      amount: 400,
    });
    expect(
      buildRequest('BANK_LOAN', 'p1', '', 400, '', { acknowledgeCooldown: true }),
    ).toMatchObject({ acknowledgeCooldown: true });
    expect(
      buildRequest('BANK_LOAN', 'p1', '', 400, '', { acknowledgeCooldown: false }),
    ).not.toHaveProperty('acknowledgeCooldown');
  });

  it('never builds a trade from the single-amount form', () => {
    expect(buildRequest('PROPERTY_TRANSFER', 'p1', 'p2', 10, '', { tileId: 'zhitna' })).toBeNull();
  });
});
