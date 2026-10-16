import { describe, expect, it } from 'vitest';
import {
  calculatorReducer,
  formatCalculatorDisplay,
  formatCalculatorNumber,
  initialCalculator,
  type CalculatorAction,
  type CalculatorOperator,
  type CalculatorState,
} from './calculator';

function run(...actions: CalculatorAction[]): CalculatorState {
  return actions.reduce(calculatorReducer, initialCalculator);
}
const digits = (value: string): CalculatorAction[] =>
  [...value].map((char) => (char === '.' ? { type: 'decimal' } : { type: 'digit', digit: char }));
const op = (operator: CalculatorOperator): CalculatorAction => ({ type: 'operator', operator });
const equals: CalculatorAction = { type: 'equals' };

describe('calculator entry', () => {
  it('types digits without leading zeros', () => {
    expect(run(...digits('007')).display).toBe('7');
    expect(run(...digits('1250')).display).toBe('1250');
  });

  it('types one decimal separator and starts a fraction from zero', () => {
    expect(run(...digits('3.14.5')).display).toBe('3.145');
    expect(run({ type: 'decimal' }, { type: 'digit', digit: '5' }).display).toBe('0.5');
  });

  it('limits the length of a typed number', () => {
    expect(run(...digits('1234567890123456789')).display).toHaveLength(15);
  });

  it('ignores non-digit input', () => {
    expect(run({ type: 'digit', digit: 'x' }).display).toBe('0');
  });

  it('negates, deletes and clears', () => {
    expect(run(...digits('12'), { type: 'negate' }).display).toBe('-12');
    expect(run(...digits('12'), { type: 'negate' }, { type: 'negate' }).display).toBe('12');
    expect(run(...digits('12'), { type: 'backspace' }).display).toBe('1');
    expect(run(...digits('1'), { type: 'backspace' }).display).toBe('0');
    expect(
      run(...digits('-5').slice(0, 1), { type: 'negate' }, { type: 'backspace' }).display,
    ).toBe('0');
    expect(run(...digits('99'), op('+'), { type: 'clear' })).toEqual(initialCalculator);
  });
});

describe('calculator operations', () => {
  it.each([
    ['12', '+', '30', '42'],
    ['100', '−', '1', '99'],
    ['6', '×', '7', '42'],
    ['9', '÷', '4', '2.25'],
    ['1.5', '×', '2', '3'],
  ] as const)('%s %s %s = %s', (left, operator, right, expected) => {
    expect(run(...digits(left), op(operator), ...digits(right), equals).display).toBe(expected);
  });

  it('chains operations left to right', () => {
    const state = run(...digits('2'), op('+'), ...digits('3'), op('×'), ...digits('4'), equals);
    expect(state.display).toBe('20');
  });

  it('shows the running result when an operator follows an operation', () => {
    const state = run(...digits('2'), op('+'), ...digits('3'), op('×'));
    expect(state.display).toBe('5');
    expect(state.expression).toBe('5 ×');
  });

  it('replaces the operator when two are pressed in a row', () => {
    expect(run(...digits('8'), op('+'), op('−'), ...digits('3'), equals).display).toBe('5');
  });

  it('repeats the last operation on a second equals', () => {
    const state = run(...digits('2'), op('×'), ...digits('3'), equals, equals, equals);
    expect(state.display).toBe('54');
  });

  it('squares the number on "5 × ="', () => {
    expect(run(...digits('5'), op('×'), equals).display).toBe('25');
  });

  it('starts a new number after a result', () => {
    const state = run(...digits('2'), op('+'), ...digits('3'), equals, ...digits('7'));
    expect(state.display).toBe('7');
  });

  it('continues from a result with an operator', () => {
    const state = run(
      ...digits('2'),
      op('+'),
      ...digits('3'),
      equals,
      op('×'),
      ...digits('4'),
      equals,
    );
    expect(state.display).toBe('20');
  });

  it('rounds binary noise away', () => {
    expect(run(...digits('0.1'), op('+'), ...digits('0.2'), equals).display).toBe('0.3');
    expect(formatCalculatorNumber(0.1 + 0.2)).toBe('0.3');
  });

  it('reports division by zero and recovers on the next key', () => {
    const failed = run(...digits('5'), op('÷'), ...digits('0'), equals);
    expect(failed.error).toBe(true);
    expect(calculatorReducer(failed, { type: 'digit', digit: '4' })).toMatchObject({
      error: false,
      display: '4',
    });
  });
});

describe('calculator percent', () => {
  it('turns a lone number into a hundredth', () => {
    expect(run(...digits('50'), { type: 'percent' }).display).toBe('0.5');
  });

  it('takes a percentage of the first number for + and −', () => {
    expect(
      run(...digits('200'), op('+'), ...digits('10'), { type: 'percent' }, equals).display,
    ).toBe('220');
    expect(
      run(...digits('200'), op('−'), ...digits('25'), { type: 'percent' }, equals).display,
    ).toBe('150');
  });

  it('uses the plain hundredth for × and ÷', () => {
    expect(
      run(...digits('200'), op('×'), ...digits('10'), { type: 'percent' }, equals).display,
    ).toBe('20');
  });
});

describe('calculator history', () => {
  it('keeps the last five calculations, newest first', () => {
    let state = initialCalculator;
    for (let value = 1; value <= 6; value += 1)
      state = [
        ...digits(String(value)),
        op('+'),
        ...digits('1'),
        equals,
        { type: 'clear' } as CalculatorAction,
      ].reduce(calculatorReducer, state);
    expect(state.history).toHaveLength(5);
    expect(state.history[0]).toEqual({ expression: '6 + 1 =', result: '7' });
    expect(state.history[4]).toEqual({ expression: '2 + 1 =', result: '3' });
  });

  it('recalls a result into the display', () => {
    const state = run({ type: 'recall', value: '42' });
    expect(state.display).toBe('42');
    expect(run({ type: 'recall', value: 'abc' }).display).toBe('0');
  });
});

describe('formatCalculatorDisplay', () => {
  it('groups digits and uses the locale separator', () => {
    expect(formatCalculatorDisplay('1234567', ',')).toBe('1 234 567');
    expect(formatCalculatorDisplay('-1234.5', ',')).toBe('-1 234,5');
    expect(formatCalculatorDisplay('3.', '.')).toBe('3.');
    expect(formatCalculatorDisplay('0', '.')).toBe('0');
  });
});

describe('calculator mortgage keys', () => {
  const half: CalculatorAction = { type: 'mortgage', kind: 'half' };
  const redeem: CalculatorAction = { type: 'mortgage', kind: 'redeem' };
  it('halves a price into its mortgage value and records it', () => {
    const state = run(...digits('2400000'), half);
    expect(state.display).toBe('1200000');
    expect(state.history[0]).toEqual({ expression: '2400000 ÷ 2 =', result: '1200000' });
  });
  it('adds 10% to redeem, rounding whole amounts half up', () => {
    expect(run(...digits('1200000'), redeem).display).toBe('1320000');
    expect(run(...digits('15'), redeem).display).toBe('17');
    expect(run(...digits('14'), redeem).display).toBe('15');
  });
  it('starts a new number after the result and drops a pending operation', () => {
    const state = run(...digits('100'), op('+'), ...digits('60'), half, ...digits('5'));
    expect(state.display).toBe('5');
    expect(state.operator).toBeNull();
  });
});
