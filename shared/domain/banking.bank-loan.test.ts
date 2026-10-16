import { describe, expect, it } from 'vitest';
import type { Game, Loan, Player } from '../types/monopoly.js';
import { defaultGameRules } from '../types/monopoly.js';
import {
  BankLoanAlreadyActiveError,
  BankLoanCooldownError,
  BankLoanFullRepaymentRequiredError,
  BankLoanLimitExceededError,
  declareBankruptcy,
  InsufficientFundsError,
  InvalidAmountError,
  InvalidGameStateError,
  issueBankLoan,
  LoanNotFoundError,
  PlayerBankruptError,
  repayBankLoan,
  reverseTransaction,
  TransactionNotReversibleError,
} from './banking.js';
import { buildGameSettings } from './game-rules.js';

const game: Game = {
  id: 'game-1',
  name: 'Friday game',
  startingBalance: 1500,
  passGoReward: 200,
  currency: 'K',
  paymentMode: 'FAST',
  rules: { ...defaultGameRules, bankLoans: true },
  settings: buildGameSettings(1500), // unit 10, bankLoanMax 200
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

/** Player 2 owes the bank 200. */
const loan: Loan = {
  id: 'loan-1',
  gameId: game.id,
  lenderKind: 'BANK',
  lenderPlayerId: null,
  borrowerPlayerId: 'player-2',
  principal: 200,
  repaidAmount: 0,
  state: 'ACTIVE',
  createdAt: '',
  closedAt: null,
};

describe('issueBankLoan', () => {
  const command = { game, playerId: 'player-2', amount: 150 };

  it('pays the borrower from the bank and carries the bank loan record', () => {
    const result = issueBankLoan({ ...command, players: players([500, 100]) });

    expect(result.transaction).toMatchObject({
      type: 'LOAN_ISSUE',
      amount: 150,
      totalAmount: 150,
      comment: null,
      participants: [{ playerId: 'player-2', balanceDelta: 150 }],
      newLoan: {
        lenderKind: 'BANK',
        lenderPlayerId: null,
        borrowerPlayerId: 'player-2',
        principal: 150,
        cooldownAcknowledged: false,
      },
    });
    expect(result.affectedPlayers.map((change) => change.balanceAfter)).toEqual([250]);
  });

  it('lends exactly the maximum and no more', () => {
    expect(issueBankLoan({ ...command, amount: 200, players: players([500, 100]) })).toBeDefined();
    expect(() => issueBankLoan({ ...command, amount: 201, players: players([500, 100]) })).toThrow(
      BankLoanLimitExceededError,
    );
  });

  it('derives the maximum for a game created before the settings snapshot', () => {
    const legacy = { ...game, settings: null };

    expect(() =>
      issueBankLoan({ ...command, game: legacy, amount: 201, players: players([500, 100]) }),
    ).toThrow(BankLoanLimitExceededError);
    expect(
      issueBankLoan({ ...command, game: legacy, amount: 200, players: players([500, 100]) }),
    ).toBeDefined();
  });

  it.each([0, -5, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1])('rejects amount %s', (amount) => {
    expect(() => issueBankLoan({ ...command, amount, players: players([500, 100]) })).toThrow(
      InvalidAmountError,
    );
  });

  it('refuses a second active bank loan', () => {
    expect(() =>
      issueBankLoan({ ...command, activeBankLoan: loan, players: players([500, 100]) }),
    ).toThrow(BankLoanAlreadyActiveError);
  });

  it('asks for the cooldown warning, and stores the acknowledgement once confirmed', () => {
    const cooldown = { playerId: 'player-2', roundsLeft: 1 };

    expect(() => issueBankLoan({ ...command, cooldown, players: players([500, 100]) })).toThrow(
      BankLoanCooldownError,
    );
    expect(
      issueBankLoan({
        ...command,
        cooldown,
        acknowledgeCooldown: true,
        players: players([500, 100]),
      }).transaction.newLoan,
    ).toMatchObject({ cooldownAcknowledged: true });
  });

  it('refuses a bankrupt borrower and a game that is not active', () => {
    expect(() =>
      issueBankLoan({ ...command, players: players([500, 0], [{}, { status: 'BANKRUPT' }]) }),
    ).toThrow(PlayerBankruptError);
    expect(() =>
      issueBankLoan({
        ...command,
        game: { ...game, status: 'FINISHED' },
        players: players([5, 5]),
      }),
    ).toThrow(InvalidGameStateError);
  });

  it('cannot be reversed', () => {
    const result = issueBankLoan({ ...command, players: players([500, 100]) });

    expect(() =>
      reverseTransaction({
        game,
        players: players([500, 250]),
        original: {
          ...result.transaction,
          id: 't',
          createdAt: '',
          reversedByTransactionId: null,
        },
      }),
    ).toThrow(TransactionNotReversibleError);
  });
});

describe('repayBankLoan', () => {
  const command = {
    game,
    playerId: 'player-2',
    loan,
    amount: 200,
    interestRatePercent: 10 as const,
    suggestedRatePercent: 10 as const,
  };

  it('takes the principal plus interest from the borrower and nothing goes to another wallet', () => {
    const result = repayBankLoan({ ...command, players: players([500, 300]) });

    expect(result.transaction).toMatchObject({
      type: 'LOAN_REPAYMENT',
      amount: 220,
      totalAmount: 220,
      participants: [{ playerId: 'player-2', balanceDelta: -220 }],
      loanRepayment: {
        loanId: 'loan-1',
        lenderPlayerId: null,
        borrowerPlayerId: 'player-2',
        amount: 200,
        interestAmount: 20,
        interestRatePercent: 10,
        suggestedRatePercent: 10,
      },
    });
    expect(result.affectedPlayers.map((change) => change.balanceAfter)).toEqual([80]);
  });

  it('charges no interest at 0% and records both the chosen and the suggested rate', () => {
    const result = repayBankLoan({
      ...command,
      interestRatePercent: 0,
      suggestedRatePercent: 20,
      players: players([500, 200]),
    });

    expect(result.transaction.amount).toBe(200);
    expect(result.transaction.loanRepayment).toMatchObject({
      interestAmount: 0,
      interestRatePercent: 0,
      suggestedRatePercent: 20,
    });
  });

  it('rounds the interest half up', () => {
    const odd = { ...loan, principal: 25 };

    // 25 * 10% = 2.5 -> 3; 25 * 20% = 5
    expect(
      repayBankLoan({ ...command, loan: odd, amount: 25, players: players([0, 100]) }).transaction
        .amount,
    ).toBe(28);
    expect(
      repayBankLoan({
        ...command,
        loan: odd,
        amount: 25,
        interestRatePercent: 20,
        players: players([0, 100]),
      }).transaction.amount,
    ).toBe(30);
  });

  it('rejects when the borrower cannot cover the principal plus interest', () => {
    expect(() => repayBankLoan({ ...command, players: players([500, 219]) })).toThrow(
      InsufficientFundsError,
    );
    // The principal alone would fit, so interest is what tips it over.
    expect(() =>
      repayBankLoan({ ...command, interestRatePercent: 0, players: players([500, 219]) }),
    ).not.toThrow();
  });

  it.each([100, 201])('refuses to repay %i of 200: the whole loan is repaid at once', (amount) => {
    expect(() => repayBankLoan({ ...command, amount, players: players([500, 500]) })).toThrow(
      BankLoanFullRepaymentRequiredError,
    );
  });

  it('refuses a loan that is not an active bank loan of this borrower', () => {
    const other = players([500, 500]);

    expect(() => repayBankLoan({ ...command, playerId: 'player-1', players: other })).toThrow(
      LoanNotFoundError,
    );
    expect(() =>
      repayBankLoan({ ...command, loan: { ...loan, state: 'REPAID' }, players: other }),
    ).toThrow(LoanNotFoundError);
    expect(() =>
      repayBankLoan({
        ...command,
        loan: { ...loan, lenderKind: 'PLAYER', lenderPlayerId: 'player-1' },
        players: other,
      }),
    ).toThrow(LoanNotFoundError);
  });

  it('cannot be reversed', () => {
    const result = repayBankLoan({ ...command, players: players([500, 300]) });

    expect(() =>
      reverseTransaction({
        game,
        players: players([500, 80]),
        original: {
          ...result.transaction,
          id: 't',
          createdAt: '',
          reversedByTransactionId: null,
        },
      }),
    ).toThrow(TransactionNotReversibleError);
  });
});

describe('declareBankruptcy with an active bank loan', () => {
  const bankLoan = (suggestedRatePercent: 0 | 10 | 20 = 10) => ({ loan, suggestedRatePercent });

  it('pays the bank first and hands the creditor only the rest when the cash covers the debt', () => {
    // Debt: 200 + 10% = 220; cash 500.
    const result = declareBankruptcy({
      game,
      players: players([100, 500]),
      playerId: 'player-2',
      creditorPlayerId: 'player-1',
      bankLoan: bankLoan(),
    });

    expect(result.transaction).toMatchObject({
      type: 'BANKRUPTCY_TRANSFER',
      amount: 500,
      totalAmount: 500,
      participants: [
        { playerId: 'player-2', balanceDelta: -500 },
        { playerId: 'player-1', balanceDelta: 280 },
      ],
      bankLoanSettlement: {
        loanId: 'loan-1',
        outcome: 'REPAID',
        paidPrincipal: 200,
        paidInterest: 20,
        interestRatePercent: 10,
        suggestedRatePercent: 10,
      },
    });
  });

  it('gives the bank everything when the bankruptcy is to the bank', () => {
    const result = declareBankruptcy({
      game,
      players: players([100, 500]),
      playerId: 'player-2',
      bankLoan: bankLoan(20),
    });

    expect(result.transaction.participants).toEqual([{ playerId: 'player-2', balanceDelta: -500 }]);
    expect(result.transaction.bankLoanSettlement).toMatchObject({
      outcome: 'REPAID',
      paidPrincipal: 200,
      paidInterest: 40,
    });
  });

  it('omits the creditor when the bank takes the whole wallet', () => {
    const result = declareBankruptcy({
      game,
      players: players([100, 150]),
      playerId: 'player-2',
      creditorPlayerId: 'player-1',
      bankLoan: bankLoan(),
    });

    expect(result.transaction.participants).toEqual([{ playerId: 'player-2', balanceDelta: -150 }]);
    expect(result.transaction.bankLoanSettlement).toMatchObject({
      outcome: 'WRITTEN_OFF',
      paidPrincipal: 150,
      paidInterest: 0,
    });
  });

  it('counts the loan repaid once the principal is covered, taking the rest of the cash as interest', () => {
    // Debt 220, cash 210: the bank takes all of it, the creditor gets nothing.
    const result = declareBankruptcy({
      game,
      players: players([100, 210]),
      playerId: 'player-2',
      creditorPlayerId: 'player-1',
      bankLoan: bankLoan(),
    });

    expect(result.transaction.participants).toEqual([{ playerId: 'player-2', balanceDelta: -210 }]);
    expect(result.transaction.bankLoanSettlement).toMatchObject({
      outcome: 'REPAID',
      paidPrincipal: 200,
      paidInterest: 10,
    });
  });

  it('charges no interest in round 1 and gives the creditor the remainder', () => {
    const result = declareBankruptcy({
      game,
      players: players([100, 250]),
      playerId: 'player-2',
      creditorPlayerId: 'player-1',
      bankLoan: bankLoan(0),
    });

    expect(result.transaction.participants).toEqual([
      { playerId: 'player-2', balanceDelta: -250 },
      { playerId: 'player-1', balanceDelta: 50 },
    ]);
    expect(result.transaction.bankLoanSettlement).toMatchObject({
      outcome: 'REPAID',
      paidPrincipal: 200,
      paidInterest: 0,
    });
  });

  it('writes the loan off without moving anything when the wallet is empty', () => {
    const result = declareBankruptcy({
      game,
      players: players([100, 0]),
      playerId: 'player-2',
      creditorPlayerId: 'player-1',
      bankLoan: bankLoan(),
    });

    expect(result.affectedPlayers).toEqual([]);
    expect(result.transaction.bankLoanSettlement).toMatchObject({
      outcome: 'WRITTEN_OFF',
      paidPrincipal: 0,
      paidInterest: 0,
    });
  });

  it('is unchanged without a bank loan', () => {
    const result = declareBankruptcy({
      game,
      players: players([100, 500]),
      playerId: 'player-2',
      creditorPlayerId: 'player-1',
    });

    expect(result.transaction.participants).toEqual([
      { playerId: 'player-2', balanceDelta: -500 },
      { playerId: 'player-1', balanceDelta: 500 },
    ]);
    expect(result.transaction.bankLoanSettlement).toBeUndefined();
  });

  it('rejects a loan that does not belong to the bankrupt player', () => {
    expect(() =>
      declareBankruptcy({
        game,
        players: players([100, 500]),
        playerId: 'player-1',
        bankLoan: bankLoan(),
      }),
    ).toThrow(LoanNotFoundError);
  });
});
