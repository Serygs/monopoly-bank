import { monopolyBankApi } from '../../api/monopoly-bank-api';
import type { CreateTransactionResponse } from '../../../shared/contracts/api';
import { completedAmount, cooldownRetryRounds } from './banking-dialog-model';
import type { BankingRequest } from './banking-dialog-derive';
import type { BankingFields } from './banking-dialog-fields';
import type { BankingDialogProps } from './banking-dialog-types';
import type { BankingState } from './useBankingState';
import type { ActionType } from './game-page-helpers';

export interface SubmitInput {
  props: BankingDialogProps;
  state: BankingState;
  action: ActionType | null;
  /** One operation, or several (a batch of mortgages or redemptions), recorded in this order. */
  requests: readonly BankingRequest[];
  valid: boolean;
  targetName: string | undefined;
  /** The fields that keep only the given batch ids chosen (after part of a batch went through). */
  batchPatch: (remainingIds: string[]) => Partial<BankingFields>;
}

type Request = NonNullable<BankingRequest>;

/**
 * Each operation keeps its command id until the form changes, so a retry after a lost response
 * is deduplicated by the server instead of being recorded twice.
 */
function commandIdFor(state: BankingState, request: Request): string {
  const key = JSON.stringify(request);
  const known = state.commandIdsRef.current.get(key);
  if (known !== undefined) return known;
  const fresh = crypto.randomUUID();
  state.commandIdsRef.current.set(key, fresh);
  return fresh;
}

export function useBankingSubmit(input: SubmitInput) {
  const { props, state, action, requests, valid, targetName } = input;
  const { patch, setError, setSubmitting, submittingRef, commandIdsRef } = state;

  return async () => {
    const batch = requests.filter((request): request is Request => request !== null);
    if (submittingRef.current || batch.length !== requests.length || batch.length === 0) return;
    if (!valid || action === null) return;
    submittingRef.current = true;
    setSubmitting(true);
    setError(null);
    const done: CreateTransactionResponse[] = [];
    try {
      for (const request of batch) {
        const result = await monopolyBankApi.createTransaction(
          props.gameId,
          request,
          commandIdFor(state, request),
        );
        if ('paymentRequests' in result) {
          props.onPaymentRequested(action, targetName);
          return;
        }
        done.push(result);
      }
      const last = done.at(-1);
      if (last === undefined) return;
      const total = done.reduce((sum, result) => sum + result.transaction.amount, 0);
      props.onCompleted(
        last.players,
        action,
        completedAmount(action, total),
        last.mortgages,
        last.loans,
        last.bankLoanCooldowns,
        last.jackpot,
        last.properties,
      );
    } catch (caught) {
      const rounds = cooldownRetryRounds(caught);
      if (rounds === null) {
        setError(caught);
        // The operations already recorded stay recorded; only the rest is left to retry.
        if (done.length > 0) {
          patch(input.batchPatch(remainingBatch(done, input)));
        }
      } else {
        patch({ cooldownRounds: rounds, cooldownAcknowledged: false, confirming: false });
        commandIdsRef.current.clear();
      }
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  };
}

/** The batch ids still to record after the first `done.length` operations went through. */
function remainingBatch(done: readonly CreateTransactionResponse[], input: SubmitInput): string[] {
  return input.requests.slice(done.length).flatMap((request) => {
    if (request === null) return [];
    if ('mortgageId' in request) return [request.mortgageId];
    return 'tileId' in request && typeof request.tileId === 'string' ? [request.tileId] : [];
  });
}
