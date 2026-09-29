import { useId, type ReactNode } from 'react';
import type { Currency } from '../../shared/types/monopoly';
import { useLanguage } from '../i18n/language-context';
import { formatMoney } from '../utils/money';
import { readAmountUnit, writeAmountUnit } from '../utils/preferences';
import { AmountInput } from './AmountInput';
import { AMOUNT_UNIT_LABELS, useAmountInput } from './amount-input-state';
import { NumericKeypad } from './NumericKeypad';
import { FieldNote, MoneyValue } from './ui';
import { cx } from './ui/class-names';

const standardAmounts = [100_000, 200_000, 500_000, 1_000_000, 2_000_000] as const;

const quickButtonClass = cx(
  'border border-border bg-surface-elevated',
  'transition-[color,background-color,border-color,box-shadow,transform] duration-(--mb-duration-fast) ease-standard',
  'disabled:cursor-not-allowed disabled:opacity-48 motion-reduce:transition-none',
);
const amountChipClass = cx(
  quickButtonClass,
  'min-h-(--mb-control-height-md) rounded-[9px] px-[10px] py-[7px] font-semibold text-primary',
  'aria-pressed:bg-accent aria-pressed:text-on-accent',
);
const favoriteToggleClass = cx(
  quickButtonClass,
  'min-w-(--mb-control-height-md) rounded-[0_9px_9px_0] border-s-0 text-[1.05rem] text-accent',
);
/* One quick-amount row: its label, then the wrapping chips (each chip plus its favourite toggle). */
const sectionClass = cx(
  'col-span-full [&>span]:mb-2 [&>span]:block [&>span]:text-[0.85rem] [&>span]:font-semibold [&>span]:text-secondary',
  '[&>div]:flex [&>div]:flex-wrap [&>div]:gap-2 [&>div>span]:inline-flex',
);

function AmountSection({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={sectionClass}>
      <span>{label}</span>
      <div>{children}</div>
    </div>
  );
}

export function AmountSelector({
  value,
  onChange,
  favorites = [],
  recent = [],
  onToggleFavorite,
  onQuickAmountSelect,
  currency,
}: {
  value: string;
  onChange: (value: string) => void;
  favorites?: number[];
  recent?: number[];
  onToggleFavorite?: (amount: number) => void;
  onQuickAmountSelect?: (amount: number) => void;
  currency: Currency;
}) {
  const { t } = useLanguage();
  const inputId = useId();
  const {
    state: synced,
    changeDigits,
    changeUnit,
  } = useAmountInput(value, onChange, readAmountUnit, writeAmountUnit);
  const unitNote = AMOUNT_UNIT_LABELS[synced.unit].note;
  const selected = Number(value);
  const unique = (amounts: readonly number[]) =>
    amounts.filter((amount, index) => amounts.indexOf(amount) === index && amount > 0);
  const renderAmounts = (amounts: readonly number[]) =>
    unique(amounts).map((amount) => (
      <span key={amount}>
        <button
          type="button"
          className={amountChipClass}
          aria-pressed={selected === amount}
          onClick={() => {
            onChange(String(amount));
            onQuickAmountSelect?.(amount);
          }}
        >
          <MoneyValue amount={amount} currency={currency} />
        </button>
        {onToggleFavorite !== undefined && (
          <button
            type="button"
            className={favoriteToggleClass}
            aria-label={
              favorites.includes(amount)
                ? t('removeFavoriteAmount', { amount: formatMoney(amount, currency) })
                : t('addFavoriteAmount', { amount: formatMoney(amount, currency) })
            }
            onClick={() => onToggleFavorite(amount)}
          >
            {favorites.includes(amount) ? '★' : '☆'}
          </button>
        )}
      </span>
    ));
  return (
    <div className="grid grid-cols-[minmax(0,1fr)_168px] gap-4 max-md:grid-cols-1">
      <div className="dialog-field col-span-full">
        <label htmlFor={inputId}>
          {t('amount')}
          {unitNote !== undefined && (
            <>
              {' '}
              <FieldNote>{t(unitNote)}</FieldNote>
            </>
          )}
        </label>
        <AmountInput
          id={inputId}
          state={synced}
          onDigitsChange={changeDigits}
          onUnitChange={changeUnit}
        />
      </div>
      <NumericKeypad digits={synced.digits} unit={synced.unit} onChange={changeDigits} />
      <AmountSection label={t('quickAmounts')}>{renderAmounts(standardAmounts)}</AmountSection>
      {favorites.length > 0 && (
        <AmountSection label={t('favoriteAmounts')}>{renderAmounts(favorites)}</AmountSection>
      )}
      {recent.length > 0 && (
        <AmountSection label={t('recentAmounts')}>{renderAmounts(recent)}</AmountSection>
      )}
    </div>
  );
}
