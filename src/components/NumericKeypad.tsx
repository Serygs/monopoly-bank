import { useLanguage } from '../i18n/language-context';
import { appendMoneyDigit, removeMoneyDigit } from '../utils/money-input';

export function NumericKeypad({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const { t } = useLanguage();
  return <div className="numeric-keypad" role="group" aria-label={t('numericKeypad')}><>{[...'123456789'].map((digit) => <button key={digit} type="button" onClick={() => onChange(appendMoneyDigit(value, digit))}>{digit}</button>)}</><button type="button" aria-label={t('keypadBackspace')} onClick={() => onChange(removeMoneyDigit(value))}>⌫</button><button type="button" onClick={() => onChange(appendMoneyDigit(value, '0'))}>0</button><button type="button" onClick={() => onChange('')}>{t('clear')}</button></div>;
}
