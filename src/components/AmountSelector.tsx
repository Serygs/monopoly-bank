import { useId, useState } from 'react';
import type { Currency } from '../../shared/types/monopoly';
import { useLanguage } from '../i18n/language-context';
import type { TranslationKey } from '../i18n/translations';
import { formatMoney, formatThousands } from '../utils/money';
import { changeAmountUnit, sanitizeMoneyInput, syncCanonicalAmount, toCanonicalAmount, type AmountInputState } from '../utils/money-input';
import { readAmountUnit, writeAmountUnit, type AmountUnit } from '../utils/preferences';
import { NumericKeypad } from './NumericKeypad';

const standardAmounts = [10, 20, 50, 100, 200] as const;
const unitLabels: Record<AmountUnit, { short: TranslationKey; full: TranslationKey; note: TranslationKey }> = {
  THOUSANDS: { short: 'amountUnitThousandsShort', full: 'amountUnitThousands', note: 'inThousands' },
  MILLIONS: { short: 'amountUnitMillionsShort', full: 'amountUnitMillions', note: 'inMillions' },
};
const units = Object.keys(unitLabels) as AmountUnit[];

export function AmountSelector({ value, onChange, favorites = [], recent = [], onToggleFavorite, onQuickAmountSelect, currency }: { value: string; onChange: (value: string) => void; favorites?: number[]; recent?: number[]; onToggleFavorite?: (amount: number) => void; onQuickAmountSelect?: (amount: number) => void; currency: Currency }) {
  const { t } = useLanguage();
  const inputId = useId();
  // A non-empty initial value is canonical thousands, so the stored unit only applies to an empty field.
  const [state, setState] = useState<AmountInputState>(() => syncCanonicalAmount({ digits: '', unit: readAmountUnit() }, value));
  // Adjust state while rendering when the canonical value changes outside (quick chips, action reset).
  const synced = syncCanonicalAmount(state, value);
  if (synced !== state) setState(synced);
  const changeDigits = (digits: string) => { const next = { ...synced, digits }; setState(next); onChange(toCanonicalAmount(next)); };
  const changeUnit = (unit: AmountUnit) => { if (unit === synced.unit) return; const next = changeAmountUnit(synced, unit); setState(next); writeAmountUnit(unit); onChange(toCanonicalAmount(next)); };
  const selected = Number(value);
  const unique = (amounts: readonly number[]) => amounts.filter((amount, index) => amounts.indexOf(amount) === index && amount > 0);
  const renderAmounts = (amounts: readonly number[]) => unique(amounts).map((amount) => <span className="amount-choice" key={amount}><button type="button" className={`amount-chip ${selected === amount ? 'selected' : ''}`} aria-pressed={selected === amount} onClick={() => { onChange(String(amount)); onQuickAmountSelect?.(amount); }}>{formatMoney(amount, currency)}</button>{onToggleFavorite !== undefined && <button type="button" className="favorite-toggle" aria-label={favorites.includes(amount) ? t('removeFavoriteAmount', { amount: formatMoney(amount, currency) }) : t('addFavoriteAmount', { amount: formatMoney(amount, currency) })} onClick={() => onToggleFavorite(amount)}>{favorites.includes(amount) ? '★' : '☆'}</button>}</span>);
  return <div className="amount-selector"><div className="dialog-field amount-field"><label htmlFor={inputId}>{t('amount')} <span className="field-note">{t(unitLabels[synced.unit].note)}</span></label><div className="amount-field-row"><span className="amount-input-wrap"><input id={inputId} type="text" inputMode="numeric" pattern="[0-9 ]*" value={synced.digits === '' ? '' : formatThousands(Number(synced.digits))} onChange={(event) => changeDigits(sanitizeMoneyInput(event.target.value, synced.unit))} /><span className="amount-unit-suffix" aria-hidden="true">{t(unitLabels[synced.unit].short)}</span></span><div className="amount-unit-toggle" role="group" aria-label={t('amountUnitGroup')}>{units.map((unit) => <button key={unit} type="button" aria-pressed={synced.unit === unit} aria-label={t(unitLabels[unit].full)} onClick={() => changeUnit(unit)}>{t(unitLabels[unit].short)}</button>)}</div></div></div><NumericKeypad digits={synced.digits} unit={synced.unit} onChange={changeDigits} /><div className="amount-section"><span>{t('quickAmounts')}</span><div>{renderAmounts(standardAmounts)}</div></div>{favorites.length > 0 && <div className="amount-section"><span>{t('favoriteAmounts')}</span><div>{renderAmounts(favorites)}</div></div>}{recent.length > 0 && <div className="amount-section"><span>{t('recentAmounts')}</span><div>{renderAmounts(recent)}</div></div>}</div>;
}
