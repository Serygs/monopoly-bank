import { useState, type PointerEvent } from 'react';
import type { BalanceSeries } from '../../../shared/contracts/api';
import type { Currency, Player } from '../../../shared/types/monopoly';
import { useLanguage } from '../../i18n/language-context';
import { formatMoney } from '../../utils/money';

const width = 320;
const height = 220;
const padTop = 10;
const padRight = 10;
const padBottom = 22;
const padLeft = 38;
/** Distinct dash patterns, so a line is told apart by more than its colour. */
const dashes = [undefined, '6 3', '2 3', '8 3 2 3', '1 4', '10 4'];

/** About `count` round-numbered gridline values covering `low`..`high`, zero included in the range. */
function niceTicks(low: number, high: number, count: number): number[] {
  const rough = (high - low || 1) / count;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step = ([1, 2, 5, 10].find((factor) => factor * magnitude >= rough) ?? 10) * magnitude;
  const ticks: number[] = [];
  for (let value = Math.ceil(low / step) * step; value <= high + step / 1e6; value += step)
    ticks.push(Math.round(value));
  return ticks;
}

/**
 * Balance of every player after each operation, as one line per player in the player's colour.
 * A player's line ends where they went bankrupt. Tapping a name in the legend picks one line out,
 * and pointing at the chart reads every balance at that operation. The same numbers sit in a
 * table below, which is also what assistive technology reads.
 */
export function BalanceChart({
  series,
  players,
  currency,
}: {
  series: BalanceSeries;
  players: readonly Player[];
  currency: Currency;
}) {
  const { t, locale } = useLanguage();
  const [focused, setFocused] = useState<string | null>(null);
  const [inspected, setInspected] = useState<number | null>(null);
  const lines = series.players.flatMap((entry, order) => {
    const player = players.find((candidate) => candidate.id === entry.playerId);
    if (player === undefined) return [];
    const last = Math.min(entry.endIndex ?? entry.balances.length - 1, entry.balances.length - 1);
    return [{ player, balances: entry.balances, last, dash: dashes[order % dashes.length] }];
  });
  const points = lines[0]?.balances.length ?? 0;
  if (series.steps === 0 || points < 2) return null;
  const all = lines.flatMap((line) => line.balances.slice(0, line.last + 1));
  const low = Math.min(0, ...all);
  const high = Math.max(...all);
  const span = high - low || 1;
  const compact = new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 });
  const plotWidth = width - padLeft - padRight;
  const plotHeight = height - padTop - padBottom;
  const x = (index: number) => padLeft + (index * plotWidth) / (points - 1);
  const y = (value: number) => padTop + plotHeight - ((value - low) * plotHeight) / span;
  const stepAt = (index: number) => Math.round((index * series.steps) / (points - 1));
  const ticks = niceTicks(low, high, 4);
  const stepTicks = [0, 1 / 3, 2 / 3, 1].map((share) => Math.round(share * (points - 1)));
  const dimmed = (id: string) => focused !== null && focused !== id;
  const inspect = (event: PointerEvent<SVGSVGElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    if (box.width === 0) return;
    const position = ((event.clientX - box.left) / box.width) * width;
    const index = Math.round(((position - padLeft) / plotWidth) * (points - 1));
    setInspected(Math.min(points - 1, Math.max(0, index)));
  };
  return (
    <section className="grid gap-(--mb-space-3)" aria-label={t('balanceOverTime')}>
      <h3 className="m-0 text-primary">{t('balanceOverTime')}</h3>
      <p
        className="m-0 flex min-h-[2.5em] flex-wrap items-center gap-x-(--mb-space-3) text-small text-secondary tabular-nums"
        aria-hidden="true"
        data-testid="chart-readout"
      >
        {inspected === null ? (
          t('chartInspectHint')
        ) : (
          <>
            <strong>{t('chartOperation', { step: stepAt(inspected) })}</strong>
            {lines.map(({ player, balances, last }) => (
              <span key={player.id} style={{ opacity: dimmed(player.id) ? 0.4 : 1 }}>
                <span style={{ color: player.color }}>●</span> {player.name}:{' '}
                {inspected > last
                  ? t('chartBankruptMark')
                  : formatMoney(balances[inspected], currency)}
              </span>
            ))}
          </>
        )}
      </p>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-auto w-full touch-pan-y rounded-md border border-border bg-surface-subtle"
        role="img"
        aria-label={t('balanceChartSummary', { steps: series.steps })}
        onPointerMove={inspect}
        onPointerDown={inspect}
        onPointerLeave={(event) => {
          if (event.pointerType === 'mouse') setInspected(null);
        }}
      >
        {ticks.map((tick) => (
          <g key={tick}>
            <line
              x1={padLeft}
              x2={width - padRight}
              y1={y(tick)}
              y2={y(tick)}
              stroke="currentColor"
              strokeOpacity={tick === 0 ? 0.35 : 0.12}
              className="text-primary"
            />
            <text
              x={padLeft - 4}
              y={y(tick)}
              textAnchor="end"
              dominantBaseline="middle"
              fontSize="9"
              fill="currentColor"
              className="text-secondary"
            >
              {compact.format(tick)}
            </text>
          </g>
        ))}
        {stepTicks.map((index, order) => (
          <text
            key={index}
            x={x(index)}
            y={height - 6}
            textAnchor={order === 0 ? 'start' : order === stepTicks.length - 1 ? 'end' : 'middle'}
            fontSize="9"
            fill="currentColor"
            className="text-secondary"
          >
            {stepAt(index)}
          </text>
        ))}
        {lines.map(({ player, balances, last, dash }) => (
          <g key={player.id} opacity={dimmed(player.id) ? 0.2 : 1}>
            <polyline
              fill="none"
              stroke={player.color}
              strokeWidth={focused === player.id ? 3 : 2}
              strokeDasharray={dash}
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
              points={balances
                .slice(0, last + 1)
                .map((value, index) => `${x(index)},${y(value)}`)
                .join(' ')}
            />
            {last < points - 1 ? (
              <text
                x={x(last)}
                y={y(balances[last])}
                textAnchor="middle"
                dominantBaseline="middle"
                fontSize="11"
                fontWeight="700"
                fill={player.color}
              >
                ✕
              </text>
            ) : (
              <circle cx={x(last)} cy={y(balances[last])} r="3" fill={player.color} />
            )}
          </g>
        ))}
        {inspected !== null && (
          <line
            x1={x(inspected)}
            x2={x(inspected)}
            y1={padTop}
            y2={padTop + plotHeight}
            stroke="currentColor"
            strokeOpacity="0.4"
            className="text-primary"
          />
        )}
      </svg>
      <ul className="m-0 flex list-none flex-wrap gap-x-(--mb-space-2) gap-y-(--mb-space-1) p-0 text-small text-secondary">
        {lines.map(({ player, balances, last }) => (
          <li key={player.id}>
            <button
              type="button"
              aria-pressed={focused === player.id}
              onClick={() => setFocused(focused === player.id ? null : player.id)}
              className="flex min-h-9 items-center gap-(--mb-space-2) rounded-md border border-transparent bg-transparent px-(--mb-space-2) py-(--mb-space-1) text-start font-[inherit] text-[length:inherit] text-secondary aria-pressed:border-border aria-pressed:text-primary"
            >
              <span
                aria-hidden="true"
                className="size-3 shrink-0 rounded-full"
                style={{ background: player.color }}
              />
              <span>{player.name}</span>
              <span className="tabular-nums text-primary">
                {formatMoney(balances[last], currency)}
              </span>
            </button>
          </li>
        ))}
      </ul>
      <details>
        <summary className="cursor-pointer text-small font-semibold text-secondary">
          {t('showChartTable')}
        </summary>
        <div className="overflow-x-auto">
          <table className="mt-(--mb-space-2) w-full border-collapse text-small tabular-nums">
            <thead>
              <tr>
                <th scope="col" className="p-1 text-start">
                  {t('chartTableStep')}
                </th>
                {lines.map(({ player }) => (
                  <th key={player.id} scope="col" className="p-1 text-end">
                    {player.name}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: points }, (_, index) => (
                <tr key={index} className="border-t border-border">
                  <th scope="row" className="p-1 text-start font-normal">
                    {stepAt(index)}
                  </th>
                  {lines.map(({ player, balances }) => (
                    <td key={player.id} className="p-1 text-end">
                      {formatMoney(balances[index], currency)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </section>
  );
}
