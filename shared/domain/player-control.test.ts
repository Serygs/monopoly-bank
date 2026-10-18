import { describe, expect, it } from 'vitest';

import { controlledPlayerIdForBankingCommand } from './player-control.js';

describe('controlledPlayerIdForBankingCommand', () => {
  it.each([
    [
      {
        type: 'PLAYER_TO_PLAYER',
        sourcePlayerId: 'source',
        destinationPlayerId: 'destination',
        amount: 10,
      },
      'source',
    ],
    [{ type: 'PLAYER_TO_BANK', playerId: 'player', amount: 10 }, 'player'],
    [{ type: 'BANK_TO_PLAYER', playerId: 'player', amount: 10 }, 'player'],
    [{ type: 'PLAYER_TO_ALL', payerPlayerId: 'payer', amountPerPlayer: 10 }, 'payer'],
    [{ type: 'ALL_TO_PLAYER', recipientPlayerId: 'recipient', amountPerPlayer: 10 }, 'recipient'],
    [{ type: 'PASS_GO', playerId: 'player' }, 'player'],
    [{ type: 'MORTGAGE', playerId: 'player', propertyName: 'Boardwalk', amount: 10 }, 'player'],
    [{ type: 'MORTGAGE_REDEMPTION', playerId: 'player', mortgageId: 'mortgage' }, 'player'],
    [
      { type: 'LOAN_ISSUE', borrowerPlayerId: 'borrower', lenderPlayerId: 'lender', amount: 10 },
      'borrower',
    ],
    [{ type: 'LOAN_ISSUE', lenderKind: 'BANK', playerId: 'borrower', amount: 10 }, 'borrower'],
    [{ type: 'LOAN_REPAYMENT', playerId: 'borrower', loanId: 'loan', amount: 10 }, 'borrower'],
    [{ type: 'TO_JACKPOT', playerId: 'payer', amount: 10 }, 'payer'],
    [{ type: 'JACKPOT_PAYOUT', playerId: 'collector' }, 'collector'],
    [{ playerId: 'bankrupt-player' }, 'bankrupt-player'],
  ] as const)('requires the actor to control %o', (request, expectedPlayerId) => {
    expect(controlledPlayerIdForBankingCommand(request)).toBe(expectedPlayerId);
  });
});

describe('controlledPlayerIdForBankingCommand for property and rent commands', () => {
  it.each([
    [{ type: 'PROPERTY_PURCHASE', playerId: 'buyer', tileId: 'zhitna' }, 'buyer'],
    [{ type: 'PROPERTY_BUILD', playerId: 'builder', tileId: 'zhitna' }, 'builder'],
    [{ type: 'PROPERTY_SELL_BUILDING', playerId: 'seller', tileId: 'zhitna' }, 'seller'],
    [{ type: 'PAY_RENT', payerPlayerId: 'tenant', tileId: 'zhitna' }, 'tenant'],
    [
      {
        type: 'PROPERTY_TRANSFER',
        playerId: 'proposer',
        counterpartyPlayerId: 'other',
        giveTileIds: ['zhitna'],
        takeTileIds: [],
      },
      'proposer',
    ],
  ] as const)('requires the actor to control %o', (request, expected) => {
    expect(controlledPlayerIdForBankingCommand(request)).toBe(expected);
  });

  it('lets the bankrupt player authorize a bankruptcy in favour of a creditor', () => {
    expect(
      controlledPlayerIdForBankingCommand({ playerId: 'broke', creditorPlayerId: 'creditor' }),
    ).toBe('broke');
  });
});
