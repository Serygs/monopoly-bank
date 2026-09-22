import { useLanguage } from '../i18n/language-context';
import { appendMoneyDigit, removeMoneyDigit } from '../utils/money-input';
import type { AmountUnit } from '../utils/preferences';

export function NumericKeypad({ digits, unit, onChange }: { digits: string; unit: AmountUnit; onChange: (digits: string) => void }) {
  const { t } = useLanguage();
  return <div className="numeric-keypad" role="group" aria-label={t('numericKeypad')}><>{[...'123456789'].map((digit) => <button key={digit} type="button" onClick={() => onChange(appendMoneyDigit(digits, digit, unit))}>{digit}</button>)}</><button type="button" aria-label={t('keypadBackspace')} onClick={() => onChange(removeMoneyDigit(digits))}>⌫</button><button type="button" onClick={() => onChange(appendMoneyDigit(digits, '0', unit))}>0</button><button type="button" onClick={() => onChange('')}>{t('clear')}</button></div>;
}
