import type { BoardSnapshot } from '../../../shared/board';
import type { Currency, Player, Transaction } from '../../../shared/types/monopoly';
import { translate, type Language } from '../../i18n/translations';
import { transactionAmount, transactionDescription } from '../../utils/transaction-history';
import { Button, MoneyValue, Row } from '../ui';

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
  /** Offers a "Reverse" action; omitted when the viewer cannot reverse it. */
  onReverse?: () => void;
  /** Ledger rows: why the viewer's own operation cannot be reversed right now. */
  reversalNote?: string;
  /** Board games: names the tile a purchase, mortgage, rent payment or auction concerned. */
  board?: BoardSnapshot | null;
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
  onReverse,
  reversalNote,
  board = null,
}: TransactionRowProps) {
  const reversed = transaction.reversedByTransactionId != null;
  const tileName =
    transaction.tileId == null
      ? undefined
      : board?.tiles.find((tile) => tile.id === transaction.tileId)?.name;
  const title = transactionDescription(transaction, players, language, tileName);
  const timestamp = new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
    hourCycle: 'h23',
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
  // A reversed transaction stays visible, marked as undone; the reversal row sits above it.
  const reversedBadge = reversed && <small>{translate(language, 'reversedBadge')}</small>;
  // A purchase paid at an agreed price instead of the card price is marked in the ledger.
  const overriddenBadge = transaction.priceOverridden === true && (
    <small>{translate(language, 'priceOverriddenBadge')}</small>
  );
  if (variant === 'history')
    return (
      <li data-tone={tone} data-reversed={reversed ? 'true' : undefined}>
        <strong className={reversed ? 'line-through opacity-70' : undefined}>{title}</strong>
        <span className={playerId === undefined ? '' : 'player-history-amount'}>{amount}</span>
        <small>{timestamp}</small>
        {reversedBadge}
        {overriddenBadge}
        {comment}
        {onReverse !== undefined && (
          <Button variant="quiet" className="justify-self-start" onClick={onReverse}>
            {translate(language, 'reverseTransaction')}
          </Button>
        )}
      </li>
    );
  return (
    <li data-tone={tone} data-reversed={reversed ? 'true' : undefined}>
      <Row title={title} timestamp={timestamp} />
      <span>{amount}</span>
      {reversedBadge}
      {overriddenBadge}
      {comment}
      {onReverse !== undefined && (
        <Button variant="quiet" className="col-span-full justify-self-start" onClick={onReverse}>
          {translate(language, 'reverseTransaction')}
        </Button>
      )}
      {reversalNote !== undefined && (
        <small className="col-span-full text-[0.84rem] text-secondary">{reversalNote}</small>
      )}
    </li>
  );
}
