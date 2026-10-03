import type { ReactNode } from 'react';
import { useLanguage } from '../i18n/language-context';
import { appendMoneyDigit, removeMoneyDigit } from '../utils/money-input';
import type { AmountUnit } from '../utils/preferences';
import { keyButtonClass } from './ui/class-names';

const keypadClass = 'grid grid-cols-[repeat(3,1fr)] content-start gap-[6px] max-md:row-start-2';

export function NumericKeypad({
  digits,
  unit,
  onChange,
}: {
  digits: string;
  unit: AmountUnit;
  onChange: (digits: string) => void;
}) {
  const { t } = useLanguage();
  return (
    <div className={keypadClass} role="group" aria-label={t('numericKeypad')}>
      <>
        {[...'123456789'].map((digit) => (
          <KeypadKey key={digit} onPress={() => onChange(appendMoneyDigit(digits, digit, unit))}>
            {digit}
          </KeypadKey>
        ))}
      </>
      <KeypadKey label={t('keypadBackspace')} onPress={() => onChange(removeMoneyDigit(digits))}>
        ⌫
      </KeypadKey>
      <KeypadKey onPress={() => onChange(appendMoneyDigit(digits, '0', unit))}>0</KeypadKey>
      <KeypadKey onPress={() => onChange('')}>{t('clear')}</KeypadKey>
    </div>
  );
}

/** One key of the keypad; `label` names a key whose face is a symbol. */
function KeypadKey({
  label,
  onPress,
  children,
}: {
  label?: string;
  onPress: () => void;
  children: ReactNode;
}) {
  return (
    <button type="button" className={keyButtonClass} aria-label={label} onClick={onPress}>
      {children}
    </button>
  );
}
