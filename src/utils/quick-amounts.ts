/** Favourites first, then recent, then the standard amounts; positive, without duplicates. */
export function mergeQuickAmounts(
  favorites: readonly number[],
  recent: readonly number[],
  standard: readonly number[],
): number[] {
  const merged: number[] = [];
  for (const amount of [...favorites, ...recent, ...standard])
    if (amount > 0 && !merged.includes(amount)) merged.push(amount);
  return merged;
}
