import { buildGameSettings } from '../../../shared/domain/game-rules';
import { normalizePropertyName, redemptionCost } from '../../../shared/domain/mortgage';
import type { InterestRatePercent, Loan } from '../../../shared/types/monopoly';
import {
  activeBankLoan,
  activeLoansAsBorrower,
  loanInterest,
  loanOutstanding,
} from '../../utils/loans';
import {
  buildingGroups,
  isDiceSum,
  previewBuildings,
  rentDue,
  tileViews,
} from '../../utils/property-view';
import { commentlessActions, isIn, reviewOnlyActions, tileActions } from './banking-actions';
import type { BankingFields, BankingInputs } from './banking-dialog-fields';
import {
  amountValueOf,
  buildModeOf,
  effectiveBuildLevels,
  effectiveTargetIdOf,
  exceedsBankLoanMax,
  exceedsBankToPlayerMax,
  quickBuildLevels,
  requestActionOf,
  resolveBuildGroup,
  tileAmountOf,
} from './banking-dialog-model';
import { buildRequest, isPositiveInteger, previewBalances } from './game-page-helpers';

function deriveTile(inputs: BankingInputs, fields: BankingFields) {
  const { action } = fields;
  const board = inputs.settings?.board ?? null;
  const views = board === null ? [] : tileViews(board, inputs.properties);
  const tileAction = board !== null && isIn(tileActions, action);
  const selectedTile = views.find((view) => view.tile.id === fields.tileId) ?? null;
  const diceSumValue = fields.diceSum === '' ? undefined : Number(fields.diceSum);
  const needsDiceSum = action === 'PAY_RENT' && selectedTile?.tile.type === 'utility';
  const rentAmount =
    action === 'PAY_RENT' && board !== null && selectedTile !== null
      ? rentDue(board, views, selectedTile, diceSumValue)
      : null;
  const overridePriceValid = isPositiveInteger(fields.overridePrice);
  const purchaseOverride =
    action === 'PROPERTY_PURCHASE' &&
    fields.overrideOn &&
    selectedTile !== null &&
    overridePriceValid &&
    Number(fields.overridePrice) !== selectedTile.tile.price
      ? Number(fields.overridePrice)
      : undefined;
  return {
    board,
    views,
    tileAction,
    selectedTile,
    diceSumValue,
    needsDiceSum,
    rentAmount,
    purchaseOverride,
    diceSumInvalid: needsDiceSum && fields.diceSum !== '' && !isDiceSum(Number(fields.diceSum)),
  };
}

function deriveBuild(
  inputs: BankingInputs,
  fields: BankingFields,
  tile: ReturnType<typeof deriveTile>,
) {
  const { board, views, selectedTile } = tile;
  const buildMode = buildModeOf(fields.action);
  const groupIds =
    board !== null && buildMode !== null
      ? buildingGroups(board, views, inputs.player.id, buildMode)
      : [];
  const quickGroup = selectedTile?.tile.group;
  const group = resolveBuildGroup(fields.buildGroup, groupIds, quickGroup);
  const levels = effectiveBuildLevels(
    group,
    fields.buildLevels,
    quickGroup,
    quickBuildLevels(selectedTile, buildMode),
  );
  const preview =
    board !== null && buildMode !== null && group !== ''
      ? previewBuildings(board, views, inputs.player.id, levels, buildMode)
      : null;
  return { buildMode, groupIds, group, levels, preview };
}

function deriveLoans(inputs: BankingInputs, fields: BankingFields) {
  const { player, loans, rules } = inputs;
  const playerLoans = rules.playerLoans ? activeLoansAsBorrower(loans, player.id) : [];
  const bankLoan = rules.bankLoans ? activeBankLoan(loans, player.id) : null;
  const repayable: Loan[] = bankLoan === null ? playerLoans : [...playerLoans, bankLoan];
  const selected = repayable.find((item) => item.id === fields.loanId) ?? null;
  const isBankRepayment = fields.action === 'LOAN_REPAYMENT' && selected?.lenderKind === 'BANK';
  const rate: InterestRatePercent =
    fields.ratePercent ?? selected?.rounds?.suggestedRatePercent ?? 0;
  const settings =
    inputs.settings ??
    (inputs.startingBalance === undefined ? null : buildGameSettings(inputs.startingBalance));
  const owed = selected === null ? 0 : loanOutstanding(selected);
  return {
    bankLoan,
    repayable,
    selected,
    isBankRepayment,
    rate,
    owed,
    interest: isBankRepayment ? loanInterest(owed, rate) : 0,
    bankLoanMax: settings?.bankLoanMax ?? null,
    cooldown: inputs.bankLoanCooldowns.find((item) => item.playerId === player.id) ?? null,
  };
}

function deriveMortgages(inputs: BankingInputs, fields: BankingFields, effectiveTargetId: string) {
  const playerMortgages = inputs.mortgages.filter((item) => item.playerId === inputs.player.id);
  const selected = playerMortgages.find((item) => item.id === fields.mortgageId) ?? null;
  return {
    playerMortgages,
    selected,
    redemptionAmount: selected === null ? 0 : redemptionCost(selected.mortgageValue),
    targetMortgages: inputs.mortgages.filter((item) => item.playerId === effectiveTargetId),
    tidyName: normalizePropertyName(fields.propertyName) ?? fields.propertyName.trim(),
  };
}

function deriveParties(
  inputs: BankingInputs,
  fields: BankingFields,
  tile: ReturnType<typeof deriveTile>,
  loan: ReturnType<typeof deriveLoans>,
  tileAmount: number,
) {
  const { action } = fields;
  const targetRequired = action === 'PLAYER_TO_PLAYER' || action === 'LOAN_ISSUE';
  const recipients = inputs.players.filter(
    (candidate) =>
      candidate.id !== inputs.player.id &&
      (action !== 'LOAN_ISSUE' || candidate.status !== 'BANKRUPT'),
  );
  const soleRecipient = targetRequired && recipients.length === 1 ? recipients[0] : undefined;
  const effectiveTargetId = effectiveTargetIdOf({
    action,
    targetId: fields.targetId,
    selectedLoan: loan.selected,
    selectedTile: tile.selectedTile,
    soleRecipient,
  });
  return {
    targetRequired,
    recipients,
    effectiveTargetId,
    target: inputs.players.find((candidate) => candidate.id === effectiveTargetId) ?? null,
    amountValue: amountValueOf(action, inputs.jackpot, tile.tileAction, tileAmount, fields.amount),
  };
}

export function deriveBanking(inputs: BankingInputs, fields: BankingFields) {
  const { action } = fields;
  const tile = deriveTile(inputs, fields);
  const build = deriveBuild(inputs, fields, tile);
  const loan = deriveLoans(inputs, fields);
  const tileAmount = tileAmountOf({
    action,
    buildMode: build.buildMode,
    buildPreview: build.preview,
    selectedTile: tile.selectedTile,
    purchaseOverride: tile.purchaseOverride,
    rentAmount: tile.rentAmount,
  });
  const parties = deriveParties(inputs, fields, tile, loan, tileAmount);
  const { amountValue } = parties;
  return {
    ...tile,
    ...parties,
    build,
    loan,
    tileAmount,
    mortgage: deriveMortgages(inputs, fields, parties.effectiveTargetId),
    requestAction: requestActionOf(action, fields.payToPot, inputs.rules.freeParkingJackpot),
    amountRequired: !isIn(reviewOnlyActions, action) && !tile.tileAction,
    reward: fields.exactLanding ? inputs.passGoReward * 2 : inputs.passGoReward,
    commentless: isIn(commentlessActions, action),
    overRepayment: action === 'LOAN_REPAYMENT' && amountValue > loan.owed && loan.owed > 0,
    exceedsBankLoanMax: exceedsBankLoanMax(action, amountValue, loan.bankLoanMax),
    exceedsBankToPlayerMax: exceedsBankToPlayerMax(action, amountValue),
  };
}

export type BankingDerived = ReturnType<typeof deriveBanking>;

export function requestFor(inputs: BankingInputs, fields: BankingFields, d: BankingDerived) {
  if (d.requestAction === null) return null;
  const { build, loan, mortgage } = d;
  return buildRequest(
    d.requestAction,
    inputs.player.id,
    d.effectiveTargetId,
    d.amountValue,
    fields.comment,
    {
      exactLanding: fields.exactLanding,
      ...(d.tileAction && build.buildMode === null ? { tileId: fields.tileId } : {}),
      ...(build.preview?.ok === true ? { targets: build.preview.targets } : {}),
      ...(d.purchaseOverride === undefined ? {} : { priceOverride: d.purchaseOverride }),
      ...(d.needsDiceSum && d.diceSumValue !== undefined ? { diceSum: d.diceSumValue } : {}),
      propertyName: mortgage.tidyName,
      mortgageId: fields.mortgageId,
      loanId: fields.loanId,
      ...(loan.isBankRepayment ? { interestRatePercent: loan.rate } : {}),
      acknowledgeCooldown: fields.cooldownAcknowledged,
    },
  );
}

export type BankingRequest = ReturnType<typeof requestFor>;

export function previewFor(inputs: BankingInputs, d: BankingDerived, request: BankingRequest) {
  if (request === null) return [];
  return previewBalances(
    request,
    inputs.players,
    d.reward,
    d.mortgage.redemptionAmount,
    inputs.loans,
    d.loan.interest,
    inputs.jackpot,
    { amount: d.tileAmount, ownerPlayerId: d.selectedTile?.ownerPlayerId ?? null },
  );
}
