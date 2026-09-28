import { useState } from 'react';
import type { TranslationKey } from '../i18n/translations';
import {
  changeAmountUnit,
  syncCanonicalAmount,
  toCanonicalAmount,
  type AmountInputState,
} from '../utils/money-input';
import type { AmountUnit } from '../utils/preferences';

export const AMOUNT_UNIT_LABELS: Record<
  AmountUnit,
  { short: TranslationKey; full: TranslationKey; note?: TranslationKey }
> = {
  ONES: { short: 'amountUnitOnesShort', full: 'amountUnitOnes' },
  THOUSANDS: {
    short: 'amountUnitThousandsShort',
    full: 'amountUnitThousands',
    note: 'inThousands',
  },
  MILLIONS: { short: 'amountUnitMillionsShort', full: 'amountUnitMillions', note: 'inMillions' },
};
export const AMOUNT_UNITS = Object.keys(AMOUNT_UNIT_LABELS) as AmountUnit[];

/** Keeps the typed digits and unit in step with a canonical whole-unit amount string. */
export function useAmountInput(
  value: string,
  onChange: (value: string) => void,
  initialUnit: () => AmountUnit,
  onUnitChange?: (unit: AmountUnit) => void,
) {
  // A non-empty initial value is a canonical whole amount, so the initial unit only applies when it divides evenly.
  const [state, setState] = useState<AmountInputState>(() =>
    syncCanonicalAmount({ digits: '', unit: initialUnit() }, value),
  );
  // Adjust state while rendering when the canonical value changes outside (quick chips, action reset).
  const synced = syncCanonicalAmount(state, value);
  if (synced !== state) setState(synced);
  const changeDigits = (digits: string) => {
    const next = { ...synced, digits };
    setState(next);
    onChange(toCanonicalAmount(next));
  };
  const changeUnit = (unit: AmountUnit) => {
    if (unit === synced.unit) return;
    const next = changeAmountUnit(synced, unit);
    setState(next);
    onUnitChange?.(unit);
    onChange(toCanonicalAmount(next));
  };
  return { state: synced, changeDigits, changeUnit };
}
