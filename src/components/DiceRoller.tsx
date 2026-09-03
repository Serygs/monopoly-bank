import { useEffect, useRef, useState } from 'react';
import { rollDice, type DiceRoll } from '../utils/dice';

const initialRoll: DiceRoll = { first: 1, second: 1, total: 2, isDouble: true };

export function DiceRoller() {
  const [roll, setRoll] = useState(initialRoll);
  const [rolling, setRolling] = useState(false);
  const timer = useRef<number | null>(null);
  useEffect(() => () => { if (timer.current !== null) window.clearTimeout(timer.current); }, []);
  const rollDiceNow = () => {
    if (rolling) return;
    setRoll(rollDice());
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    setRolling(true);
    timer.current = window.setTimeout(() => { setRolling(false); timer.current = null; }, 650);
  };
  return <section className="dice-roller" aria-label="Dice roller"><div><p className="eyebrow">Table tool</p><h2>Roll dice</h2><p className="muted">Standalone — it does not change the game.</p></div><div className={`dice-results${rolling ? ' rolling' : ''}`} aria-live="polite"><Die value={roll.first} /><Die value={roll.second} /><strong>Total {roll.total}</strong>{roll.isDouble && <span className="double">DOUBLE!</span>}</div><button className="button button-primary dice-button" type="button" disabled={rolling} onClick={rollDiceNow}>{rolling ? 'Rolling…' : 'Roll Dice'}</button></section>;
}

function Die({ value }: { value: number }) { return <span className={`die die-${value}`} aria-label={`Die: ${value}`}>{Array.from({ length: value }, (_, index) => <i key={index} />)}</span>; }
