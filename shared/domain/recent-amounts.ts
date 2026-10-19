export function addRecentAmount(amounts: readonly number[], amount: number): number[] {
  if (!Number.isSafeInteger(amount) || amount <= 0) return [...amounts];
  return [amount, ...amounts.filter((value) => value !== amount)].slice(0, 5);
}
