import type { BalanceSeries } from '../../../shared/contracts/api';
import type { Currency, Player } from '../../../shared/types/monopoly';
import { useLanguage } from '../../i18n/language-context';
import { formatMoney } from '../../utils/money';

const width = 320;
const height = 150;
const pad = 6;

/**
 * Balance of every player after each operation, as one line per player in the player's colour.
 * The same numbers sit in a table below, which is also what assistive technology reads.
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
  const { t } = useLanguage();
  const lines = series.players.flatMap((entry) => {
    const player = players.find((candidate) => candidate.id === entry.playerId);
    return player === undefined ? [] : [{ player, balances: entry.balances }];
  });
  const points = lines[0]?.balances.length ?? 0;
  if (series.steps === 0 || points < 2) return null;
  const all = lines.flatMap((line) => line.balances);
  const low = Math.min(...all);
  const span = Math.max(...all) - low || 1;
  const x = (index: number) => pad + (index * (width - 2 * pad)) / (points - 1);
  const y = (value: number) => height - pad - ((value - low) * (height - 2 * pad)) / span;
  const stepAt = (index: number) => Math.round((index * series.steps) / (points - 1));
  return (
    <section className="grid gap-(--mb-space-3)" aria-label={t('balanceOverTime')}>
      <h3 className="m-0 text-primary">{t('balanceOverTime')}</h3>
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-auto w-full rounded-md border border-border bg-surface-subtle"
        role="img"
        aria-label={t('balanceChartSummary', { steps: series.steps })}
      >
        {lines.map(({ player, balances }) => (
          <polyline
            key={player.id}
            fill="none"
            stroke={player.color}
            strokeWidth="2"
            strokeLinejoin="round"
            strokeLinecap="round"
            points={balances.map((value, index) => `${x(index)},${y(value)}`).join(' ')}
          />
        ))}
      </svg>
      <ul className="m-0 flex list-none flex-wrap gap-x-(--mb-space-4) gap-y-(--mb-space-1) p-0 text-small text-secondary">
        {lines.map(({ player }) => (
          <li key={player.id} className="flex items-center gap-(--mb-space-2)">
            <span
              aria-hidden="true"
              className="size-3 rounded-full"
              style={{ background: player.color }}
            />
            {player.name}
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
