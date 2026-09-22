import type { GameDetails } from '../../shared/contracts/api';
import { BankingDomainError } from '../../shared/domain/banking-rules';
import { netWorth } from '../../shared/domain/net-worth';
import { buildHouses, calculateRent, mortgageProperty, purchaseProperty, sellBuildings, unmortgageProperty, type PropertyCommand } from '../../shared/domain/property';
import { colorGroups, hotelHouseLevel, type BoardDefinition, type BoardSpace, type BuildingBank, type ColorGroup, type Game, type GameProperty, type Player } from '../../shared/types/monopoly';
import { apiErrorTranslationKey } from '../i18n/api-errors';
import type { TranslationKey, TranslationValues } from '../i18n/translations';

/** The four board fields of `GameDetails`, present together or not at all. */
export interface BoardState {
  board: BoardDefinition;
  boardSpaces: BoardSpace[];
  properties: GameProperty[];
  buildingBank: BuildingBank;
}

/**
 * The single feature flag of the board UI. Every board-only element renders
 * behind this check, so a game that never chose a board keeps the page it had.
 */
export function hasBoard(details: GameDetails): details is GameDetails & BoardState {
  return details.board !== undefined && details.boardSpaces !== undefined && details.properties !== undefined && details.buildingBank !== undefined;
}

export function boardState(details: GameDetails): BoardState | null {
  return hasBoard(details) ? { board: details.board, boardSpaces: details.boardSpaces, properties: details.properties, buildingBank: details.buildingBank } : null;
}

/** A space with no ownership row has never been bought. Mirrors the domain's default. */
export function propertyOf(properties: readonly GameProperty[], boardSpaceId: string): GameProperty {
  return properties.find((property) => property.boardSpaceId === boardSpaceId) ?? { boardSpaceId, ownerPlayerId: null, houses: 0, mortgaged: false };
}

export interface SpaceGroup { group: ColorGroup; spaces: BoardSpace[]; }

/** Spaces by colour group in board order, groups in the canonical brown-to-dark-blue order with railroads and utilities last. */
export function groupSpaces(spaces: readonly BoardSpace[]): SpaceGroup[] {
  return colorGroups
    .map((group) => ({ group, spaces: spaces.filter((space) => space.colorGroup === group).sort((left, right) => left.boardIndex - right.boardIndex) }))
    .filter((entry) => entry.spaces.length > 0);
}

export function spacesOwnedBy(state: BoardState, playerId: string): BoardSpace[] {
  return state.boardSpaces.filter((space) => propertyOf(state.properties, space.id).ownerPlayerId === playerId).sort((left, right) => left.boardIndex - right.boardIndex);
}

export function freeSpaces(state: BoardState): BoardSpace[] {
  return state.boardSpaces.filter((space) => propertyOf(state.properties, space.id).ownerPlayerId === null).sort((left, right) => left.boardIndex - right.boardIndex);
}

/** `GAME_COMMITTED` carries only the deed rows a commit changed; they replace the matching rows by space id. */
export function mergeProperties(current: readonly GameProperty[], changed: readonly GameProperty[]): GameProperty[] {
  if (changed.length === 0) return [...current];
  const merged = new Map(current.map((property) => [property.boardSpaceId, property]));
  for (const property of changed) merged.set(property.boardSpaceId, property);
  return [...merged.values()];
}

/** Capital as the domain defines it, so the wallet figure equals the server's `netWorth` for the same snapshot. */
export function playerNetWorth(player: Player, state: BoardState): number {
  return netWorth(player, state.boardSpaces, state.properties);
}

export type SpaceActionKind = 'PURCHASE' | 'AUCTION' | 'PAY_RENT' | 'CHARGE_RENT' | 'BUILD' | 'SELL_BUILDINGS' | 'MORTGAGE' | 'UNMORTGAGE';

export interface SpaceAction {
  kind: SpaceActionKind;
  /** The figure shown before confirmation; `null` when it depends on input the dialog still has to collect (a utility's dice total, the rent payer). */
  amount: number | null;
  enabled: boolean;
  /** Why the action is unavailable right now, already a catalogue key. */
  reason: TranslationKey | null;
  reasonValues?: TranslationValues;
}

export interface SpaceActionContext {
  game: Game;
  players: readonly Player[];
  state: BoardState;
  /** The wallet the actor controls; `null` for a spectator, who sees the deed but can do nothing. */
  actor: Player | null;
}

/**
 * The actions a tap on a space may offer right now. Each candidate is priced
 * and vetted by running the very domain function the server will run, so the
 * number shown before confirmation is the number the server will commit and a
 * disabled action carries the server's own reason.
 */
export function spaceActions(context: SpaceActionContext, space: BoardSpace): SpaceAction[] {
  const { state, actor } = context;
  const property = propertyOf(state.properties, space.id);
  if (actor === null) return [];
  const base = propertyCommand(context);

  if (property.ownerPlayerId === null) {
    return [
      attempt('PURCHASE', space.price, () => purchaseProperty({ ...base, playerId: actor.id, boardSpaceId: space.id }).transaction.totalAmount),
      { kind: 'AUCTION', amount: null, enabled: true, reason: null },
    ];
  }

  if (property.ownerPlayerId !== actor.id) {
    if (property.mortgaged) return [{ kind: 'PAY_RENT', amount: null, enabled: false, reason: 'reasonMortgaged' }];
    return [{ kind: 'PAY_RENT', amount: rentFor(context, space, actor.lastRollTotal ?? undefined), enabled: true, reason: null }];
  }

  const actions: SpaceAction[] = [];
  actions.push(property.mortgaged
    ? { kind: 'CHARGE_RENT', amount: null, enabled: false, reason: 'reasonMortgaged' }
    : { kind: 'CHARGE_RENT', amount: space.kind === 'UTILITY' ? null : rentFor(context, space), enabled: true, reason: null });
  if (space.kind === 'STREET') {
    actions.push(property.houses >= hotelHouseLevel
      ? { kind: 'BUILD', amount: space.houseCost, enabled: false, reason: 'reasonHotelBuilt' }
      : attempt('BUILD', space.houseCost, () => buildHouses({ ...base, playerId: actor.id, boardSpaceId: space.id, count: 1 }).transaction.totalAmount, { group: space.colorGroup }));
    actions.push(property.houses === 0
      ? { kind: 'SELL_BUILDINGS', amount: null, enabled: false, reason: 'reasonNoBuildings' }
      : attempt('SELL_BUILDINGS', null, () => sellBuildings({ ...base, playerId: actor.id, boardSpaceId: space.id, count: 1 }).transaction.amount));
  }
  actions.push(property.mortgaged
    ? attempt('UNMORTGAGE', null, () => unmortgageProperty({ ...base, playerId: actor.id, boardSpaceId: space.id }).transaction.totalAmount)
    : attempt('MORTGAGE', space.mortgageValue, () => mortgageProperty({ ...base, playerId: actor.id, boardSpaceId: space.id }).transaction.totalAmount));
  return actions;
}

/** The rent the domain would charge for `space` right now, or `null` when it cannot be priced yet (a utility without a dice total, a mortgaged or unowned deed). */
export function rentFor(context: Pick<SpaceActionContext, 'game' | 'players' | 'state'>, space: BoardSpace, diceTotal?: number): number | null {
  try {
    return calculateRent({ ...propertyCommand(context), boardSpaceId: space.id, ...(diceTotal === undefined ? {} : { diceTotal }) });
  } catch {
    return null;
  }
}

/** The domain's verdict on a candidate operation, as the dialog's enabled state and reason. */
export function vetOperation(run: () => number): { amount: number | null; enabled: boolean; reason: TranslationKey | null } {
  try {
    return { amount: run(), enabled: true, reason: null };
  } catch (caught) {
    return { amount: null, enabled: false, reason: reasonFor(caught) };
  }
}

/** How many building levels `buildHouses`/`sellBuildings` accepts on `space` right now, checked one count at a time against the domain. */
export function buildableCounts(context: SpaceActionContext, space: BoardSpace, direction: 'BUILD' | 'SELL'): number[] {
  if (context.actor === null) return [];
  const actor = context.actor;
  const base = propertyCommand(context);
  const counts: number[] = [];
  for (let count = 1; count <= hotelHouseLevel; count += 1) {
    const verdict = vetOperation(() => direction === 'BUILD'
      ? buildHouses({ ...base, playerId: actor.id, boardSpaceId: space.id, count }).transaction.totalAmount
      : sellBuildings({ ...base, playerId: actor.id, boardSpaceId: space.id, count }).transaction.totalAmount);
    if (verdict.enabled) counts.push(count);
  }
  return counts;
}

export function propertyCommand(context: Pick<SpaceActionContext, 'game' | 'players' | 'state'>): PropertyCommand {
  return { game: context.game, players: context.players, board: context.state.board, spaces: context.state.boardSpaces, properties: context.state.properties, buildingBank: context.state.buildingBank };
}

function attempt(kind: SpaceActionKind, fallbackAmount: number | null, run: () => number, reasonValues?: TranslationValues): SpaceAction {
  const verdict = vetOperation(run);
  return { kind, amount: verdict.amount ?? fallbackAmount, enabled: verdict.enabled, reason: verdict.reason, ...(reasonValues === undefined ? {} : { reasonValues }) };
}

function reasonFor(caught: unknown): TranslationKey {
  if (caught instanceof BankingDomainError) return apiErrorTranslationKey(caught.code) ?? 'actionUnavailable';
  return 'actionUnavailable';
}

/**
 * WCAG 2.x relative luminance contrast between two `#rrggbb` colours. Lives
 * here so the theme tokens of the colour groups can be checked numerically.
 */
export function contrastRatio(foreground: string, background: string): number {
  const light = relativeLuminance(foreground);
  const dark = relativeLuminance(background);
  const [brighter, dimmer] = light > dark ? [light, dark] : [dark, light];
  return (brighter + 0.05) / (dimmer + 0.05);
}

function relativeLuminance(hex: string): number {
  const match = /^#([0-9a-f]{6})$/iu.exec(hex.trim());
  if (match === null) throw new Error(`Expected a #rrggbb colour, received "${hex}".`);
  const channels = [0, 2, 4].map((offset) => Number.parseInt(match[1].slice(offset, offset + 2), 16) / 255).map((channel) => (channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4));
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}
