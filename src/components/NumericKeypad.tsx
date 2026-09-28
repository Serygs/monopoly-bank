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
          <button
            key={digit}
            type="button"
            className={keyButtonClass}
            onClick={() => onChange(appendMoneyDigit(digits, digit, unit))}
          >
            {digit}
          </button>
        ))}
      </>
      <button
        type="button"
        className={keyButtonClass}
        aria-label={t('keypadBackspace')}
        onClick={() => onChange(removeMoneyDigit(digits))}
      >
        ⌫
      </button>
      <button
        type="button"
        className={keyButtonClass}
        onClick={() => onChange(appendMoneyDigit(digits, '0', unit))}
      >
        0
      </button>
      <button type="button" className={keyButtonClass} onClick={() => onChange('')}>
        {t('clear')}
      </button>
    </div>
  );
}
