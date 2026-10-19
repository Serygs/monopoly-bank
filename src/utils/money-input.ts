import type { AmountUnit } from './preferences';
import { groupThousands } from './money';

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

/**
 * The whole-unit amount the typed digits stand for (a decimal such as `3.2` M is 3 200 000), parsed
 * from the whole and fraction parts without floating point. `null` when the digits do not make a
 * whole amount in `unit` (`1.5` in ones) or exceed the amount limit.
 */
function canonicalNumber(digits: string, unit: AmountUnit): number | null {
  const dot = digits.indexOf('.');
  const whole = dot === -1 ? digits : digits.slice(0, dot);
  const fraction = dot === -1 ? '' : digits.slice(dot + 1);
  const places = maxFractionDigits(unit);
  if (fraction.length > places) return null;
  const amount =
    Number(whole === '' ? '0' : whole) * AMOUNT_UNIT_FACTOR[unit] +
    (places === 0 ? 0 : Number(fraction.padEnd(places, '0')));
  return amount <= maxMoneyInput ? amount : null;
}

function fitsLimit(digits: string, unit: AmountUnit): boolean {
  return canonicalNumber(digits, unit) !== null;
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

/** The canonical whole amount, or `''` when nothing is typed or the digits are not a valid amount in the unit. */
export function toCanonicalAmount(state: AmountInputState): string {
  if (state.digits === '') return '';
  const amount = canonicalNumber(state.digits, state.unit);
  return amount === null ? '' : String(amount);
}

/** Typed digits that cannot be an amount in the chosen unit, e.g. `1.5` after switching to ones. */
export function isUnrepresentableAmount(state: AmountInputState): boolean {
  return state.digits !== '' && canonicalNumber(state.digits, state.unit) === null;
}

/** Switching the unit changes only the multiplier; the typed digits stay: `3` M → `3` K → `3` M. */
export function changeAmountUnit(state: AmountInputState, unit: AmountUnit): AmountInputState {
  return state.unit === unit ? state : { digits: state.digits, unit };
}

/** Typed digits for display: grouped whole part and the locale's decimal separator. */
export function formatDigitsDisplay(digits: string, decimalSeparator: string): string {
  if (digits === '') return '';
  const dot = digits.indexOf('.');
  const whole = groupThousands(dot === -1 ? digits : digits.slice(0, dot));
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
