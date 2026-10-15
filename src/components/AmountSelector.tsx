import { useId } from 'react';
import type { Currency } from '../../shared/types/monopoly';
import { useLanguage } from '../i18n/language-context';
import { formatMoney } from '../utils/money';
import { readAmountUnit, writeAmountUnit } from '../utils/preferences';
import { mergeQuickAmounts } from '../utils/quick-amounts';
import { AmountInput } from './AmountInput';
import { useAmountInput } from './amount-input-state';
import { NumericKeypad } from './NumericKeypad';
import { MoneyValue } from './ui';
import { cx } from './ui/class-names';

const standardAmounts = [100_000, 200_000, 500_000, 1_000_000, 2_000_000] as const;

/* The amount reads large; `dialog-field` keeps the shared input chrome. */
const amountFieldClass = cx(
  'dialog-field amount-field-large',
  '[&_input]:font-money [&_input]:text-[1.5rem] [&_input]:font-bold [&_input]:tabular-nums',
);
/* The total the transfer will move, right under the field so it never needs scrolling to. */
const totalClass =
  'min-w-0 font-money text-[1.0625rem] font-bold tracking-[-0.01em] text-primary tabular-nums wrap-anywhere';
const clearClass = cx(
  'inline-flex min-h-(--mb-control-height-md) items-center rounded-control border-0 bg-transparent px-(--mb-space-2) font-semibold text-secondary',
  'disabled:cursor-not-allowed disabled:opacity-48 fine-pointer:enabled:hover:text-primary',
);
const chipClass = cx(
  'inline-flex min-h-(--mb-control-height-md) shrink-0 snap-start items-center gap-[6px] rounded-pill border border-border bg-surface-elevated px-[14px] py-[7px] font-semibold text-primary',
  'transition-[color,background-color,border-color,box-shadow,transform] duration-(--mb-duration-fast) ease-standard motion-reduce:transition-none',
  'aria-pressed:border-accent aria-pressed:bg-accent aria-pressed:text-on-accent',
);
const favoriteToggleClass = cx(
  'inline-flex min-h-(--mb-control-height-md) min-w-(--mb-control-height-md) items-center justify-center rounded-control border border-border bg-surface-elevated text-[1.15rem] text-accent',
  'transition-[color,background-color,border-color] duration-(--mb-duration-fast) ease-standard motion-reduce:transition-none',
  'disabled:cursor-not-allowed disabled:opacity-48',
);
/* One row that scrolls sideways; the scrollbar stays out of the way on touch screens. */
const chipRowClass =
  '-mx-[2px] flex gap-2 overflow-x-auto overscroll-x-contain px-[2px] pb-[2px] snap-x [scrollbar-width:none] [&::-webkit-scrollbar]:hidden';

export function AmountSelector({
  value,
  onChange,
  favorites = [],
  recent = [],
  onToggleFavorite,
  onQuickAmountSelect,
  currency,
  presets = standardAmounts,
}: {
  value: string;
  onChange: (value: string) => void;
  favorites?: number[];
  recent?: number[];
  onToggleFavorite?: (amount: number) => void;
  onQuickAmountSelect?: (amount: number) => void;
  currency: Currency;
  /** Quick amounts after the favourites and recent ones; defaults to fixed round amounts. */
  presets?: readonly number[];
}) {
  const { t } = useLanguage();
  const inputId = useId();
  const {
    state: synced,
    changeDigits,
    changeUnit,
  } = useAmountInput(value, onChange, readAmountUnit, writeAmountUnit);
  const selected = Number(value);
  const hasAmount = Number.isSafeInteger(selected) && selected > 0;
  const isFavorite = hasAmount && favorites.includes(selected);
  const quickAmounts = mergeQuickAmounts(favorites, recent, presets);
  return (
    <div className="grid gap-(--mb-space-3)">
      <div className={amountFieldClass}>
        <label htmlFor={inputId} className="sr-only">
          {t('amount')}
        </label>
        <AmountInput
          id={inputId}
          state={synced}
          onDigitsChange={changeDigits}
          onUnitChange={changeUnit}
          keypad
        />
      </div>
      <div className="flex min-h-(--mb-control-height-md) items-center justify-between gap-(--mb-space-3)">
        {hasAmount ? (
          <strong className={totalClass} aria-live="polite">
            {t('amountFullHint', { amount: formatMoney(selected, currency) })}
          </strong>
        ) : (
          <span />
        )}
        <div className="flex items-center gap-(--mb-space-2)">
          <button
            type="button"
            className={clearClass}
            disabled={synced.digits === ''}
            onClick={() => changeDigits('')}
          >
            {t('clear')}
          </button>
          {onToggleFavorite !== undefined && (
            <button
              type="button"
              className={favoriteToggleClass}
              disabled={!hasAmount}
              aria-pressed={isFavorite}
              aria-label={
                isFavorite
                  ? t('removeFavoriteAmount', { amount: formatMoney(selected, currency) })
                  : t('addFavoriteAmount', { amount: formatMoney(selected, currency) })
              }
              onClick={() => onToggleFavorite(selected)}
            >
              {isFavorite ? '★' : '☆'}
            </button>
          )}
        </div>
      </div>
      <NumericKeypad digits={synced.digits} unit={synced.unit} onChange={changeDigits} />
      <div className={chipRowClass} role="group" aria-label={t('quickAmounts')}>
        {quickAmounts.map((amount) => (
          <button
            key={amount}
            type="button"
            className={chipClass}
            aria-pressed={selected === amount}
            onClick={() => {
              onChange(String(amount));
              onQuickAmountSelect?.(amount);
            }}
          >
            {favorites.includes(amount) && <span aria-hidden="true">★</span>}
            <MoneyValue amount={amount} currency={currency} />
          </button>
        ))}
      </div>
    </div>
  );
}
