import type { BoardSnapshot } from '../../../shared/board';
import type { Currency, Player } from '../../../shared/types/monopoly';
import { useLanguage } from '../../i18n/language-context';
import { formatMoney } from '../../utils/money';
import { propertyGroupColors, tileRent, type TileView } from '../../utils/property-view';
import { Dialog } from '../Dialog';
import { Button } from '../ui';
import { cx } from '../ui/class-names';
import {
  propertyGroupKeys,
  propertyStatusKeys as statusKeys,
  useBuildingLabel,
} from './property-labels';

const pillClass =
  'inline-flex min-h-[22px] items-center rounded-pill border border-border px-(--mb-space-2) text-meta font-semibold text-secondary';
const mortgagedPillClass = 'border-danger bg-danger-soft text-danger';
const tileClass = cx(
  'grid w-full min-w-0 cursor-pointer grid-cols-[6px_minmax(0,1fr)_auto] items-center gap-(--mb-space-3) overflow-hidden',
  'rounded-control border border-border bg-surface-elevated p-0 pe-(--mb-space-3) text-start font-ui text-primary',
  'min-h-[52px] focus-visible:outline-offset-2',
  'glass:bg-[rgb(255_255_255/0.54)] glass:dark:bg-[rgb(40_49_62/0.64)]',
);

export interface PropertyTileButtonProps {
  view: TileView;
  owner: Player | null;
  onOpen: () => void;
}

/** One tile in a list: group colour bar, name, building level, owner swatch and status. */
export function PropertyTileButton({ view, owner, onOpen }: PropertyTileButtonProps) {
  const { t } = useLanguage();
  const building = useBuildingLabel()(view.houses);
  const status = t(statusKeys[view.status]);
  return (
    <button
      type="button"
      className={tileClass}
      onClick={onOpen}
      aria-label={t('propertyTileAria', { name: view.tile.name, status })}
    >
      <span
        aria-hidden="true"
        className="h-full min-h-[52px]"
        style={{ backgroundColor: propertyGroupColors[view.tile.group] }}
      />
      <span className="grid min-w-0 gap-[2px] py-(--mb-space-2)">
        <span className="text-small leading-[1.2] font-semibold wrap-anywhere">
          {view.tile.name}
        </span>
        <span className="flex flex-wrap items-center gap-(--mb-space-1) text-meta text-secondary">
          {owner !== null && (
            <>
              <span
                aria-hidden="true"
                className="inline-block size-3 rounded-full border border-border"
                style={{ backgroundColor: owner.color }}
              />
              <span>{owner.name}</span>
            </>
          )}
          {building !== null && <span>{building}</span>}
        </span>
      </span>
      <span className={cx(pillClass, view.status === 'mortgaged' && mortgagedPillClass)}>
        {status}
      </span>
    </button>
  );
}

export interface PropertyTileSheetProps {
  board: BoardSnapshot;
  views: readonly TileView[];
  view: TileView;
  players: readonly Player[];
  currency: Currency;
  /** Quick actions on this tile (buy, mortgage, redeem, auction, pay rent); none when empty. */
  actions?: readonly { key: string; label: string; onSelect: () => void }[];
  onClose: () => void;
}

const rowClass =
  'flex items-baseline justify-between gap-(--mb-space-3) rounded-control px-(--mb-space-3) py-(--mb-space-2) text-small';
const currentRowClass = 'bg-accent font-semibold text-on-accent';

/** A read-only replica of the physical card: prices, the rent table with today's level, status. */
export function PropertyTileSheet({
  board,
  views,
  view,
  players,
  currency,
  actions = [],
  onClose,
}: PropertyTileSheetProps) {
  const { t } = useLanguage();
  const { tile } = view;
  const money = (amount: number) => formatMoney(amount, currency);
  const owner = players.find((player) => player.id === view.ownerPlayerId) ?? null;
  const rent = tileRent(board, views, view);
  const current = rent.kind === 'amount' ? rent : null;
  const rows: { key: string; label: string; value: string; current: boolean }[] = [];
  if (tile.type === 'street' && tile.rent !== undefined) {
    const levelLabel = (level: number): string =>
      level === 5
        ? t('propertyRentWithHotel')
        : level === 1
          ? t('propertyRentWithHouse')
          : t('propertyRentWithHouses', { count: level });
    rows.push({
      key: 'base',
      label: t('propertyRentBase'),
      value: money(tile.rent[0]),
      current: current !== null && current.level === 0 && !current.monopolyDoubled,
    });
    rows.push({
      key: 'monopoly',
      label: t('propertyRentMonopoly'),
      value: money(tile.rent[0] * board.rules.monopolyBaseRentMultiplier),
      current: current !== null && current.monopolyDoubled,
    });
    for (let level = 1; level <= 5; level += 1)
      rows.push({
        key: `level-${level}`,
        label: levelLabel(level),
        value: money(tile.rent[level] ?? 0),
        current: current !== null && current.level === level,
      });
  } else if (tile.type === 'railway') {
    for (const [count, amount] of Object.entries(board.rules.railwayRent))
      rows.push({
        key: `rail-${count}`,
        label: count === '1' ? t('propertyRailwayOwnedOne') : t('propertyRailwayOwned', { count }),
        value: money(amount),
        current: current !== null && String(current.level) === count,
      });
  } else {
    for (const [count, multiplier] of Object.entries(board.rules.utilityDiceMultiplier))
      rows.push({
        key: `util-${count}`,
        label:
          count === '1'
            ? t('propertyUtilityOwnedOne', { multiplier })
            : t('propertyUtilityOwned', { count, multiplier }),
        value: '',
        current: rent.kind === 'dice' && String(rent.count) === count,
      });
  }
  return (
    <Dialog
      title={tile.name}
      eyebrow={t(propertyGroupKeys[tile.group])}
      closeLabel={t('closeDialog', { title: tile.name })}
      onClose={onClose}
    >
      <div className="mt-(--mb-space-4) grid gap-(--mb-space-4)">
        <div
          aria-hidden="true"
          className="h-3 rounded-pill"
          style={{ backgroundColor: propertyGroupColors[tile.group] }}
        />
        <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-(--mb-space-4) gap-y-(--mb-space-2) [&_dd]:m-0 [&_dd]:text-end [&_dd]:font-semibold [&_dt]:text-secondary">
          <dt>{t('propertyStatus')}</dt>
          <dd>{t(statusKeys[view.status])}</dd>
          <dt>{t('propertyOwner')}</dt>
          <dd>{owner === null ? '—' : owner.name}</dd>
          <dt>{t('propertyPrice')}</dt>
          <dd>{money(tile.price)}</dd>
          <dt>{t('propertyMortgageValue')}</dt>
          <dd>{money(tile.mortgage)}</dd>
          {tile.houseCost !== undefined && (
            <>
              <dt>{t('propertyHouseCost')}</dt>
              <dd>{money(tile.houseCost)}</dd>
            </>
          )}
        </dl>
        <section aria-label={t('propertyRentTable')} className="grid gap-[2px]">
          <h3 className="m-0 text-body">{t('propertyRentTable')}</h3>
          <ul className="m-0 grid list-none gap-[2px] p-0">
            {rows.map((row) => (
              <li
                key={row.key}
                className={cx(rowClass, row.current && currentRowClass)}
                aria-current={row.current ? 'true' : undefined}
              >
                <span>{row.label}</span>
                <span className="font-money tabular-nums">{row.value}</span>
              </li>
            ))}
          </ul>
        </section>
        {actions.length > 0 && (
          <div
            role="group"
            aria-label={t('propertyActions')}
            className="grid grid-cols-2 gap-(--mb-space-2) max-md:grid-cols-1"
          >
            {actions.map((action) => (
              <Button key={action.key} variant="secondary" onClick={action.onSelect}>
                {action.label}
              </Button>
            ))}
          </div>
        )}
      </div>
    </Dialog>
  );
}
