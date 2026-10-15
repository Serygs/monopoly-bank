import type { AmountUnit } from './preferences';

export interface AmountInputState {
  digits: string;
  unit: AmountUnit;
}

const maxMoneyInput = 9_999_999_999;

export const AMOUNT_UNIT_FACTOR: Record<AmountUnit, number> = {
  ONES: 1,
  THOUSANDS: 1_000,
  MILLIONS: 1_000_000,
};

export function maxDigitsFor(unit: AmountUnit): number {
  return Math.floor(maxMoneyInput / AMOUNT_UNIT_FACTOR[unit]);
}

/** Fraction digits that keep the canonical amount a whole number: 3 for thousands, 6 for millions. */
const FRACTION_DIGITS: Record<AmountUnit, number> = { ONES: 0, THOUSANDS: 3, MILLIONS: 6 };

export function maxFractionDigits(unit: AmountUnit): number {
  return FRACTION_DIGITS[unit];
}

/** The whole-unit amount the typed digits stand for (a decimal such as `3.2` M is 3 200 000). */
function canonicalNumber(digits: string, unit: AmountUnit): number {
  return Math.round(Number(digits === '' ? '0' : digits) * AMOUNT_UNIT_FACTOR[unit]);
}

function fitsLimit(digits: string, unit: AmountUnit): boolean {
  return canonicalNumber(digits, unit) <= maxMoneyInput;
}

export function appendMoneyDigit(digits: string, digit: string, unit: AmountUnit): string {
  if (!/^\d$/.test(digit)) return digits;
  if (digits.includes('.')) {
    const fraction = digits.slice(digits.indexOf('.') + 1);
    if (fraction.length >= maxFractionDigits(unit)) return digits;
    const next = `${digits}${digit}`;
    return fitsLimit(next, unit) ? next : digits;
  }
  const normalized = digits.replace(/^0+/, '');
  const next = `${normalized}${digit}`.replace(/^0+(?=\d)/, '');
  return fitsLimit(next, unit) ? next : normalized;
}

/** Starts the fraction (`3` → `3.`); ignored for whole units and when one is already typed. */
export function appendDecimalSeparator(digits: string, unit: AmountUnit): string {
  if (maxFractionDigits(unit) === 0 || digits.includes('.')) return digits;
  return digits === '' ? '0.' : `${digits}.`;
}

export function removeMoneyDigit(digits: string): string {
  return digits.slice(0, -1);
}

/** Keeps digits and the first `,` or `.`, trimmed to the unit's fraction digits and the amount limit. */
export function sanitizeMoneyInput(value: string, unit: AmountUnit): string {
  const cleaned = value.replace(/[^\d.,]/g, '').replace(/,/g, '.');
  const dot = cleaned.indexOf('.');
  const wholeRaw = (dot === -1 ? cleaned : cleaned.slice(0, dot)).replace(/\./g, '');
  const whole = wholeRaw.replace(/^0+(?=\d)/, '');
  const places = maxFractionDigits(unit);
  if (dot === -1 || places === 0) return capToLimit(whole, unit);
  const fraction = cleaned
    .slice(dot + 1)
    .replace(/\./g, '')
    .slice(0, places);
  return capToLimit(`${whole === '' ? '0' : whole}.${fraction}`, unit);
}

function capToLimit(digits: string, unit: AmountUnit): string {
  return fitsLimit(digits, unit) ? digits : String(maxDigitsFor(unit));
}

export function toCanonicalAmount(state: AmountInputState): string {
  return state.digits === '' ? '' : String(canonicalNumber(state.digits, state.unit));
}

/** Writes a whole-unit amount in `unit`, with a fraction when it does not divide evenly. */
export function canonicalToDigits(canonical: number, unit: AmountUnit): string {
  const factor = AMOUNT_UNIT_FACTOR[unit];
  const whole = Math.floor(canonical / factor);
  const remainder = canonical % factor;
  if (remainder === 0) return String(whole);
  const fraction = String(remainder).padStart(maxFractionDigits(unit), '0').replace(/0+$/, '');
  return `${whole}.${fraction}`;
}

/** Switching the unit keeps the amount and re-expresses it: 85 000 → `85` in thousands. */
export function changeAmountUnit(state: AmountInputState, unit: AmountUnit): AmountInputState {
  if (state.unit === unit) return state;
  const canonical = canonicalNumber(state.digits, state.unit);
  return state.digits === '' || canonical === 0
    ? { digits: '', unit }
    : { digits: canonicalToDigits(canonical, unit), unit };
}

/** Typed digits for display: grouped whole part and the locale's decimal separator. */
export function formatDigitsDisplay(digits: string, decimalSeparator: string): string {
  if (digits === '') return '';
  const dot = digits.indexOf('.');
  const whole = (dot === -1 ? digits : digits.slice(0, dot)).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  return dot === -1 ? whole : `${whole}${decimalSeparator}${digits.slice(dot + 1)}`;
}

/** Expresses a canonical amount in the preferred unit when it divides evenly, otherwise in whole units. */
export function fromCanonicalAmount(canonical: string, preferred: AmountUnit): AmountInputState {
  if (canonical === '') return { digits: '', unit: preferred };
  const factor = AMOUNT_UNIT_FACTOR[preferred];
  const amount = Number(canonical);
  return amount % factor === 0
    ? { digits: String(amount / factor), unit: preferred }
    : { digits: canonical, unit: 'ONES' };
}

export function syncCanonicalAmount(state: AmountInputState, canonical: string): AmountInputState {
  return toCanonicalAmount(state) === canonical
    ? state
    : fromCanonicalAmount(canonical, state.unit);
}
