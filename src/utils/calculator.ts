import { groupThousands } from './money';

export const calculatorOperators = ['+', '−', '×', '÷'] as const;
export type CalculatorOperator = (typeof calculatorOperators)[number];

export interface CalculationEntry {
  expression: string;
  result: string;
}

export interface CalculatorState {
  /** What the display shows: the number being typed, or the latest result. */
  display: string;
  accumulator: number | null;
  operator: CalculatorOperator | null;
  /** True right after an operator or `=`: the next digit starts a new number. */
  fresh: boolean;
  /** Repeats the last operation when `=` is pressed again. */
  repeat: { operator: CalculatorOperator; operand: number } | null;
  expression: string;
  error: boolean;
  history: CalculationEntry[];
}

export type CalculatorAction =
  | { type: 'digit'; digit: string }
  | { type: 'decimal' }
  | { type: 'operator'; operator: CalculatorOperator }
  | { type: 'equals' }
  | { type: 'percent' }
  | { type: 'negate' }
  /** Mortgage shortcuts on the shown number: half the price, or the redemption cost (×1.1). */
  | { type: 'mortgage'; kind: 'half' | 'redeem' }
  | { type: 'backspace' }
  | { type: 'clear' }
  | { type: 'recall'; value: string };

const maxEntryLength = 15;
const historyLimit = 5;

export const initialCalculator: CalculatorState = {
  display: '0',
  accumulator: null,
  operator: null,
  fresh: true,
  repeat: null,
  expression: '',
  error: false,
  history: [],
};

/** Rounds away binary noise (0.1 + 0.2) and writes the number without an exponent when it can. */
export function formatCalculatorNumber(value: number): string {
  const rounded = Number(value.toPrecision(12));
  if (Object.is(rounded, -0)) return '0';
  const text = String(rounded);
  return text.includes('e') ? rounded.toExponential() : text;
}

function apply(left: number, operator: CalculatorOperator, right: number): number | null {
  switch (operator) {
    case '+':
      return left + right;
    case '−':
      return left - right;
    case '×':
      return left * right;
    case '÷':
      return right === 0 ? null : left / right;
  }
}

function failed(state: CalculatorState): CalculatorState {
  return { ...initialCalculator, history: state.history, error: true, display: '0' };
}

function record(history: CalculationEntry[], entry: CalculationEntry): CalculationEntry[] {
  return [entry, ...history].slice(0, historyLimit);
}

type ActionOf<T extends CalculatorAction['type']> = Extract<CalculatorAction, { type: T }>;

type Handlers = {
  [T in CalculatorAction['type']]: (state: CalculatorState, action: ActionOf<T>) => CalculatorState;
};

function enterDigit(state: CalculatorState, action: ActionOf<'digit'>): CalculatorState {
  if (!/^\d$/.test(action.digit)) return state;
  if (state.fresh || state.display === '0')
    return { ...state, display: action.digit, fresh: false };
  if (state.display.replace(/[-.]/g, '').length >= maxEntryLength) return state;
  return { ...state, display: `${state.display}${action.digit}` };
}

function enterDecimal(state: CalculatorState): CalculatorState {
  if (state.fresh) return { ...state, display: '0.', fresh: false };
  return state.display.includes('.') ? state : { ...state, display: `${state.display}.` };
}

function chooseOperator(state: CalculatorState, action: ActionOf<'operator'>): CalculatorState {
  const { operator } = action;
  if (state.operator !== null && state.accumulator !== null && state.fresh)
    return {
      ...state,
      operator,
      expression: `${formatCalculatorNumber(state.accumulator)} ${operator}`,
    };
  const entered = Number(state.display);
  const left =
    state.operator !== null && state.accumulator !== null
      ? apply(state.accumulator, state.operator, entered)
      : entered;
  if (left === null) return failed(state);
  const text = formatCalculatorNumber(left);
  return {
    ...state,
    accumulator: left,
    operator,
    display: text,
    fresh: true,
    repeat: null,
    expression: `${text} ${operator}`,
  };
}

function finishOperation(
  state: CalculatorState,
  accumulator: number,
  operator: CalculatorOperator,
): CalculatorState {
  // "5 × =" squares the number, like a pocket calculator.
  const right = state.fresh ? accumulator : Number(state.display);
  const result = apply(accumulator, operator, right);
  if (result === null) return failed(state);
  const text = formatCalculatorNumber(result);
  const expression = `${formatCalculatorNumber(accumulator)} ${operator} ${formatCalculatorNumber(right)} =`;
  return {
    ...state,
    display: text,
    accumulator: null,
    operator: null,
    fresh: true,
    repeat: { operator, operand: right },
    expression,
    history: record(state.history, { expression, result: text }),
  };
}

function repeatOperation(
  state: CalculatorState,
  repeat: NonNullable<CalculatorState['repeat']>,
): CalculatorState {
  const left = Number(state.display);
  const result = apply(left, repeat.operator, repeat.operand);
  if (result === null) return failed(state);
  const text = formatCalculatorNumber(result);
  const expression = `${formatCalculatorNumber(left)} ${repeat.operator} ${formatCalculatorNumber(repeat.operand)} =`;
  return {
    ...state,
    display: text,
    fresh: true,
    expression,
    history: record(state.history, { expression, result: text }),
  };
}

function pressEquals(state: CalculatorState): CalculatorState {
  if (state.operator !== null && state.accumulator !== null)
    return finishOperation(state, state.accumulator, state.operator);
  return state.repeat === null ? state : repeatOperation(state, state.repeat);
}

function percentOf(state: CalculatorState): CalculatorState {
  const entered = Number(state.display);
  const value =
    state.operator !== null && state.accumulator !== null
      ? state.operator === '+' || state.operator === '−'
        ? (state.accumulator * entered) / 100
        : entered / 100
      : entered / 100;
  return { ...state, display: formatCalculatorNumber(value), fresh: false };
}

function mortgageValue(state: CalculatorState, action: ActionOf<'mortgage'>): CalculatorState {
  const entered = Number(state.display);
  // Whole amounts stay whole: redemption rounds half up in integers, (v × 11 + 5) / 10.
  const result =
    action.kind === 'half'
      ? entered / 2
      : Number.isInteger(entered)
        ? Math.floor((entered * 11 + 5) / 10)
        : entered * 1.1;
  const text = formatCalculatorNumber(result);
  const expression = `${formatCalculatorNumber(entered)} ${action.kind === 'half' ? '÷ 2' : '× 1.1'} =`;
  return {
    ...state,
    display: text,
    accumulator: null,
    operator: null,
    fresh: true,
    repeat: null,
    expression,
    history: record(state.history, { expression, result: text }),
  };
}

function negate(state: CalculatorState): CalculatorState {
  if (state.display === '0') return state;
  return {
    ...state,
    display: state.display.startsWith('-') ? state.display.slice(1) : `-${state.display}`,
  };
}

function backspace(state: CalculatorState): CalculatorState {
  if (state.fresh) return state;
  const next = state.display.slice(0, -1);
  return { ...state, display: next === '' || next === '-' ? '0' : next };
}

function recall(state: CalculatorState, action: ActionOf<'recall'>): CalculatorState {
  return Number.isFinite(Number(action.value))
    ? { ...state, display: action.value, fresh: false }
    : state;
}

const handlers: Handlers = {
  digit: enterDigit,
  decimal: enterDecimal,
  operator: chooseOperator,
  equals: pressEquals,
  percent: percentOf,
  mortgage: mortgageValue,
  negate,
  backspace,
  clear: (state) => ({ ...initialCalculator, history: state.history }),
  recall,
};

export function calculatorReducer(
  current: CalculatorState,
  action: CalculatorAction,
): CalculatorState {
  // Any key after an error starts over, keeping the history.
  const state = current.error ? { ...initialCalculator, history: current.history } : current;
  const handler = handlers[action.type] as (
    state: CalculatorState,
    action: CalculatorAction,
  ) => CalculatorState;
  return handler(state, action);
}

/** The display for people: grouped whole part, the locale's separator, a typed trailing comma. */
export function formatCalculatorDisplay(display: string, decimalSeparator: string): string {
  const negative = display.startsWith('-');
  const body = negative ? display.slice(1) : display;
  if (body.includes('e')) return display;
  const dot = body.indexOf('.');
  const whole = groupThousands(dot === -1 ? body : body.slice(0, dot));
  const text = dot === -1 ? whole : `${whole}${decimalSeparator}${body.slice(dot + 1)}`;
  return negative ? `-${text}` : text;
}
