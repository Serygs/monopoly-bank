import { monopolyBankApi } from '../../api/monopoly-bank-api';
import { completedAmount, cooldownRetryRounds } from './banking-dialog-model';
import type { BankingRequest } from './banking-dialog-derive';
import type { BankingDialogProps } from './banking-dialog-types';
import type { BankingState } from './useBankingState';
import type { ActionType } from './game-page-helpers';

export interface SubmitInput {
  props: BankingDialogProps;
  state: BankingState;
  action: ActionType | null;
  request: BankingRequest;
  valid: boolean;
  targetName: string | undefined;
}

export function useBankingSubmit(input: SubmitInput) {
  const { props, state, action, request, valid, targetName } = input;
  const { patch, setError, setSubmitting, submittingRef, commandIdRef } = state;

  return async () => {
    if (submittingRef.current || request === null || !valid || action === null) return;
    submittingRef.current = true;
    setSubmitting(true);
    setError(null);
    try {
      const commandId = commandIdRef.current ?? crypto.randomUUID();
      commandIdRef.current = commandId;
      const result = await monopolyBankApi.createTransaction(props.gameId, request, commandId);
      if ('paymentRequests' in result) props.onPaymentRequested(action, targetName);
      else
        props.onCompleted(
          result.players,
          action,
          completedAmount(action, result.transaction.amount),
          result.mortgages,
          result.loans,
          result.bankLoanCooldowns,
          result.jackpot,
          result.properties,
        );
    } catch (caught) {
      const rounds = cooldownRetryRounds(caught);
      if (rounds === null) setError(caught);
      else {
        patch({ cooldownRounds: rounds, cooldownAcknowledged: false, confirming: false });
        commandIdRef.current = null;
      }
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };
}
