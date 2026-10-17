import { Tab, TabGroup, TabList, TabPanel, TabPanels } from '@headlessui/react';
import { Fragment, useEffect, useState } from 'react';
import type {
  ActivityCursor,
  ActivityPage,
  ActivityScope,
  PaymentRequest,
} from '../../shared/contracts/api';
import type { BoardSnapshot } from '../../shared/board';
import type { Currency, Player, Transaction } from '../../shared/types/monopoly';
import { monopolyBankApi } from '../api/monopoly-bank-api';
import { groupTiles } from '../../shared/domain/property';
import { REVERSAL_WINDOW_MS, reversalAvailability } from '../../shared/domain/reversal';
import { Dialog } from '../components/Dialog';
import { TransactionRow } from '../components/game/TransactionRow';
import { useLanguage } from '../i18n/language-context';
import { Button, MoneyValue, Notice, Row, StatPill } from '../components/ui';
import { cx, wideDialogClass } from '../components/ui/class-names';
import { MutedText } from '../components/ui/Text';

const allActivityScopes: readonly ActivityScope[] = ['ALL', 'MINE', 'PENDING'];
const immediateActivityScopes: readonly ActivityScope[] = ['ALL', 'MINE'];

/*
 * `activity-scroll` and `activity-ledger` stay as hooks for the e2e suites. `!` outranks the
 * Dialog panel's own overflow and width.
 */
const dialogClass = cx(
  'grid h-[min(720px,calc(100dvh_-_48px))] grid-rows-[auto_auto_minmax(0,1fr)] overflow-hidden!',
  'max-md:h-[calc(100dvh_-_var(--mb-app-safe-top)_-_8px_-_var(--mb-dialog-nav-offset))]',
  wideDialogClass,
  'glass:max-w-full glass:min-w-0',
);
/* Nothing scrolls under the tab bar, so Liquid Glass lets the dialog's own glass show through. */
const stickyClass = cx(
  'z-1 border-b border-border bg-surface-elevated pt-(--mb-space-2)',
  'glass:max-w-full glass:min-w-0 glass:border-[rgb(85_98_116/0.16)] glass:bg-transparent glass:dark:border-[rgb(255_255_255/0.14)]',
);
/*
 * The selected tab sits above the quiet Button colours; the Button hover and pressed fills win.
 * Liquid Glass lays the three tabs out as equal columns that may wrap.
 */
const tabsClass = cx(
  'mx-0 mt-0 mb-(--mb-space-3) flex gap-[3px] overflow-x-auto rounded-md bg-surface-subtle p-[3px]',
  '[&_[aria-selected=true]]:bg-accent [&_[aria-selected=true]]:text-on-accent [&_[aria-selected=true]]:shadow-sm',
  'glass:grid glass:w-full glass:min-w-0 glass:overflow-x-hidden',
  'glass:*:w-full glass:*:min-w-0 glass:*:px-(--mb-space-2) glass:*:whitespace-normal',
  'glass:border-[rgb(85_98_116/0.16)] glass:bg-[rgb(255_255_255/0.54)] glass:shadow-[inset_0_1px_0_rgb(255_255_255/0.68)]',
  'glass:dark:border-[rgb(255_255_255/0.14)] glass:dark:bg-[rgb(50_61_76/0.68)] glass:dark:shadow-[inset_0_1px_0_rgb(255_255_255/0.1)]',
);
/* The direct `.button` child is the load-more action. */
const scrollClass =
  'activity-scroll min-h-0 overflow-y-auto overscroll-contain [&>.button]:mx-0 [&>.button]:my-(--mb-space-4) glass:max-w-full glass:min-w-0';
const ledgerClass = cx(
  'activity-ledger m-0 grid list-none gap-0 p-0',
  '[&>li]:grid [&>li]:grid-cols-[minmax(0,1fr)_auto] [&>li]:gap-x-[14px] [&>li]:gap-y-[4px] [&>li]:border-b [&>li]:border-b-border [&>li]:px-[4px] [&>li]:py-[14px]',
  'glass:[&>li]:border-[rgb(85_98_116/0.16)]',
  '[&>li>span]:shrink-0 [&>li>span]:self-start [&>li>span]:font-money [&>li>span]:font-bold [&>li>span]:whitespace-nowrap [&>li>span]:text-primary [&>li>span]:tabular-nums',
  '[&_:is(time,li_em)]:col-span-full [&_:is(time,li_em)]:text-[0.84rem] [&_:is(time,li_em)]:text-secondary',
);
/*
 * The inline-start padding was `!important` in the old ledger CSS, over the row padding. The
 * `small` is the pending status line.
 */
const pendingRowClass = cx(
  'border-s-4 border-s-accent bg-[color-mix(in_srgb,var(--mb-color-highlight)_14%,transparent)] ps-[12px]!',
  '[&>small]:col-span-full [&>small]:text-[0.84rem] [&>small]:font-semibold [&>small]:text-status-text',
);

/** What the Activity ledger needs to offer a reversal on the viewer's own operations. */
export interface ActivityReversal {
  isOwner: boolean;
  controlledPlayerIds: readonly string[];
  onReverse: (transaction: Transaction) => void;
}

export function ActivityScreen({
  gameId,
  players,
  currency,
  liveTransactions,
  showPending = true,
  initialScope = 'ALL',
  initialPlayerId = null,
  reversal,
  refreshKey = 0,
  board = null,
  onClose,
}: {
  gameId: string;
  players: Player[];
  currency: Currency;
  liveTransactions: Transaction[];
  /** Pending payment requests exist only when recipients must confirm payments. */
  showPending?: boolean;
  /** The tab to open on; the wallet's history link opens "Mine". */
  initialScope?: ActivityScope;
  /** Opens with the ledger narrowed to the operations of one wallet (the wallet's history link). */
  initialPlayerId?: string | null;
  /** Omitted when the viewer cannot change the game (finished or offline). */
  reversal?: ActivityReversal;
  /** Changing it reloads the ledger, e.g. after a reversal was recorded. */
  refreshKey?: number;
  /** Board games: names the tiles in the ledger rows. */
  board?: BoardSnapshot | null;
  onClose: () => void;
}) {
  const { language, locale, t } = useLanguage();
  const activityScopes = showPending ? allActivityScopes : immediateActivityScopes;
  const [scope, setScope] = useState<ActivityScope>(
    showPending || initialScope !== 'PENDING' ? initialScope : 'ALL',
  );
  const [playerFilter, setPlayerFilter] = useState<string | null>(initialPlayerId);
  const [page, setPage] = useState<ActivityPage>({
    transactions: [],
    paymentRequests: [],
    nextCursor: null,
  });
  // The reversal window runs while the ledger is open, so the clock ticks without re-rendering often.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  useEffect(() => {
    let active = true;
    void monopolyBankApi
      .getActivity(gameId, scope)
      .then(
        (next) => {
          if (active) {
            setPage(next);
            setError(false);
          }
        },
        () => {
          if (active) setError(true);
        },
      )
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [gameId, scope, refreshKey]);

  const loadMore = async (cursor: ActivityCursor) => {
    setLoading(true);
    setError(false);
    try {
      const next = await monopolyBankApi.getActivity(gameId, scope, encodeCursor(cursor));
      setPage((current) => ({
        ...next,
        transactions: mergeTransactions(current.transactions, next.transactions),
        paymentRequests: mergeRequests(current.paymentRequests, next.paymentRequests),
      }));
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  };

  // A reversal that arrived live marks the original it moved back, even on an older loaded page.
  const reversedByLive = new Map(
    liveTransactions
      .filter((item) => item.reversesTransactionId != null)
      .map((item) => [item.reversesTransactionId, item.id] as const),
  );
  const transactions = (
    scope === 'PENDING' ? page.transactions : mergeTransactions(liveTransactions, page.transactions)
  ).map((item) =>
    item.reversedByTransactionId == null && reversedByLive.has(item.id)
      ? { ...item, reversedByTransactionId: reversedByLive.get(item.id) }
      : item,
  );
  const items = scope === 'PENDING' ? page.paymentRequests : transactions;
  // The filter only hides rows: the reversal check still looks at the whole ledger above a row.
  const shown = (item: Transaction | PaymentRequest): boolean =>
    playerFilter === null ||
    ('state' in item
      ? item.creatorPlayerId === playerFilter || item.approverPlayerId === playerFilter
      : item.participants.some((participant) => participant.playerId === playerFilter));
  const filterName = players.find((player) => player.id === playerFilter)?.name ?? null;
  const selectScope = (index: number) => {
    const nextScope = activityScopes[index];
    if (nextScope === undefined || nextScope === scope) return;
    setLoading(true);
    setError(false);
    setScope(nextScope);
  };
  /** The ledger is newest first, so the rows above one are the operations written after it. */
  const reversalProps = (
    transaction: Transaction,
    newer: readonly (Transaction | PaymentRequest)[],
  ) => {
    if (reversal === undefined) return {};
    const availability = reversalAvailability({
      transaction,
      isOwner: reversal.isOwner,
      controlledPlayerIds: reversal.controlledPlayerIds,
      now,
      later: newer.filter((item): item is Transaction => !('state' in item)),
      groupTileIds: groupTileIdsOf(board, transaction),
    });
    if (availability.status === 'allowed')
      return { onReverse: () => reversal.onReverse(transaction) };
    if (availability.status === 'blocked')
      return {
        reversalNote:
          availability.reason === 'WINDOW_EXPIRED'
            ? t('reversalBlockedWindow', { minutes: REVERSAL_WINDOW_MS / 60_000 })
            : t('reversalBlockedLater'),
      };
    return {};
  };
  const panel = (
    <>
      {error && <Notice tone="error">{t('unableLoadHistory')}</Notice>}
      {playerFilter !== null && (
        <button
          type="button"
          className="mb-(--mb-space-3) inline-flex min-h-11 cursor-pointer items-center gap-(--mb-space-2) rounded-pill border border-border bg-surface-subtle px-(--mb-space-3) text-small font-semibold text-primary focus-visible:outline-offset-2"
          aria-label={t('activityClearPlayer', { name: filterName ?? t('selectedPlayer') })}
          onClick={() => setPlayerFilter(null)}
        >
          {t('activityShowingPlayer', { name: filterName ?? t('selectedPlayer') })}
          <span aria-hidden="true">×</span>
        </button>
      )}
      <ol className={ledgerClass}>
        {items.map((item, index) =>
          !shown(item) ? null : 'state' in item ? (
            <PendingRow
              key={item.id}
              request={item}
              players={players}
              currency={currency}
              locale={locale}
            />
          ) : (
            <TransactionRow
              key={item.id}
              transaction={item}
              players={players}
              currency={currency}
              language={language}
              locale={locale}
              board={board}
              {...reversalProps(item, items.slice(0, index))}
            />
          ),
        )}
      </ol>
      {!loading && items.filter(shown).length === 0 && (
        <MutedText>{scope === 'PENDING' ? t('noPendingActivity') : t('noActivity')}</MutedText>
      )}
      {loading && (
        <StatPill variant="muted" live>
          {t('loadingGame')}
        </StatPill>
      )}
      {page.nextCursor !== null && (
        <Button
          variant="secondary"
          disabled={loading}
          onClick={() => {
            const cursor = page.nextCursor;
            if (cursor !== null) void loadMore(cursor);
          }}
        >
          {t('loadMore')}
        </Button>
      )}
    </>
  );

  // Headless UI renders only the selected panel; the other two stay registered as hidden stubs
  // so every tab keeps its `aria-controls` target.
  return (
    <Dialog
      title={t('activity')}
      closeLabel={t('closeDialog', { title: t('activity') })}
      onClose={onClose}
      className={dialogClass}
    >
      <TabGroup as={Fragment} selectedIndex={activityScopes.indexOf(scope)} onChange={selectScope}>
        <div className={stickyClass}>
          <TabList
            className={cx(tabsClass, showPending ? 'glass:grid-cols-3' : 'glass:grid-cols-2')}
            aria-label={t('activity')}
          >
            {activityScopes.map((value) => (
              <Tab as={Button} variant="quiet" key={value}>
                {value === 'ALL'
                  ? t('activityAll')
                  : value === 'MINE'
                    ? t('activityMine')
                    : t('activityPending')}
              </Tab>
            ))}
          </TabList>
        </div>
        <TabPanels as={Fragment}>
          {activityScopes.map((value) => (
            <TabPanel key={value} className={scrollClass}>
              {panel}
            </TabPanel>
          ))}
        </TabPanels>
      </TabGroup>
    </Dialog>
  );
}

function PendingRow({
  request,
  players,
  currency,
  locale,
}: {
  request: PaymentRequest;
  players: Player[];
  currency: Currency;
  locale: string;
}) {
  const { t } = useLanguage();
  const creator =
    players.find((player) => player.id === request.creatorPlayerId)?.name ?? t('selectedPlayer');
  const approver =
    players.find((player) => player.id === request.approverPlayerId)?.name ?? t('selectedPlayer');
  return (
    <li className={pendingRowClass}>
      <Row
        title={
          <>
            {creator} → {approver}
          </>
        }
        timestamp={new Intl.DateTimeFormat(locale, {
          dateStyle: 'medium',
          timeStyle: 'short',
          hourCycle: 'h23',
        }).format(new Date(request.createdAt))}
      />
      <span>
        <MoneyValue amount={request.amount} currency={currency} />
      </span>
      <small>{t('pendingPayment')}</small>
      {request.comment !== null && <em>{request.comment}</em>}
    </li>
  );
}

function encodeCursor(cursor: ActivityCursor): string {
  return btoa(JSON.stringify(cursor));
}
function mergeTransactions(
  first: readonly Transaction[],
  second: readonly Transaction[],
): Transaction[] {
  return [...first, ...second].filter(
    (item, index, all) => all.findIndex((candidate) => candidate.id === item.id) === index,
  );
}
function mergeRequests(
  first: readonly PaymentRequest[],
  second: readonly PaymentRequest[],
): PaymentRequest[] {
  return [...first, ...second].filter(
    (item, index, all) => all.findIndex((candidate) => candidate.id === item.id) === index,
  );
}

/** The tiles of the colour group of the tile a transaction concerned (see `findReversalDependency`). */
function groupTileIdsOf(board: BoardSnapshot | null, transaction: Transaction): string[] {
  const tile =
    board === null || transaction.tileId == null
      ? undefined
      : board.tiles.find((item) => item.id === transaction.tileId);
  return board === null || tile === undefined ? [] : groupTiles(board, tile).map((item) => item.id);
}
