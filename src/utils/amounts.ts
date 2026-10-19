export { addRecentAmount } from '../../shared/domain/recent-amounts';

export function toggleFavoriteAmount(amounts: readonly number[], amount: number): number[] {
  if (!Number.isSafeInteger(amount) || amount <= 0) return [...amounts];
  return amounts.includes(amount)
    ? amounts.filter((value) => value !== amount)
    : [amount, ...amounts];
}
