import { useEffect, useRef, useState } from 'react';
import type { DiceRoll as StoredDiceRoll } from '../../shared/contracts/api';
import type { Player } from '../../shared/types/monopoly';
import { monopolyBankApi } from '../api/monopoly-bank-api';
import { rollDice, type DiceRoll } from '../utils/dice';
import { useLanguage } from '../i18n/language-context';
import { Button, ToolPanel } from './ui';
import { cx, playerSwatchClass } from './ui/class-names';
import { dateTimeFormat } from '../utils/date-time';

const initialRoll: DiceRoll = { first: 1, second: 1, total: 2, isDouble: true };
/** Rolls shown at first, how many each "Show more" adds, and the most the server keeps. */
const initialVisible = 3;
const pageSize = 10;
const maxHistory = 100;

const dieClass =
  'relative grid size-11 grid-cols-[repeat(3,1fr)] grid-rows-[repeat(3,1fr)] gap-[3px] rounded-sm border border-border-strong bg-surface-elevated p-[7px] shadow-sm';
const smallDieClass = 'size-7! gap-[1px]! p-[4px]! shadow-none!';
const rollingDieClass =
  'animate-[dice-roll_var(--mb-duration-slow)_var(--mb-ease-emphasized)] motion-reduce:animate-none';
const pipClass = 'size-[7px] place-self-center rounded-full bg-surface-inverse';
const smallPipClass = 'size-[4px]!';

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

const playerChipClass = cx(
  'inline-flex min-h-(--mb-control-height-md) shrink-0 items-center gap-[6px] rounded-pill border border-border bg-surface-elevated px-[12px] font-semibold text-primary',
  'aria-pressed:border-accent aria-pressed:bg-accent aria-pressed:text-on-accent',
);
const chipRowClass =
  '-mx-[2px] flex gap-2 overflow-x-auto px-[2px] pb-[2px] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden';
const historyRowClass =
  'flex items-center gap-(--mb-space-3) border-b border-border py-(--mb-space-2) last:border-b-0 [&>time]:ms-auto [&>time]:text-small [&>time]:text-secondary [&>time]:tabular-nums';

export interface DiceRollerProps {
  gameId: string;
  players: Player[];
  /** The wallet whose rolls are recorded; null when the viewer controls none (rolls stay local). */
  rollerPlayerId: string | null;
}

export function DiceRoller({ gameId, players, rollerPlayerId }: DiceRollerProps) {
  const { t, locale } = useLanguage();
  const [roll, setRoll] = useState(initialRoll);
  const [rolling, setRolling] = useState(false);
  const [chosenPlayerId, setChosenPlayerId] = useState<string | null>(null);
  const [history, setHistory] = useState<{ playerId: string; rolls: StoredDiceRoll[] } | null>(
    null,
  );
  const [failedPlayerId, setFailedPlayerId] = useState<string | null>(null);
  const [saveFailed, setSaveFailed] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [visible, setVisible] = useState(initialVisible);
  const [limit, setLimit] = useState(pageSize);
  const timer = useRef<number | null>(null);
  const viewPlayerId = chosenPlayerId ?? rollerPlayerId ?? players[0]?.id ?? null;

  useEffect(
    () => () => {
      if (timer.current !== null) window.clearTimeout(timer.current);
    },
    [],
  );
  useEffect(() => {
    if (viewPlayerId === null) return;
    let active = true;
    void monopolyBankApi.listDiceRolls(gameId, viewPlayerId, limit).then(
      (rolls) => {
        if (!active) return;
        setHistory({ playerId: viewPlayerId, rolls });
        setFailedPlayerId(null);
      },
      () => {
        if (active) setFailedPlayerId(viewPlayerId);
      },
    );
    return () => {
      active = false;
    };
  }, [gameId, viewPlayerId, limit, refresh]);

  const record = (next: DiceRoll, playerId: string) => {
    setSaveFailed(false);
    void monopolyBankApi
      .recordDiceRoll(gameId, playerId, {
        id: crypto.randomUUID(),
        dieOne: next.first,
        dieTwo: next.second,
      })
      .then(
        (saved) =>
          setHistory((current) =>
            current?.playerId === saved.playerId
              ? {
                  playerId: saved.playerId,
                  rolls: [saved, ...current.rolls.filter((item) => item.id !== saved.id)].slice(
                    0,
                    limit,
                  ),
                }
              : (setRefresh((count) => count + 1), current),
          ),
        () => setSaveFailed(true),
      );
  };
  const rollDiceNow = () => {
    if (rolling) return;
    const next = rollDice();
    setRoll(next);
    if (rollerPlayerId !== null) {
      setChosenPlayerId(rollerPlayerId);
      record(next, rollerPlayerId);
    }
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    setRolling(true);
    timer.current = window.setTimeout(() => {
      setRolling(false);
      timer.current = null;
    }, 650);
  };

  const rolls = history?.playerId === viewPlayerId ? history.rolls : null;
  const time = dateTimeFormat(locale, {
    dateStyle: 'short',
    timeStyle: 'medium',
    hourCycle: 'h23',
  });
  /* More may exist on the server while the loaded page is full and under the cap. */
  const canShowMore =
    rolls !== null && (rolls.length > visible || (rolls.length >= limit && limit < maxHistory));
  const showMore = () => {
    const next = Math.min(visible + pageSize, maxHistory);
    setVisible(next);
    if (next > limit) setLimit(next);
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
      {saveFailed && <p className="m-0 text-small text-danger">{t('diceNotSaved')}</p>}
      {players.length > 0 && (
        <section className="grid gap-(--mb-space-3)" aria-label={t('diceHistory')}>
          <h3 className="m-0 text-small font-semibold text-secondary">{t('diceHistory')}</h3>
          <div className={chipRowClass} role="group" aria-label={t('diceHistoryPlayer')}>
            {players.map((player) => (
              <button
                key={player.id}
                type="button"
                className={playerChipClass}
                aria-pressed={viewPlayerId === player.id}
                onClick={() => {
                  setChosenPlayerId(player.id);
                  setVisible(initialVisible);
                  setLimit(pageSize);
                }}
              >
                <span
                  className={playerSwatchClass}
                  style={{ backgroundColor: player.color }}
                  aria-hidden="true"
                />
                {player.name}
              </button>
            ))}
          </div>
          {failedPlayerId === viewPlayerId && failedPlayerId !== null ? (
            <p className="m-0 text-small text-danger">{t('diceHistoryFailed')}</p>
          ) : rolls === null ? (
            <p className="m-0 text-small text-secondary" role="status">
              {t('loadingHistory')}
            </p>
          ) : rolls.length === 0 ? (
            <p className="m-0 text-small text-secondary">{t('diceNoRolls')}</p>
          ) : (
            <ol className="m-0 list-none p-0">
              {rolls.slice(0, visible).map((item) => (
                <li key={item.id} className={historyRowClass}>
                  <span
                    className="flex items-center gap-[6px]"
                    role="img"
                    aria-label={t('diceRollEntry', {
                      first: item.dieOne,
                      second: item.dieTwo,
                      total: item.dieOne + item.dieTwo,
                    })}
                  >
                    <Die value={item.dieOne} small />
                    <Die value={item.dieTwo} small />
                  </span>
                  <strong className="tabular-nums">{item.dieOne + item.dieTwo}</strong>
                  {item.dieOne === item.dieTwo && (
                    <span className="text-small font-bold text-status-text">{t('double')}</span>
                  )}
                  <time dateTime={item.createdAt}>{time.format(new Date(item.createdAt))}</time>
                </li>
              ))}
            </ol>
          )}
          {canShowMore && (
            <Button variant="secondary" className="justify-self-start" onClick={showMore}>
              {t('diceShowMore')}
            </Button>
          )}
        </section>
      )}
    </ToolPanel>
  );
}

function Die({
  value,
  rolling = false,
  small = false,
  label,
}: {
  value: number;
  rolling?: boolean;
  small?: boolean;
  label?: string;
}) {
  return (
    <span
      className={cx(dieClass, small && smallDieClass, rolling && rollingDieClass)}
      aria-label={label}
      aria-hidden={label === undefined ? true : undefined}
    >
      {(pipCells[value] ?? []).map((cell) => (
        <i key={cell} className={cx(pipClass, small && smallPipClass, cell)} />
      ))}
    </span>
  );
}
