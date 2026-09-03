import { useState } from 'react';

const operations = ['+', '−', '×', '÷'] as const;
type Operation = (typeof operations)[number];

export function TableCalculator() {
  const [first, setFirst] = useState('');
  const [second, setSecond] = useState('');
  const [operation, setOperation] = useState<Operation>('×');
  const left = Number(first);
  const right = Number(second);
  const valid = Number.isFinite(left) && Number.isFinite(right) && first !== '' && second !== '' && (operation !== '÷' || right !== 0);
  const result = !valid ? null : operation === '+' ? left + right : operation === '−' ? left - right : operation === '×' ? left * right : left / right;
  const numberInput = (value: string, setValue: (next: string) => void, label: string) => <input aria-label={label} inputMode="decimal" value={value} onChange={(event) => setValue(event.target.value.replace(/[^0-9.]/g, ''))} />;
  return <section className="table-calculator" aria-label="Calculator"><div><p className="eyebrow">Table tool</p><h2>Calculator</h2><p className="muted">For quick table math — it never changes balances.</p></div><div className="calculator-controls">{numberInput(first, setFirst, 'First number')}<div className="calculator-operations" role="group" aria-label="Operation">{operations.map((item) => <button type="button" key={item} className={operation === item ? 'selected' : ''} aria-pressed={operation === item} onClick={() => setOperation(item)}>{item}</button>)}</div>{numberInput(second, setSecond, 'Second number')}<output aria-live="polite">= {result === null ? '—' : Number.isInteger(result) ? result : result.toFixed(2)}</output></div></section>;
}
