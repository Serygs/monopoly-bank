import { useState } from 'react';
import type { BoardSnapshot } from '../../shared/board';
import type { Currency, GameProperty, Player } from '../../shared/types/monopoly';
import { Dialog } from '../components/Dialog';
import { PropertyTileButton, PropertyTileSheet } from '../components/game/PropertyTile';
import { propertyGroupKeys } from '../components/game/property-labels';
import { GroupHeader, SegmentedControl, StatTile } from '../components/ui';
import { wideDialogClass } from '../components/ui/class-names';
import { useLanguage } from '../i18n/language-context';
import { noPropertyFilters, type PropertyFilterState } from '../utils/property-filters';
import { PropertyFilters } from './PropertyFilters';
import { formatMoney } from '../utils/money';
import {
  cardsByGroup,
  cardsOwnedBy,
  cardsValue,
  groupOrder,
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
  PROPERTY_BUILD: 'propertyActionBuild',
  PROPERTY_SELL_BUILDING: 'propertyActionSellBuilding',
  PROPERTY_TRANSFER: 'propertyActionTrade',
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
const sectionTitleClass = 'm-0 text-body font-semibold';
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
  const [view, setView] = useState<PropertyView>('MINE');
  const [filters, setFilters] = useState<PropertyFilterState>(noPropertyFilters);
  const [openTileId, setOpenTileId] = useState<string | null>(null);
  const views = tileViews(board, properties);
  const ownerOf = (card: TileView) =>
    players.find((player) => player.id === card.ownerPlayerId) ?? null;
  const mine = cardsOwnedBy(views, controlledPlayerIds);
  const order = groupOrder(views);
  const visible = views.filter(
    (card) =>
      (filters.owner === 'ALL' ||
        (filters.owner === 'FREE'
          ? card.status === 'free'
          : card.ownerPlayerId === filters.owner)) &&
      (filters.groups.length === 0 || filters.groups.includes(card.tile.group)),
  );
  const freeCards = visible.filter((card) => card.status === 'free');
  const ownedCards = visible.filter((card) => card.status !== 'free');
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
  const row = (card: TileView, withRent: boolean) => (
    <li key={card.tile.id}>
      <PropertyTileButton
        view={card}
        owner={ownerOf(card)}
        price={formatMoney(card.tile.price, currency)}
        rent={withRent ? rentLabel(card) : null}
        onOpen={() => setOpenTileId(card.tile.id)}
      />
    </li>
  );
  const priceRange = (cards: readonly TileView[]): string => {
    const prices = cards.map((card) => card.tile.price);
    const low = Math.min(...prices);
    const high = Math.max(...prices);
    return low === high
      ? formatMoney(low, currency)
      : `${formatMoney(low, currency)} – ${formatMoney(high, currency)}`;
  };
  /** Colour groups with a sticky header (colour, name, count), the cards of each below it. */
  const groupedList = (cards: readonly TileView[], progressOwner: boolean) =>
    cardsByGroup(cards, order).map(({ group, cards: inGroup }) => {
      // Progress is counted per owner; the first card's owner decides in the owned views.
      const progress = progressOwner
        ? groupProgress(views, group, inGroup[0]?.ownerPlayerId ?? '')
        : null;
      return (
        <section key={group} className="grid gap-(--mb-space-2)" data-group={group}>
          <GroupHeader
            sticky
            color={propertyGroupColors[group]}
            name={t(propertyGroupKeys[group])}
            count={progress === null ? inGroup.length : `${progress.owned}/${progress.size}`}
            countLabel={
              progress === null
                ? undefined
                : t('propertyGroupProgressAria', { owned: progress.owned, size: progress.size })
            }
            priceRange={priceRange(inGroup)}
            badge={
              progress?.monopoly === true ? (
                <span className="rounded-pill bg-accent px-(--mb-space-2) text-meta text-on-accent">
                  {t('propertyMonopoly')}
                </span>
              ) : undefined
            }
          />
          <ul className={listClass}>{inGroup.map((card) => row(card, true))}</ul>
        </section>
      );
    });

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
        {view === 'MINE' && mine.length > 0 && (
          <div className="grid grid-cols-2 gap-(--mb-space-2)" data-section="mine-stats">
            <StatTile label={t('propertyStatCards')} value={mine.length} />
            <StatTile
              label={t('propertyStatValue')}
              value={formatMoney(cardsValue(mine), currency)}
            />
          </div>
        )}
        {view === 'MINE' && groupedList(mine, true)}
        {view === 'ALL' && (
          <>
            <PropertyFilters
              players={players}
              groupIds={order}
              filters={filters}
              onChange={setFilters}
            />
            {visible.length === 0 && <p className={emptyClass}>{t('propertyNoMatches')}</p>}
            {freeCards.length > 0 && (
              <section className="grid gap-(--mb-space-3)" data-section="free">
                <h3 className={sectionTitleClass}>
                  {t('propertySectionFree', { count: freeCards.length })}
                </h3>
                {groupedList(freeCards, false)}
              </section>
            )}
            {ownedCards.length > 0 && (
              <section className="grid gap-(--mb-space-3)" data-section="owned">
                <h3 className={sectionTitleClass}>
                  {t('propertySectionOwned', { count: ownedCards.length })}
                </h3>
                {groupedList(ownedCards, false)}
              </section>
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
              : tileIntents(board, views, openTile, {
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
