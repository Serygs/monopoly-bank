import type { Loan } from '../../shared/types/monopoly';

/** What is still owed on a loan. */
export function loanOutstanding(loan: Pick<Loan, 'principal' | 'repaidAmount'>): number {
  return Math.max(0, loan.principal - loan.repaidAmount);
}

/** The loans a player is still repaying to another player. */
export function activeLoansAsBorrower(loans: Loan[], playerId: string): Loan[] {
  return loans.filter(
    (loan) =>
      loan.state === 'ACTIVE' &&
      loan.lenderKind === 'PLAYER' &&
      loan.borrowerPlayerId === playerId &&
      loanOutstanding(loan) > 0,
  );
}

/** What a player owes (as borrower) and is owed (as player lender) across active loans. */
export function playerDebt(loans: Loan[], playerId: string): { owes: number; owed: number } {
  let owes = 0;
  let owed = 0;
  for (const loan of loans) {
    if (loan.state !== 'ACTIVE') continue;
    if (loan.borrowerPlayerId === playerId) owes += loanOutstanding(loan);
    if (loan.lenderKind === 'PLAYER' && loan.lenderPlayerId === playerId)
      owed += loanOutstanding(loan);
  }
  return { owes, owed };
}
