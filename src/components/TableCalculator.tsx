import { useState } from 'react';
import { useLanguage } from '../i18n/language-context';

const operations = ['+', '−', '×', '÷'] as const;
type Operation = (typeof operations)[number];

export function TableCalculator() {
  const { t } = useLanguage();
  const [first, setFirst] = useState(''); const [second, setSecond] = useState(''); const [operation, setOperation] = useState<Operation>('×');
  const left = Number(first); const right = Number(second); const valid = Number.isFinite(left) && Number.isFinite(right) && first !== '' && second !== '' && (operation !== '÷' || right !== 0);
  const result = !valid ? null : operation === '+' ? left + right : operation === '−' ? left - right : operation === '×' ? left * right : left / right;
  const numberInput = (value: string, setValue: (next: string) => void, label: string) => <input aria-label={label} inputMode="decimal" value={value} onChange={(event) => setValue(event.target.value.replace(/[^0-9.]/g, ''))} />;
  return <section className="table-calculator" aria-label={t('calculator')}><div><p className="eyebrow">{t('tableTool')}</p><h2>{t('calculator')}</h2><p className="muted">{t('calculatorDescription')}</p></div><div className="calculator-controls">{numberInput(first, setFirst, t('firstNumber'))}<div className="calculator-operations" role="group" aria-label={t('calculatorOperation')}>{operations.map((item) => <button type="button" key={item} className={operation === item ? 'selected' : ''} aria-pressed={operation === item} onClick={() => setOperation(item)}>{item}</button>)}</div>{numberInput(second, setSecond, t('secondNumber'))}<output aria-live="polite">= {result === null ? '—' : Number.isInteger(result) ? result : result.toFixed(2)}</output></div></section>;
}
