import { useState } from 'react';
import type { BoardSnapshot, PropertyGroupId } from '../../shared/board';
import { propertyGroupIds } from '../../shared/board';
import type { Currency, GameProperty, Player } from '../../shared/types/monopoly';
import { Dialog } from '../components/Dialog';
import { PropertyTileButton, PropertyTileSheet } from '../components/game/PropertyTile';
import { propertyGroupKeys, useBuildingLabel } from '../components/game/property-labels';
import { Button, SegmentedControl } from '../components/ui';
import { cx, wideDialogClass } from '../components/ui/class-names';
import { useLanguage } from '../i18n/language-context';
import { formatMoney } from '../utils/money';
import {
  cardsOwnedBy,
  groupProgress,
  propertyGroupColors,
  tileRent,
  tileIntents,
  tileViews,
  type TileIntent,
  type TileView,
} from '../utils/property-view';

type PropertyView = 'MINE' | 'ALL';

const intentLabelKeys = {
  PROPERTY_PURCHASE: 'propertyActionBuy',
  MORTGAGE: 'propertyActionMortgage',
  MORTGAGE_REDEMPTION: 'propertyActionRedeem',
  AUCTION: 'propertyActionAuction',
  PAY_RENT: 'propertyActionRent',
} as const;

export interface PropertyScreenProps {
  board: BoardSnapshot;
  properties: readonly GameProperty[];
  players: readonly Player[];
  currency: Currency;
  /** The wallets the viewer controls; "Mine" lists their cards. */
  controlledPlayerIds: readonly string[];
  /** The wallet that buys, bids and pays rent from the tile sheet; none hides those actions. */
  actorPlayerId?: string | null;
  /** The auctions rule is on and no auction is running. */
  auctionsAvailable?: boolean;
  /** Starts a wallet action on a tile (the same flows as the wallet menu); omitted = read-only. */
  onIntent?: (intent: TileIntent) => void;
  onClose: () => void;
}

const listClass = 'm-0 grid list-none gap-(--mb-space-2) p-0';
const filterRowClass = 'flex flex-wrap gap-(--mb-space-2)';
const groupHeaderClass = 'm-0 flex items-center gap-(--mb-space-2) text-small font-semibold';
const emptyClass = 'm-0 text-secondary';

/** Read-only property overview: the viewer's cards grouped by colour, or every tile with filters. */
export function PropertyScreen({
  board,
  properties,
  players,
  currency,
  controlledPlayerIds,
  actorPlayerId = null,
  auctionsAvailable = false,
  onIntent,
  onClose,
}: PropertyScreenProps) {
  const { t } = useLanguage();
  const building = useBuildingLabel();
  const [view, setView] = useState<PropertyView>('MINE');
  const [freeOnly, setFreeOnly] = useState(false);
  const [playerFilter, setPlayerFilter] = useState<string | null>(null);
  const [groupFilter, setGroupFilter] = useState<PropertyGroupId | null>(null);
  const [openTileId, setOpenTileId] = useState<string | null>(null);
  const views = tileViews(board, properties);
  const ownerOf = (card: TileView) =>
    players.find((player) => player.id === card.ownerPlayerId) ?? null;
  const mine = cardsOwnedBy(views, controlledPlayerIds);
  const groups = propertyGroupIds.filter((group) => mine.some((card) => card.tile.group === group));
  const visible = views.filter(
    (card) =>
      (!freeOnly || card.status === 'free') &&
      (playerFilter === null || card.ownerPlayerId === playerFilter) &&
      (groupFilter === null || card.tile.group === groupFilter),
  );
  const openTile = views.find((card) => card.tile.id === openTileId) ?? null;
  const rentLabel = (card: TileView): string | null => {
    const rent = tileRent(board, views, card);
    if (rent.kind === 'amount')
      return t('propertyRentNow', { amount: formatMoney(rent.amount, currency) });
    if (rent.kind === 'dice')
      return t('propertyRentDice', {
        one: board.rules.utilityDiceMultiplier['1'] ?? 4,
        two: board.rules.utilityDiceMultiplier['2'] ?? 10,
      });
    return card.status === 'mortgaged' ? t('propertyRentNone') : null;
  };
  const toggle = <Value,>(current: Value | null, value: Value) =>
    current === value ? null : value;

  return (
    <Dialog
      title={t('propertyTitle')}
      closeLabel={t('closeDialog', { title: t('propertyTitle') })}
      onClose={onClose}
      className={wideDialogClass}
    >
      <div className="mt-(--mb-space-4) grid gap-(--mb-space-4)">
        <SegmentedControl
          label={t('propertyViews')}
          value={view}
          onChange={setView}
          options={[
            { value: 'MINE', label: t('propertyMine') },
            { value: 'ALL', label: t('propertyAll') },
          ]}
        />
        {view === 'MINE' && mine.length === 0 && (
          <p className={emptyClass}>{t('propertyEmptyMine')}</p>
        )}
        {view === 'MINE' &&
          groups.map((group) => {
            const cards = mine.filter((card) => card.tile.group === group);
            // Progress is counted per owner; the first controlled wallet holding the group decides.
            const progress = groupProgress(views, group, cards[0]?.ownerPlayerId ?? '');
            return (
              <section key={group} className="grid gap-(--mb-space-2)" data-group={group}>
                <h3 className={groupHeaderClass}>
                  <span
                    aria-hidden="true"
                    className="inline-block size-3 rounded-full"
                    style={{ backgroundColor: propertyGroupColors[group] }}
                  />
                  <span>{t(propertyGroupKeys[group])}</span>
                  <span
                    className="text-secondary"
                    aria-label={t('propertyGroupProgressAria', {
                      owned: progress.owned,
                      size: progress.size,
                    })}
                  >
                    {t('propertyGroupProgress', { owned: progress.owned, size: progress.size })}
                  </span>
                  {progress.monopoly && (
                    <span
                      className={cx(
                        'rounded-pill bg-accent px-(--mb-space-2) text-meta text-on-accent',
                      )}
                    >
                      {t('propertyMonopoly')}
                    </span>
                  )}
                </h3>
                <ul className={listClass}>
                  {cards.map((card) => (
                    <li key={card.tile.id} className="grid gap-[2px]">
                      <PropertyTileButton
                        view={card}
                        owner={ownerOf(card)}
                        onOpen={() => setOpenTileId(card.tile.id)}
                      />
                      <span className="px-(--mb-space-3) text-meta text-secondary">
                        {[building(card.houses), rentLabel(card)]
                          .filter((part) => part !== null)
                          .join(' · ')}
                      </span>
                    </li>
                  ))}
                </ul>
              </section>
            );
          })}
        {view === 'ALL' && (
          <>
            <fieldset className="m-0 grid gap-(--mb-space-2) border-0 p-0">
              <legend className="sr-only">{t('propertyFilters')}</legend>
              <div className={filterRowClass}>
                <Button
                  variant="secondary"
                  aria-pressed={freeOnly}
                  onClick={() => setFreeOnly(!freeOnly)}
                >
                  {t('propertyFilterFree')}
                </Button>
              </div>
              <div className={filterRowClass} role="group" aria-label={t('propertyFilterPlayer')}>
                {players.map((player) => (
                  <Button
                    key={player.id}
                    variant="secondary"
                    aria-pressed={playerFilter === player.id}
                    onClick={() => setPlayerFilter(toggle(playerFilter, player.id))}
                  >
                    {player.name}
                  </Button>
                ))}
              </div>
              <div className={filterRowClass} role="group" aria-label={t('propertyFilterGroup')}>
                {propertyGroupIds.map((group) => (
                  <Button
                    key={group}
                    variant="secondary"
                    aria-pressed={groupFilter === group}
                    onClick={() => setGroupFilter(toggle(groupFilter, group))}
                  >
                    {t(propertyGroupKeys[group])}
                  </Button>
                ))}
              </div>
            </fieldset>
            {visible.length === 0 ? (
              <p className={emptyClass}>{t('propertyNoMatches')}</p>
            ) : (
              <ul className={listClass}>
                {visible.map((card) => (
                  <li key={card.tile.id}>
                    <PropertyTileButton
                      view={card}
                      owner={ownerOf(card)}
                      onOpen={() => setOpenTileId(card.tile.id)}
                    />
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </div>
      {openTile !== null && (
        <PropertyTileSheet
          board={board}
          views={views}
          view={openTile}
          players={players}
          currency={currency}
          actions={
            onIntent === undefined
              ? []
              : tileIntents(views, openTile, {
                  controlledPlayerIds,
                  actorPlayerId,
                  auctionsAvailable,
                }).map((intent) => ({
                  key: intent.kind,
                  label: t(intentLabelKeys[intent.kind]),
                  onSelect: () => onIntent(intent),
                }))
          }
          onClose={() => setOpenTileId(null)}
        />
      )}
    </Dialog>
  );
}
