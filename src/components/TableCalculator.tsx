import { useState } from 'react';
import { useLanguage } from '../i18n/language-context';
import { ToolPanel } from './ui';
import { cx, keyButtonClass } from './ui/class-names';

const operations = ['+', '−', '×', '÷'] as const;
const controlsClass =
  'calculator-controls grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto] items-center gap-2 max-md:grid-cols-1';
type Operation = (typeof operations)[number];

export function TableCalculator() {
  const { t } = useLanguage();
  const [first, setFirst] = useState('');
  const [second, setSecond] = useState('');
  const [operation, setOperation] = useState<Operation>('×');
  const left = Number(first);
  const right = Number(second);
  const valid =
    Number.isFinite(left) &&
    Number.isFinite(right) &&
    first !== '' &&
    second !== '' &&
    (operation !== '÷' || right !== 0);
  const result = !valid
    ? null
    : operation === '+'
      ? left + right
      : operation === '−'
        ? left - right
        : operation === '×'
          ? left * right
          : left / right;
  const numberInput = (value: string, setValue: (next: string) => void, label: string) => (
    <input
      aria-label={label}
      inputMode="decimal"
      value={value}
      onChange={(event) => setValue(event.target.value.replace(/[^0-9.]/g, ''))}
    />
  );
  return (
    <ToolPanel
      label={t('calculator')}
      eyebrow={t('tableTool')}
      title={t('calculator')}
      description={t('calculatorDescription')}
    >
      {/* `calculator-controls` keeps the shared text-input rules in primitives.css. */}
      <div className={controlsClass}>
        {numberInput(first, setFirst, t('firstNumber'))}
        <div
          className="grid grid-cols-[repeat(2,1fr)] gap-1 max-md:grid-cols-[repeat(4,1fr)]"
          role="group"
          aria-label={t('calculatorOperation')}
        >
          {operations.map((item) => (
            <button
              type="button"
              key={item}
              className={cx(keyButtonClass, 'aria-pressed:bg-accent aria-pressed:text-on-accent')}
              aria-pressed={operation === item}
              onClick={() => setOperation(item)}
            >
              {item}
            </button>
          ))}
        </div>
        {numberInput(second, setSecond, t('secondNumber'))}
        <output className="font-bold text-primary" aria-live="polite">
          = {result === null ? '—' : Number.isInteger(result) ? result : result.toFixed(2)}
        </output>
      </div>
    </ToolPanel>
  );
}
