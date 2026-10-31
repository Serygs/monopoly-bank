/** The colours a player can take; the client's `--mb-color-player-*` tokens carry the same values. */
export const PLAYER_COLORS = [
  '#d83f55',
  '#2878d0',
  '#238b57',
  '#d97721',
  '#8b4cc5',
  '#087f78',
] as const;

/** Colours the join flow handed out before the palette was shared, mapped to today's equivalent. */
const LEGACY_COLORS: Readonly<Record<string, string>> = {
  '#e05263': PLAYER_COLORS[0],
  '#2f80ed': PLAYER_COLORS[1],
  '#27ae60': PLAYER_COLORS[2],
  '#f2994a': PLAYER_COLORS[3],
  '#9b51e0': PLAYER_COLORS[4],
  '#14b8a6': PLAYER_COLORS[5],
};

/** The palette colour a stored colour stands for, so a legacy red counts as taken like today's red. */
export function normalizeColor(color: string): string {
  const lower = color.trim().toLowerCase();
  return LEGACY_COLORS[lower] ?? lower;
}

/** A random palette colour nobody holds yet; the least used one when all are taken. */
export function pickRandomUnusedColor(
  taken: readonly string[],
  random: () => number = Math.random,
): string {
  const used = taken.map(normalizeColor);
  const count = (color: string) => used.filter((candidate) => candidate === color).length;
  const fewest = Math.min(...PLAYER_COLORS.map(count));
  const free = PLAYER_COLORS.filter((color) => count(color) === fewest);
  return free[Math.min(free.length - 1, Math.floor(random() * free.length))];
}

/** The first colour that appears twice (after normalizing), or `null` when all differ. */
export function findDuplicateColor(colors: readonly string[]): string | null {
  const seen = new Set<string>();
  for (const color of colors) {
    const key = normalizeColor(color);
    if (seen.has(key)) return color;
    seen.add(key);
  }
  return null;
}
