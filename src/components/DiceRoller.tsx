import { useEffect, useRef, useState } from 'react';
import type { Player } from '../../shared/types/monopoly';
import { rollDice, type DiceRoll } from '../utils/dice';
import { apiErrorMessage } from '../i18n/api-errors';
import { useLanguage } from '../i18n/language-context';

const initialRoll: DiceRoll = { first: 1, second: 1, total: 2, isDouble: true };

/** Present only for a game on a board: the roll can then be recorded for the wallet this device controls. */
export interface DiceRollerBoard {
  player: Player | null;
  onRecord: (roll: DiceRoll) => Promise<void>;
}

export function DiceRoller({ board }: { board?: DiceRollerBoard } = {}) {
  const { t } = useLanguage();
  const [roll, setRoll] = useState(initialRoll);
  const [rolling, setRolling] = useState(false);
  const [rolled, setRolled] = useState(false);
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<unknown | null>(null);
  const timer = useRef<number | null>(null);
  useEffect(() => () => { if (timer.current !== null) window.clearTimeout(timer.current); }, []);
  const rollDiceNow = () => {
    if (rolling) return;
    setRoll(rollDice());
    setRolled(true);
    setError(null);
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    setRolling(true);
    timer.current = window.setTimeout(() => { setRolling(false); timer.current = null; }, 650);
  };
  const record = async () => {
    if (board === undefined || board.player === null || recording || !rolled) return;
    setRecording(true); setError(null);
    try { await board.onRecord(roll); setRolled(false); } catch (caught) { setError(caught); } finally { setRecording(false); }
  };
  const hint = board === undefined ? t('diceStandalone') : board.player === null ? t('reasonNoWallet') : t('rollFor', { name: board.player.name });
  const rollButton = <button className="button button-primary dice-button" type="button" disabled={rolling} onClick={rollDiceNow}>{rolling ? t('rolling') : t('rollDice')}</button>;
  return <section className="dice-roller" aria-label={t('diceRoller')}><div><p className="eyebrow">{t('tableTool')}</p><h2>{t('rollDice')}</h2><p className="muted">{hint}</p>{board !== undefined && <p className="muted">{t('diceBoardHint')}</p>}</div><div className={`dice-results${rolling ? ' rolling' : ''}`} aria-live="polite"><Die value={roll.first} label={t('dieValue', { value: roll.first })} /><Die value={roll.second} label={t('dieValue', { value: roll.second })} /><strong>{t('totalDice', { total: roll.total })}</strong>{roll.isDouble && <span className="double">{t('double')}</span>}</div>{board === undefined ? rollButton : <><div className="dice-actions">{rollButton}<button className="button button-secondary" type="button" data-testid="dice-server-roll" disabled={rolling || recording || !rolled || board.player === null} onClick={() => void record()}>{recording ? t('recordingRoll') : t('recordRoll')}</button></div>{error !== null && <p className="notice notice-error" role="alert">{apiErrorMessage(error, t, 'unableRecordTransaction')}</p>}</>}</section>;
}

function Die({ value, label }: { value: number; label: string }) { return <span className={`die die-${value}`} aria-label={label}>{Array.from({ length: value }, (_, index) => <i key={index} />)}</span>; }
