export const MAX_PROPERTY_NAME_LENGTH = 60;

/**
 * The cost to redeem: the mortgage value plus 10%, rounded half up to a whole amount. Written as
 * `value + floor((value + 5) / 10)`, which equals `floor((value * 11 + 5) / 10)` but never forms
 * a product larger than the result, so it stays exact for every safe integer.
 */
export function redemptionCost(mortgageValue: number): number {
  return mortgageValue + Math.floor((mortgageValue + 5) / 10);
}

/**
 * A property name as stored: Unicode-normalized (NFC), inner whitespace collapsed to single
 * spaces, trimmed. Returns `null` when nothing usable is left, the name is too long, or it holds
 * control, format (zero-width, bidirectional override) or line-separator characters.
 */
export function normalizePropertyName(value: string): string | null {
  const name = value.normalize('NFC').replace(/\s+/gu, ' ').trim();
  if (name.length === 0 || name.length > MAX_PROPERTY_NAME_LENGTH) return null;
  if (/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(name)) return null;
  return name;
}

/** What two names are compared by: the same property typed in a different case counts as one. */
export function propertyNameKey(name: string): string {
  return name.normalize('NFC').toLowerCase();
}
