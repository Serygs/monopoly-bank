import type { PropertyGroupId } from '../../../shared/board';
import { BANK_TO_PLAYER_MAX_AMOUNT } from '../../../shared/domain/banking';
import { MAX_BUILDINGS } from '../../../shared/domain/property';
import type { Loan, Player } from '../../../shared/types/monopoly';
import { MonopolyBankApiError } from '../../api/monopoly-bank-api';
import type { BuildMode, BuildingPreview, TileView } from '../../utils/property-view';
import { amountlessResultActions } from './banking-actions';
import type { ActionType } from './game-page-helpers';

export function resolveBuildGroup(
  picked: PropertyGroupId | '',
  groupIds: readonly PropertyGroupId[],
  quickGroup: PropertyGroupId | undefined,
): PropertyGroupId | '' {
  if (picked !== '' && groupIds.includes(picked)) return picked;
  if (quickGroup !== undefined && groupIds.includes(quickGroup)) return quickGroup;
  return groupIds.length === 1 ? (groupIds[0] ?? '') : '';
}

export function buildModeOf(action: ActionType | null): BuildMode | null {
  if (action === 'PROPERTY_BUILD') return 'BUILD';
  return action === 'PROPERTY_SELL_BUILDING' ? 'SELL' : null;
}

export function quickBuildLevels(
  selected: TileView | null,
  mode: BuildMode | null,
): Record<string, number> {
  if (selected === null || mode === null) return {};
  const level = selected.houses + (mode === 'BUILD' ? 1 : -1);
  return { [selected.tile.id]: Math.min(MAX_BUILDINGS, Math.max(0, level)) };
}

export function effectiveBuildLevels(
  group: PropertyGroupId | '',
  levels: Record<string, number> | null,
  quickGroup: PropertyGroupId | undefined,
  quickLevels: Record<string, number>,
): Record<string, number> {
  if (group === '') return {};
  return levels ?? (quickGroup === group ? quickLevels : {});
}

export interface TileAmountInput {
  action: ActionType | null;
  buildMode: BuildMode | null;
  buildPreview: BuildingPreview | null;
  selectedTile: TileView | null;
  purchaseOverride: number | undefined;
  rentAmount: number | null;
}

export function tileAmountOf(input: TileAmountInput): number {
  const { action, buildMode, buildPreview, selectedTile } = input;
  if (buildMode !== null) return buildPreview?.ok === true ? buildPreview.amount : 0;
  if (selectedTile === null) return 0;
  if (action === 'PROPERTY_PURCHASE') return input.purchaseOverride ?? selectedTile.tile.price;
  if (action === 'MORTGAGE') return selectedTile.tile.mortgage;
  return input.rentAmount ?? 0;
}

export function amountValueOf(
  action: ActionType | null,
  jackpot: number,
  tileAction: boolean,
  tileAmount: number,
  amount: string,
): number {
  if (action === 'JACKPOT_PAYOUT') return jackpot;
  return tileAction ? tileAmount : Number(amount);
}

export function requestActionOf(
  action: ActionType | null,
  payToPot: boolean,
  jackpotRule: boolean,
): ActionType | null {
  return action === 'PLAYER_TO_BANK' && payToPot && jackpotRule ? 'TO_JACKPOT' : action;
}

export interface TargetInput {
  action: ActionType | null;
  targetId: string;
  selectedLoan: Loan | null;
  selectedTile: TileView | null;
  soleRecipient: Player | undefined;
}

export function effectiveTargetIdOf(input: TargetInput): string {
  if (input.action === 'LOAN_REPAYMENT') return input.selectedLoan?.lenderPlayerId ?? '';
  if (input.action === 'PAY_RENT') return input.selectedTile?.ownerPlayerId ?? '';
  return input.targetId !== '' ? input.targetId : (input.soleRecipient?.id ?? '');
}

export function exceedsBankToPlayerMax(action: ActionType | null, amountValue: number): boolean {
  return action === 'BANK_TO_PLAYER' && amountValue > BANK_TO_PLAYER_MAX_AMOUNT;
}

export function exceedsBankLoanMax(
  action: ActionType | null,
  amountValue: number,
  bankLoanMax: number | null,
): boolean {
  return action === 'BANK_LOAN' && bankLoanMax !== null && amountValue > bankLoanMax;
}

export function cooldownRetryRounds(caught: unknown): number | null {
  if (!(caught instanceof MonopolyBankApiError) || caught.code !== 'BANK_LOAN_COOLDOWN')
    return null;
  const left = caught.details?.roundsLeft;
  return typeof left === 'number' ? left : 1;
}

export function completedAmount(action: ActionType, transactionAmount: number): number | null {
  return amountlessResultActions.has(action) ? null : transactionAmount;
}
