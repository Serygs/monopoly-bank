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
    [{ type: 'LOAN_REPAYMENT', playerId: 'borrower', loanId: 'loan', amount: 10 }, 'borrower'],
    [{ playerId: 'bankrupt-player' }, 'bankrupt-player'],
  ] as const)('requires the actor to control %o', (request, expectedPlayerId) => {
    expect(controlledPlayerIdForBankingCommand(request)).toBe(expectedPlayerId);
  });
});
