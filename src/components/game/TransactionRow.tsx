import type { BoardSnapshot } from '../../../shared/board';
import type { Currency, Player, Transaction } from '../../../shared/types/monopoly';
import { translate, type Language } from '../../i18n/translations';
import { moneyTone } from '../../utils/money';
import { tileDisplayNames } from '../../utils/property-name';
import { transactionAmount, transactionDescription } from '../../utils/transaction-history';
import { Button, MoneyValue, Row } from '../ui';
import { cx } from '../ui/class-names';

export type TransactionTone = 'income' | 'expense';

export interface TransactionRowProps {
  transaction: Transaction;
  players: Player[];
  currency: Currency;
  language: Language;
  locale: string;
  /**
   * `ledger` — the activity ledger row (title and time via `Row`);
   * `history` — the history dialog row (title, amount, time, comment);
   * `compact` — the game screen's own events: title and signed amount, then time and note.
   */
  variant?: 'ledger' | 'history' | 'compact';
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
  // A trade or a multi-street build lists every tile; anything else names its one tile.
  const tileIds = transaction.tileIds ?? (transaction.tileId == null ? [] : [transaction.tileId]);
  const tileNames = tileDisplayNames(board, tileIds, (key) => translate(language, key));
  const tileName = tileNames === '' ? undefined : tileNames;
  const title = transactionDescription(transaction, players, language, tileName);
  const timestamp = new Intl.DateTimeFormat(
    locale,
    variant === 'compact'
      ? { timeStyle: 'short', hourCycle: 'h23' }
      : { dateStyle: 'medium', timeStyle: 'short', hourCycle: 'h23' },
  ).format(new Date(transaction.createdAt));
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
  if (variant === 'compact') {
    const tone = delta === undefined ? 'neutral' : moneyTone(delta);
    const noSurcharge = transaction.type === 'PROPERTY_TRANSFER' && transaction.amount === 0;
    return (
      <li
        data-tone={tone === 'neutral' ? undefined : tone}
        className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-(--mb-space-3) gap-y-[2px] rounded-compact border border-border bg-surface-subtle px-(--mb-space-3) py-(--mb-space-2)"
      >
        <strong className="min-w-0 truncate text-small">{title}</strong>
        <span
          className={cx(
            'font-money text-small font-semibold whitespace-nowrap tabular-nums',
            tone === 'income' && 'text-status-text',
            tone === 'expense' && 'text-danger',
            tone === 'neutral' && 'text-secondary',
          )}
        >
          {noSurcharge ? (
            translate(language, 'tradeNoSurcharge')
          ) : delta === undefined ? null : (
            <MoneyValue amount={delta} currency={currency} signed={delta !== 0} />
          )}
        </span>
        <small className="col-span-full min-w-0 truncate text-meta text-secondary">
          {transaction.comment === null || transaction.comment === ''
            ? timestamp
            : `${timestamp} · ${transaction.comment}`}
        </small>
      </li>
    );
  }
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
