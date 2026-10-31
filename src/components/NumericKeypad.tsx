import type { ReactNode } from 'react';
import { useLanguage } from '../i18n/language-context';
import { decimalSeparator } from '../utils/money';
import {
  appendDecimalSeparator,
  appendMoneyDigit,
  maxFractionDigits,
  removeMoneyDigit,
} from '../utils/money-input';
import type { AmountUnit } from '../utils/preferences';
import { cx, keyButtonClass } from './ui/class-names';

const keypadClass =
  'grid grid-cols-[repeat(3,1fr)] content-start gap-[6px] [&>button]:min-h-12 md:mx-auto md:w-[min(100%,360px)]';

export function NumericKeypad({
  digits,
  unit,
  onChange,
}: {
  digits: string;
  unit: AmountUnit;
  onChange: (digits: string) => void;
}) {
  const { t, locale } = useLanguage();
  const separator = decimalSeparator(locale);
  const decimalDisabled = maxFractionDigits(unit) === 0 || digits.includes('.');
  return (
    <div
      className={keypadClass}
      role="group"
      aria-label={t('numericKeypad')}
      onKeyDown={(event) => {
        // A focused key still takes Enter and Space itself; the rest types like the input would.
        if (event.ctrlKey || event.metaKey || event.altKey) return;
        if (/^[0-9]$/u.test(event.key)) onChange(appendMoneyDigit(digits, event.key, unit));
        else if (event.key === 'Backspace') onChange(removeMoneyDigit(digits));
        else if ((event.key === '.' || event.key === ',') && !decimalDisabled)
          onChange(appendDecimalSeparator(digits, unit));
        else return;
        event.preventDefault();
      }}
    >
      <>
        {[...'123456789'].map((digit) => (
          <KeypadKey key={digit} onPress={() => onChange(appendMoneyDigit(digits, digit, unit))}>
            {digit}
          </KeypadKey>
        ))}
      </>
      <KeypadKey
        label={t('keypadDecimal')}
        disabled={decimalDisabled}
        onPress={() => onChange(appendDecimalSeparator(digits, unit))}
      >
        {separator}
      </KeypadKey>
      <KeypadKey onPress={() => onChange(appendMoneyDigit(digits, '0', unit))}>0</KeypadKey>
      <KeypadKey label={t('keypadBackspace')} onPress={() => onChange(removeMoneyDigit(digits))}>
        ⌫
      </KeypadKey>
    </div>
  );
}

/** One key of the keypad; `label` names a key whose face is a symbol. */
function KeypadKey({
  label,
  disabled = false,
  onPress,
  children,
}: {
  label?: string;
  disabled?: boolean;
  onPress: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={cx(keyButtonClass, 'disabled:cursor-not-allowed disabled:opacity-48')}
      aria-label={label}
      disabled={disabled}
      onClick={onPress}
    >
      {children}
    </button>
  );
}
