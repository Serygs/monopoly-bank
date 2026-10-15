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

const niceMantissas = [1, 2, 5] as const;
const presetMultipliers = [1, 1.5, 2, 3, 5, 10] as const;

/**
 * Quick amounts scaled to the game's starting balance: a round 1/2/5 × 10ⁿ unit at or below a
 * tenth of it, times 1, 1.5, 2, 3, 5 and 10 (15 000 000 → 1M, 1.5M, 2M, 3M, 5M, 10M).
 */
export function presetAmounts(startingBalance: number): number[] {
  if (!Number.isSafeInteger(startingBalance) || startingBalance < 10) return [];
  const target = startingBalance / 10;
  let unit = 1;
  for (let power = 1; power <= target; power *= 10)
    for (const mantissa of niceMantissas) if (mantissa * power <= target) unit = mantissa * power;
  const presets: number[] = [];
  for (const multiplier of presetMultipliers) {
    const amount = unit * multiplier;
    if (Number.isInteger(amount) && amount <= startingBalance && !presets.includes(amount))
      presets.push(amount);
  }
  return presets;
}
