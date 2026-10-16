import { interestRatePercents, type InterestRatePercent } from '../types/monopoly.js';

export function isInterestRatePercent(value: unknown): value is InterestRatePercent {
  return interestRatePercents.includes(value as InterestRatePercent);
}

/**
 * The interest on a bank loan: the principal times the rate, rounded half up to a whole amount.
 * Written as `floor((principal * rate + 50) / 100)`, which is exact while the product is a safe
 * integer; a principal too large for that is not a valid amount.
 */
export function bankLoanInterest(principal: number, ratePercent: InterestRatePercent): number {
  const product = principal * ratePercent;
  if (!Number.isSafeInteger(principal) || principal <= 0 || !Number.isSafeInteger(product + 50))
    throw new RangeError('The principal must be a positive safe integer.');
  return Math.floor((product + 50) / 100);
}
