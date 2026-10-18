import { normalizePropertyName } from '../../../shared/domain/mortgage';
import type { BankingDerived, BankingRequest } from './banking-dialog-derive';
import type { BankingFields, BankingInputs } from './banking-dialog-fields';
import { isPositiveInteger } from './game-page-helpers';

function generalChecks(
  inputs: BankingInputs,
  fields: BankingFields,
  d: BankingDerived,
  request: BankingRequest,
): boolean[] {
  return [
    request !== null,
    !d.targetRequired || (d.target !== null && d.target.id !== inputs.player.id),
    !d.amountRequired || isPositiveInteger(fields.amount),
    !d.exceedsBankToPlayerMax,
    fields.action !== 'JACKPOT_PAYOUT' || (inputs.rules.freeParkingJackpot && inputs.jackpot > 0),
  ];
}

function propertyChecks(fields: BankingFields, d: BankingDerived): boolean[] {
  const { action } = fields;
  return [
    !d.tileAction || d.selectedTile !== null || d.build.buildMode !== null,
    d.build.buildMode === null || d.build.preview?.ok === true,
    action !== 'PROPERTY_PURCHASE' || !fields.overrideOn || isPositiveInteger(fields.overridePrice),
    action !== 'PAY_RENT' || (d.rentAmount !== null && d.rentAmount > 0),
    action !== 'MORTGAGE' ||
      d.tileAction ||
      (normalizePropertyName(fields.propertyName) !== null && fields.noBuildings),
    action !== 'MORTGAGE_REDEMPTION' || d.mortgage.selected !== null,
  ];
}

function loanChecks(fields: BankingFields, d: BankingDerived): boolean[] {
  const { action } = fields;
  return [
    action !== 'LOAN_REPAYMENT' || (d.loan.selected !== null && !d.overRepayment),
    action !== 'BANK_LOAN' || (d.loan.bankLoan === null && !d.exceedsBankLoanMax),
  ];
}

export function isFormValid(
  inputs: BankingInputs,
  fields: BankingFields,
  d: BankingDerived,
  request: BankingRequest,
): boolean {
  return [
    ...generalChecks(inputs, fields, d, request),
    ...propertyChecks(fields, d),
    ...loanChecks(fields, d),
  ].every(Boolean);
}
