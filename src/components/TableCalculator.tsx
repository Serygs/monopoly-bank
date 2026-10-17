import { useReducer, type KeyboardEvent } from 'react';
import { useLanguage } from '../i18n/language-context';
import type { TranslationKey } from '../i18n/translations';
import {
  calculatorReducer,
  formatCalculatorDisplay,
  initialCalculator,
  type CalculatorAction,
  type CalculatorOperator,
} from '../utils/calculator';
import { decimalSeparator } from '../utils/money';
import { ToolPanel } from './ui';
import { cx, keyButtonClass } from './ui/class-names';

const operatorLabels: Record<CalculatorOperator, TranslationKey> = {
  '+': 'calculatorAdd',
  '−': 'calculatorSubtract',
  '×': 'calculatorMultiply',
  '÷': 'calculatorDivide',
};

const displayClass =
  'grid min-h-[84px] content-end gap-[2px] rounded-control border border-border bg-surface-subtle px-(--mb-space-4) py-(--mb-space-3) text-end';
const keyClass = cx(
  keyButtonClass,
  'min-h-12 text-[1.1rem] disabled:cursor-not-allowed disabled:opacity-48',
);
const operatorKeyClass = cx(
  keyClass,
  'border-accent bg-accent-soft text-accent-hover aria-pressed:bg-accent aria-pressed:text-on-accent',
);
const equalsKeyClass = cx(
  keyClass,
  'rounded-pill border-accent bg-accent text-on-accent fine-pointer:hover:bg-accent-hover',
);
const historyButtonClass = cx(
  'flex w-full items-baseline justify-between gap-(--mb-space-3) rounded-control border-0 bg-transparent px-(--mb-space-2) py-[6px] text-start',
  'text-small text-secondary fine-pointer:hover:bg-surface-subtle',
);

/** Physical keyboard: digits, separator, operators, Enter or =, Backspace, Escape, %. */
function actionForKey(event: KeyboardEvent<HTMLElement>): CalculatorAction | null {
  const { key } = event;
  if (/^\d$/.test(key)) return { type: 'digit', digit: key };
  if (key === '.' || key === ',') return { type: 'decimal' };
  if (key === '+') return { type: 'operator', operator: '+' };
  if (key === '-') return { type: 'operator', operator: '−' };
  if (key === '*' || key === 'x' || key === 'X') return { type: 'operator', operator: '×' };
  if (key === '/') return { type: 'operator', operator: '÷' };
  if (key === '%') return { type: 'percent' };
  if (key === '=' || (key === 'Enter' && !(event.target instanceof HTMLButtonElement)))
    return { type: 'equals' };
  if (key === 'Backspace') return { type: 'backspace' };
  if (key === 'Escape') return { type: 'clear' };
  return null;
}

export function TableCalculator() {
  const { t, locale } = useLanguage();
  const [state, dispatch] = useReducer(calculatorReducer, initialCalculator);
  const separator = decimalSeparator(locale);
  const shown = state.error
    ? t('calculatorError')
    : formatCalculatorDisplay(state.display, separator);
  const key = (action: CalculatorAction, label: string, text: string, className = keyClass) => (
    <button type="button" className={className} aria-label={label} onClick={() => dispatch(action)}>
      {text}
    </button>
  );
  const operatorKey = (operator: CalculatorOperator) => (
    <button
      type="button"
      className={operatorKeyClass}
      aria-label={t(operatorLabels[operator])}
      aria-pressed={state.operator === operator && state.fresh}
      onClick={() => dispatch({ type: 'operator', operator })}
    >
      {operator}
    </button>
  );
  const digit = (value: string) => key({ type: 'digit', digit: value }, value, value);
  return (
    <ToolPanel
      label={t('calculator')}
      eyebrow={t('tableTool')}
      title={t('calculator')}
      description={t('calculatorDescription')}
    >
      <div
        className="grid gap-(--mb-space-3)"
        onKeyDown={(event) => {
          const action = actionForKey(event);
          if (action === null) return;
          event.preventDefault();
          dispatch(action);
        }}
      >
        <output className={displayClass} aria-live="polite" aria-label={t('calculatorDisplay')}>
          <small className="min-h-[1.1em] text-secondary">
            {formatExpression(state.expression, separator)}
          </small>
          <strong className="font-money text-[2rem] leading-[1.1] font-bold tracking-[-0.03em] text-primary tabular-nums wrap-anywhere">
            {shown}
          </strong>
        </output>
        <div className="grid grid-cols-4 gap-[6px]" role="group" aria-label={t('calculatorKeys')}>
          {key({ type: 'clear' }, t('clear'), 'C')}
          {key({ type: 'negate' }, t('calculatorNegate'), '±')}
          {key({ type: 'percent' }, t('calculatorPercent'), '%')}
          {operatorKey('÷')}
          {digit('7')}
          {digit('8')}
          {digit('9')}
          {operatorKey('×')}
          {digit('4')}
          {digit('5')}
          {digit('6')}
          {operatorKey('−')}
          {digit('1')}
          {digit('2')}
          {digit('3')}
          {operatorKey('+')}
          {key({ type: 'backspace' }, t('keypadBackspace'), '⌫')}
          {digit('0')}
          {key({ type: 'decimal' }, t('keypadDecimal'), separator)}
          {key({ type: 'equals' }, t('calculatorEquals'), '=', equalsKeyClass)}
          {key(
            { type: 'mortgage', kind: 'half' },
            t('calculatorMortgageHalf'),
            '½',
            cx(keyClass, 'col-span-2'),
          )}
          {key(
            { type: 'mortgage', kind: 'redeem' },
            t('calculatorMortgageRedeem'),
            `×1${separator}1`,
            cx(keyClass, 'col-span-2'),
          )}
        </div>
        {state.history.length > 0 && (
          <section aria-label={t('calculatorHistory')}>
            <ol className="m-0 grid list-none gap-0 p-0">
              {state.history.map((entry, index) => (
                <li key={`${entry.expression}-${index}`}>
                  <button
                    type="button"
                    className={historyButtonClass}
                    aria-label={t('calculatorReuse', {
                      expression: formatExpression(entry.expression, separator),
                      result: formatCalculatorDisplay(entry.result, separator),
                    })}
                    onClick={() => dispatch({ type: 'recall', value: entry.result })}
                  >
                    <span>{formatExpression(entry.expression, separator)}</span>
                    <strong className="font-money text-primary tabular-nums">
                      {formatCalculatorDisplay(entry.result, separator)}
                    </strong>
                  </button>
                </li>
              ))}
            </ol>
          </section>
        )}
      </div>
    </ToolPanel>
  );
}

/** Formats the numbers in an expression such as `1200.5 + 3 =` for display. */
function formatExpression(expression: string, separator: string): string {
  return expression
    .split(' ')
    .map((part) =>
      /^-?[\d.]+(e[+-]?\d+)?$/.test(part) ? formatCalculatorDisplay(part, separator) : part,
    )
    .join(' ');
}
