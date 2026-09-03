import { useEffect, useRef, useState } from 'react';
import { rollDice, type DiceRoll } from '../utils/dice';
import { useLanguage } from '../i18n/language-context';

const initialRoll: DiceRoll = { first: 1, second: 1, total: 2, isDouble: true };

export function DiceRoller() {
  const { t } = useLanguage();
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
  return <section className="dice-roller" aria-label={t('diceRoller')}><div><p className="eyebrow">{t('tableTool')}</p><h2>{t('rollDice')}</h2><p className="muted">{t('diceStandalone')}</p></div><div className={`dice-results${rolling ? ' rolling' : ''}`} aria-live="polite"><Die value={roll.first} label={t('dieValue', { value: roll.first })} /><Die value={roll.second} label={t('dieValue', { value: roll.second })} /><strong>{t('totalDice', { total: roll.total })}</strong>{roll.isDouble && <span className="double">{t('double')}</span>}</div><button className="button button-primary dice-button" type="button" disabled={rolling} onClick={rollDiceNow}>{rolling ? t('rolling') : t('rollDice')}</button></section>;
}

function Die({ value, label }: { value: number; label: string }) { return <span className={`die die-${value}`} aria-label={label}>{Array.from({ length: value }, (_, index) => <i key={index} />)}</span>; }
