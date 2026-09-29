import { useEffect, useRef, useState } from 'react';
import { rollDice, type DiceRoll } from '../utils/dice';
import { useLanguage } from '../i18n/language-context';
import { Button, ToolPanel } from './ui';
import { cx } from './ui/class-names';

const initialRoll: DiceRoll = { first: 1, second: 1, total: 2, isDouble: true };

const dieClass =
  'relative grid size-11 grid-cols-[repeat(3,1fr)] grid-rows-[repeat(3,1fr)] gap-[3px] rounded-sm border border-border-strong bg-surface-elevated p-[7px] shadow-sm';
const rollingDieClass =
  'animate-[dice-roll_var(--mb-duration-slow)_var(--mb-ease-emphasized)] motion-reduce:animate-none';
const pipClass = 'size-[7px] place-self-center rounded-full bg-surface-inverse';

/* Pip cells on the 3×3 die grid (row / column), by face value. */
const tl = 'row-start-1 col-start-1';
const tr = 'row-start-1 col-start-3';
const ml = 'row-start-2 col-start-1';
const mc = 'row-start-2 col-start-2';
const mr = 'row-start-2 col-start-3';
const bl = 'row-start-3 col-start-1';
const br = 'row-start-3 col-start-3';
const pipCells: Record<number, readonly string[]> = {
  1: [mc],
  2: [tl, br],
  3: [tl, mc, br],
  4: [tl, tr, bl, br],
  5: [tl, tr, mc, bl, br],
  6: [tl, tr, ml, mr, bl, br],
};

export function DiceRoller() {
  const { t } = useLanguage();
  const [roll, setRoll] = useState(initialRoll);
  const [rolling, setRolling] = useState(false);
  const timer = useRef<number | null>(null);
  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );
  const rollDiceNow = () => {
    if (rolling) return;
    setRoll(rollDice());
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    setRolling(true);
    timer.current = window.setTimeout(() => {
      setRolling(false);
      timer.current = null;
    }, 650);
  };
  return (
    <ToolPanel
      label={t('diceRoller')}
      eyebrow={t('tableTool')}
      title={t('rollDice')}
      description={t('diceStandalone')}
    >
      <div className="flex flex-wrap items-center gap-[10px]" aria-live="polite">
        <Die value={roll.first} rolling={rolling} label={t('dieValue', { value: roll.first })} />
        <Die value={roll.second} rolling={rolling} label={t('dieValue', { value: roll.second })} />
        <strong>{t('totalDice', { total: roll.total })}</strong>
        {roll.isDouble && <span className="font-bold text-status-text">{t('double')}</span>}
      </div>
      <Button
        variant="primary"
        className="justify-self-start"
        disabled={rolling}
        onClick={rollDiceNow}
      >
        {rolling ? t('rolling') : t('rollDice')}
      </Button>
    </ToolPanel>
  );
}

function Die({ value, rolling, label }: { value: number; rolling: boolean; label: string }) {
  return (
    <span className={cx(dieClass, rolling && rollingDieClass)} aria-label={label}>
      {(pipCells[value] ?? []).map((cell) => (
        <i key={cell} className={cx(pipClass, cell)} />
      ))}
    </span>
  );
}
