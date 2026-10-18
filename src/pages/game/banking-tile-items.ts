import { redemptionCost } from '../../../shared/domain/mortgage';
import type { Mortgage } from '../../../shared/types/monopoly';
import type { Translate } from '../../i18n/translations';
import {
  buildableTiles,
  freeTiles,
  mortgageableTiles,
  rentableTiles,
  sellableTiles,
  tileRent,
  type TileView,
} from '../../utils/property-view';
import type { BankingDerived } from './banking-dialog-derive';
import type { BankingInputs } from './banking-dialog-fields';
import type { TilePickerItem } from './TilePicker';

export interface TileItems {
  buy: TilePickerItem[];
  mortgage: TilePickerItem[];
  redeem: TilePickerItem[];
  rent: TilePickerItem[];
  tileMortgages: Mortgage[];
  canBuildAny: boolean;
  canSellAny: boolean;
}

type Money = (value: number) => string;

function redeemItems(
  tileMortgages: Mortgage[],
  views: TileView[],
  t: Translate,
  money: Money,
): TilePickerItem[] {
  return tileMortgages.flatMap((item) => {
    const view = views.find((candidate) => candidate.tile.id === item.tileId);
    if (view === undefined) return [];
    const amount = money(redemptionCost(item.mortgageValue));
    return [{ view, caption: t('tilePickerRedeemFor', { amount }) }];
  });
}

function rentItems(
  inputs: BankingInputs,
  d: BankingDerived,
  t: Translate,
  money: Money,
): TilePickerItem[] {
  const { board, views } = d;
  if (board === null) return [];
  const ownerName = (view: TileView) =>
    inputs.players.find((candidate) => candidate.id === view.ownerPlayerId)?.name ?? '';
  return rentableTiles(views, inputs.player.id).map((view) => {
    const rent = tileRent(board, views, view);
    const owner = ownerName(view);
    const caption =
      rent.kind === 'dice'
        ? t('tilePickerRentDice', { owner, multiplier: rent.multiplier })
        : t('tilePickerRent', { owner, amount: money(rent.kind === 'amount' ? rent.amount : 0) });
    return { view, caption };
  });
}

export function tileItems(
  inputs: BankingInputs,
  d: BankingDerived,
  t: Translate,
  money: Money,
): TileItems {
  const { board, views } = d;
  const playerId = inputs.player.id;
  const tileMortgages = d.mortgage.playerMortgages.filter(
    (item) => item.tileId != null && views.some((view) => view.tile.id === item.tileId),
  );
  return {
    buy: freeTiles(views).map((view) => ({
      view,
      caption: t('tilePickerPrice', { amount: money(view.tile.price) }),
    })),
    mortgage: mortgageableTiles(views, playerId).map((view) => ({
      view,
      caption: t('tilePickerMortgageFor', { amount: money(view.tile.mortgage) }),
    })),
    redeem: redeemItems(tileMortgages, views, t, money),
    rent: rentItems(inputs, d, t, money),
    tileMortgages,
    canBuildAny: board !== null && buildableTiles(board, views, playerId).length > 0,
    canSellAny: board !== null && sellableTiles(board, views, playerId).length > 0,
  };
}

export function confirmedPropertyName(
  d: BankingDerived,
  action: string | null,
  t: Translate,
  buildingLabel: (houses: number) => string | null,
): string | undefined {
  const { preview } = d.build;
  if (preview?.ok === true) {
    const none = t('buildingNone');
    return d.views
      .filter((view) => preview.targets[view.tile.id] !== undefined)
      .map((view) =>
        t('buildingsSummaryLine', {
          name: view.tile.name,
          from: buildingLabel(view.houses) ?? none,
          to: buildingLabel(preview.targets[view.tile.id] ?? view.houses) ?? none,
        }),
      )
      .join('\n');
  }
  if (d.selectedTile !== null && d.tileAction) return d.selectedTile.tile.name;
  return action === 'MORTGAGE' ? d.mortgage.tidyName : d.mortgage.selected?.propertyName;
}
