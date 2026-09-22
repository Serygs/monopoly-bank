import type { AmountUnit } from './preferences';

export interface AmountInputState { digits: string; unit: AmountUnit; }

const maxMoneyInput = 9_999_999_999;

export const AMOUNT_UNIT_FACTOR: Record<AmountUnit, number> = { THOUSANDS: 1, MILLIONS: 1000 };

export function maxDigitsFor(unit: AmountUnit): number { return Math.floor(maxMoneyInput / AMOUNT_UNIT_FACTOR[unit]); }

export function appendMoneyDigit(digits: string, digit: string, unit: AmountUnit): string {
  if (!/^\d$/.test(digit)) return digits;
  const normalized = digits.replace(/^0+/, '');
  const next = `${normalized}${digit}`.replace(/^0+(?=\d)/, '');
  return Number(next) > maxDigitsFor(unit) ? normalized : next;
}

export function removeMoneyDigit(digits: string): string { return digits.slice(0, -1); }

export function sanitizeMoneyInput(value: string, unit: AmountUnit): string {
  const digits = value.replace(/\D/g, '').replace(/^0+(?=\d)/, '');
  const max = maxDigitsFor(unit);
  return Number(digits) > max ? String(max) : digits;
}

export function toCanonicalAmount(state: AmountInputState): string {
  return state.digits === '' ? '' : String(Number(state.digits) * AMOUNT_UNIT_FACTOR[state.unit]);
}

export function changeAmountUnit(state: AmountInputState, unit: AmountUnit): AmountInputState {
  return state.unit === unit ? state : { digits: '', unit };
}

export function syncCanonicalAmount(state: AmountInputState, canonical: string): AmountInputState {
  return toCanonicalAmount(state) === canonical ? state : { digits: canonical, unit: 'THOUSANDS' };
}
