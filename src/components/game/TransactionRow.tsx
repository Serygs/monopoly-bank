import type { Currency, Player, Transaction } from '../../../shared/types/monopoly';
import type { Language } from '../../i18n/translations';
import { transactionAmount, transactionDescription } from '../../utils/transaction-history';
import { MoneyValue, Row } from '../ui';

export type TransactionTone = 'income' | 'expense';

export interface TransactionRowProps {
  transaction: Transaction;
  players: Player[];
  currency: Currency;
  language: Language;
  locale: string;
  /**
   * `ledger` — the activity ledger row (title and time via `Row`);
   * `history` — the history dialog row (title, amount, time, comment).
   */
  variant?: 'ledger' | 'history';
  /** Show this player's signed balance change instead of the transaction amount. */
  playerId?: string;
  /** Exposed as `data-tone` for styling; omitted when not given. */
  tone?: TransactionTone;
}

/** One ledger/history list item for a committed transaction. */
export function TransactionRow({
  transaction,
  players,
  currency,
  language,
  locale,
  variant = 'ledger',
  playerId,
  tone,
}: TransactionRowProps) {
  const title = transactionDescription(transaction, players, language);
  const timestamp = new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(transaction.createdAt));
  const delta =
    playerId === undefined
      ? undefined
      : transaction.participants.find((participant) => participant.playerId === playerId)
          ?.balanceDelta;
  const amount =
    playerId === undefined ? (
      transactionAmount(transaction, currency, language)
    ) : delta === undefined ? null : (
      <MoneyValue amount={delta} currency={currency} signed />
    );
  const comment = transaction.comment !== null && <em>{transaction.comment}</em>;
  if (variant === 'history')
    return (
      <li data-tone={tone}>
        <strong>{title}</strong>
        <span className={playerId === undefined ? '' : 'player-history-amount'}>{amount}</span>
        <small>{timestamp}</small>
        {comment}
      </li>
    );
  return (
    <li data-tone={tone}>
      <Row title={title} timestamp={timestamp} />
      <span>{amount}</span>
      {comment}
    </li>
  );
}
