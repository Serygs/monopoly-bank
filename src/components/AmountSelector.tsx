import type { Currency } from '../../shared/types/monopoly';
import { useLanguage } from '../i18n/language-context';
import { formatMoney, formatThousands } from '../utils/money';
import { sanitizeMoneyInput } from '../utils/money-input';
import { NumericKeypad } from './NumericKeypad';

const standardAmounts = [10, 20, 50, 100, 200] as const;

export function AmountSelector({ value, onChange, favorites = [], recent = [], onToggleFavorite, onQuickAmountSelect, currency }: { value: string; onChange: (value: string) => void; favorites?: number[]; recent?: number[]; onToggleFavorite?: (amount: number) => void; onQuickAmountSelect?: (amount: number) => void; currency: Currency }) {
  const { t } = useLanguage();
  const selected = Number(value);
  const unique = (amounts: readonly number[]) => amounts.filter((amount, index) => amounts.indexOf(amount) === index && amount > 0);
  const renderAmounts = (amounts: readonly number[]) => unique(amounts).map((amount) => <span className="amount-choice" key={amount}><button type="button" className={`amount-chip ${selected === amount ? 'selected' : ''}`} aria-pressed={selected === amount} onClick={() => { onChange(String(amount)); onQuickAmountSelect?.(amount); }}>{formatMoney(amount, currency)}</button>{onToggleFavorite !== undefined && <button type="button" className="favorite-toggle" aria-label={favorites.includes(amount) ? t('removeFavoriteAmount', { amount: formatMoney(amount, currency) }) : t('addFavoriteAmount', { amount: formatMoney(amount, currency) })} onClick={() => onToggleFavorite(amount)}>{favorites.includes(amount) ? '★' : '☆'}</button>}</span>);
  return <div className="amount-selector"><label className="dialog-field">{t('amount')} <span className="field-note">{t('inThousands')}</span><input type="text" inputMode="numeric" pattern="[0-9 ]*" value={value === '' ? '' : formatThousands(Number(value))} onChange={(event) => onChange(sanitizeMoneyInput(event.target.value))} /></label><NumericKeypad value={value} onChange={onChange} /><div className="amount-section"><span>{t('quickAmounts')}</span><div>{renderAmounts(standardAmounts)}</div></div>{favorites.length > 0 && <div className="amount-section"><span>{t('favoriteAmounts')}</span><div>{renderAmounts(favorites)}</div></div>}{recent.length > 0 && <div className="amount-section"><span>{t('recentAmounts')}</span><div>{renderAmounts(recent)}</div></div>}</div>;
}
