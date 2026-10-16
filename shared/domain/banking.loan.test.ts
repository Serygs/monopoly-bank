import { describe, expect, it } from 'vitest';
import type { Game, Loan, Player } from '../types/monopoly.js';
import { defaultGameRules } from '../types/monopoly.js';
import {
  InsufficientFundsError,
  InvalidAmountError,
  InvalidGameStateError,
  issueLoan,
  LoanAmountExceedsDebtError,
  LoanNotFoundError,
  PlayerBankruptError,
  PlayerNotFoundError,
  repayLoan,
  reverseTransaction,
  SameSourceAndDestinationError,
} from './banking.js';

const game: Game = {
  id: 'game-1',
  name: 'Friday game',
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

function players(balances: readonly number[], overrides: Partial<Player>[] = []): Player[] {
  return balances.map((balance, index) => ({
    id: `player-${index + 1}`,
    gameId: game.id,
    name: `Player ${index + 1}`,
    color: `color-${index + 1}`,
    balance,
    createdAt: '',
    ...overrides[index],
  }));
}

/** Player 1 lent player 2 300, of which 100 is repaid. */
const loan: Loan = {
  id: 'loan-1',
  gameId: game.id,
  lenderKind: 'PLAYER',
  lenderPlayerId: 'player-1',
  borrowerPlayerId: 'player-2',
  principal: 300,
  repaidAmount: 100,
  state: 'ACTIVE',
  createdAt: '',
  closedAt: null,
};

describe('issueLoan', () => {
  const command = {
    game,
    lenderPlayerId: 'player-1',
    borrowerPlayerId: 'player-2',
    amount: 250,
  };

  it('moves the amount from the lender to the borrower and carries the loan record', () => {
    const result = issueLoan({ ...command, players: players([500, 100]) });

    expect(result.transaction).toMatchObject({
      type: 'LOAN_ISSUE',
      amount: 250,
      totalAmount: 250,
      comment: null,
      participants: [
        { playerId: 'player-1', balanceDelta: -250 },
        { playerId: 'player-2', balanceDelta: 250 },
      ],
      newLoan: { lenderPlayerId: 'player-1', borrowerPlayerId: 'player-2', principal: 250 },
    });
    expect(result.affectedPlayers.map((change) => change.balanceAfter)).toEqual([250, 350]);
  });

  it('allows the lender to give away their whole balance', () => {
    const result = issueLoan({ ...command, players: players([250, 0]) });
    expect(result.affectedPlayers.map((change) => change.balanceAfter)).toEqual([0, 250]);
  });

  it('refuses a lender who cannot cover the loan', () => {
    expect(() => issueLoan({ ...command, players: players([249, 100]) })).toThrow(
      InsufficientFundsError,
    );
  });

  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])('rejects the amount %s', (amount) => {
    expect(() => issueLoan({ ...command, amount, players: players([500, 100]) })).toThrow(
      InvalidAmountError,
    );
  });

  it('refuses to lend to oneself', () => {
    expect(() =>
      issueLoan({ ...command, borrowerPlayerId: 'player-1', players: players([500, 100]) }),
    ).toThrow(SameSourceAndDestinationError);
  });

  it('refuses a bankrupt lender or borrower', () => {
    expect(() =>
      issueLoan({ ...command, players: players([500, 100], [{ status: 'BANKRUPT' }]) }),
    ).toThrow(PlayerBankruptError);
    expect(() =>
      issueLoan({ ...command, players: players([500, 100], [{}, { status: 'BANKRUPT' }]) }),
    ).toThrow(PlayerBankruptError);
  });

  it('refuses an unknown player and a game that is not active', () => {
    expect(() =>
      issueLoan({ ...command, lenderPlayerId: 'nobody', players: players([5, 5]) }),
    ).toThrow(PlayerNotFoundError);
    expect(() =>
      issueLoan({
        ...command,
        game: { ...game, status: 'FINISHED' },
        players: players([500, 100]),
      }),
    ).toThrow(InvalidGameStateError);
  });
});

describe('repayLoan', () => {
  const command = { game, playerId: 'player-2', loan, amount: 80 };

  it('moves the amount from the borrower to the lender and names the loan', () => {
    const result = repayLoan({ ...command, players: players([100, 500]) });

    expect(result.transaction).toMatchObject({
      type: 'LOAN_REPAYMENT',
      amount: 80,
      participants: [
        { playerId: 'player-2', balanceDelta: -80 },
        { playerId: 'player-1', balanceDelta: 80 },
      ],
      loanRepayment: {
        loanId: 'loan-1',
        lenderPlayerId: 'player-1',
        borrowerPlayerId: 'player-2',
        amount: 80,
      },
    });
    expect(result.affectedPlayers.map((change) => change.balanceAfter)).toEqual([420, 180]);
  });

  it('accepts exactly the outstanding amount', () => {
    expect(
      repayLoan({ ...command, amount: 200, players: players([100, 500]) }).transaction.amount,
    ).toBe(200);
  });

  it('refuses more than is still owed', () => {
    expect(() => repayLoan({ ...command, amount: 201, players: players([100, 500]) })).toThrow(
      LoanAmountExceedsDebtError,
    );
  });

  it.each([0, -3, 2.5])('rejects the amount %s', (amount) => {
    expect(() => repayLoan({ ...command, amount, players: players([100, 500]) })).toThrow(
      InvalidAmountError,
    );
  });

  it('refuses a borrower who cannot afford the repayment', () => {
    expect(() => repayLoan({ ...command, players: players([100, 79]) })).toThrow(
      InsufficientFundsError,
    );
  });

  it('only lets the borrower repay, and only an active loan of this game', () => {
    const table = players([100, 500]);
    expect(() => repayLoan({ ...command, playerId: 'player-1', players: table })).toThrow(
      LoanNotFoundError,
    );
    expect(() =>
      repayLoan({ ...command, loan: { ...loan, state: 'WRITTEN_OFF' }, players: table }),
    ).toThrow(LoanNotFoundError);
    expect(() =>
      repayLoan({ ...command, loan: { ...loan, gameId: 'other' }, players: table }),
    ).toThrow(LoanNotFoundError);
    expect(() =>
      repayLoan({ ...command, loan: { ...loan, lenderPlayerId: null }, players: table }),
    ).toThrow(LoanNotFoundError);
  });

  it('refuses a bankrupt borrower or lender', () => {
    expect(() =>
      repayLoan({ ...command, players: players([100, 500], [{}, { status: 'BANKRUPT' }]) }),
    ).toThrow(PlayerBankruptError);
    expect(() =>
      repayLoan({ ...command, players: players([100, 500], [{ status: 'BANKRUPT' }]) }),
    ).toThrow(PlayerBankruptError);
  });
});

describe('loan transactions', () => {
  it('cannot be reversed', () => {
    const issued = issueLoan({
      game,
      players: players([500, 100]),
      lenderPlayerId: 'player-1',
      borrowerPlayerId: 'player-2',
      amount: 100,
    });
    const original = {
      ...issued.transaction,
      id: 'tx-1',
      createdAt: '',
    };
    expect(() => reverseTransaction({ game, players: players([400, 200]), original })).toThrow();
  });
});
