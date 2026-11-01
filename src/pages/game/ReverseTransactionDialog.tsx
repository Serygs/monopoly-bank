import { useRef, useState } from 'react';
import type { Currency, Player, Transaction } from '../../../shared/types/monopoly';
import { monopolyBankApi } from '../../api/monopoly-bank-api';
import { Dialog } from '../../components/Dialog';
import { Button, SheetActions, DialogBody, Field, MoneyValue, Notice } from '../../components/ui';
import { apiErrorMessage } from '../../i18n/api-errors';
import { useLanguage } from '../../i18n/language-context';
import type { Language } from '../../i18n/translations';
import { transactionDescription } from '../../utils/transaction-history';
import { insufficientMessage, type BankingResponseFields } from './game-page-helpers';
import { useAsyncAction } from '../../hooks/useAsyncAction';

export interface ReverseTransactionDialogProps {
  gameId: string;
  transaction: Transaction;
  players: Player[];
  currency: Currency;
  language: Language;
  onClose: () => void;
  /** Called with the balances and registry rows the reversal changed. */
  onReversed: (result: BankingResponseFields) => void;
}

const effectListClass =
  'm-0 grid list-none gap-[8px] p-0 [&_li]:flex [&_li]:justify-between [&_li]:gap-[10px]';

/** Confirms a correction: shows exactly how each wallet changes before the reversal is recorded. */
export function ReverseTransactionDialog({
  gameId,
  transaction,
  players,
  currency,
  language,
  onClose,
  onReversed,
}: ReverseTransactionDialogProps) {
  const { t } = useLanguage();
  const [comment, setComment] = useState('');
  const { busy: submitting, error, run } = useAsyncAction();
  // One command ID per attempt, so a retry after a dropped response cannot reverse twice.
  const commandIdRef = useRef<string | null>(null);
  const title = t('reverseTransactionTitle');

  const submit = async () => {
    await run(async () => {
      const commandId = commandIdRef.current ?? crypto.randomUUID();
      commandIdRef.current = commandId;
      const result = await monopolyBankApi.createTransaction(
        gameId,
        {
          type: 'REVERSAL',
          transactionId: transaction.id,
          ...(comment.trim() === '' ? {} : { comment: comment.trim() }),
        },
        commandId,
      );
      onReversed(result);
    });
  };

  const errorMessage =
    error === null
      ? null
      : (insufficientMessage(error, players, currency, t) ??
        apiErrorMessage(error, t, 'unableReverseTransaction'));
  const nameOf = (playerId: string) =>
    players.find((player) => player.id === playerId)?.name ?? t('playerFallback');

  return (
    <Dialog title={title} closeLabel={t('closeDialog', { title })} onClose={onClose} sheet="flow">
      <DialogBody>{t('reverseTransactionIntro')}</DialogBody>
      <p className="m-0 font-semibold">{transactionDescription(transaction, players, language)}</p>
      <ul className={effectListClass} aria-label={t('reverseTransactionEffects')}>
        {transaction.participants.map((participant) => (
          <li key={participant.playerId}>
            <span>{nameOf(participant.playerId)}</span>
            <MoneyValue amount={-participant.balanceDelta} currency={currency} signed />
          </li>
        ))}
      </ul>
      <Field variant="dialog" label={t('comment')}>
        <input
          value={comment}
          maxLength={500}
          onChange={(event) => {
            setComment(event.target.value);
            commandIdRef.current = null;
          }}
        />
      </Field>
      {errorMessage !== null && <Notice tone="error">{errorMessage}</Notice>}
      <SheetActions>
        <Button variant="secondary" disabled={submitting} onClick={onClose}>
          {t('cancel')}
        </Button>
        <Button variant="danger" disabled={submitting} onClick={() => void submit()}>
          {submitting ? t('recording') : t('confirmReversal')}
        </Button>
      </SheetActions>
    </Dialog>
  );
}
