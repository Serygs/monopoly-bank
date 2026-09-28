import { useEffect, useId, useState, type KeyboardEvent } from 'react';
import type {
  ActivityCursor,
  ActivityPage,
  ActivityScope,
  PaymentRequest,
} from '../../shared/contracts/api';
import type { Currency, Player, Transaction } from '../../shared/types/monopoly';
import { monopolyBankApi } from '../api/monopoly-bank-api';
import { Dialog } from '../components/Dialog';
import { TransactionRow } from '../components/game/TransactionRow';
import { useLanguage } from '../i18n/language-context';
import { Button, MoneyValue, Notice, Row, StatPill } from '../components/ui';

const activityScopes: readonly ActivityScope[] = ['ALL', 'MINE', 'PENDING'];

export function ActivityScreen({
  gameId,
  players,
  currency,
  liveTransactions,
  onClose,
}: {
  gameId: string;
  players: Player[];
  currency: Currency;
  liveTransactions: Transaction[];
  onClose: () => void;
}) {
  const { language, locale, t } = useLanguage();
  const tabIdPrefix = useId();
  const panelId = useId();
  const [scope, setScope] = useState<ActivityScope>('ALL');
  const [page, setPage] = useState<ActivityPage>({
    transactions: [],
    paymentRequests: [],
    nextCursor: null,
  });
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
  }, [gameId, scope]);

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

  const transactions =
    scope === 'PENDING'
      ? page.transactions
      : mergeTransactions(liveTransactions, page.transactions);
  const items = scope === 'PENDING' ? page.paymentRequests : transactions;
  const tabId = (value: ActivityScope) => `${tabIdPrefix}-${value.toLowerCase()}`;
  const selectScope = (nextScope: ActivityScope) => {
    if (nextScope === scope) return;
    setLoading(true);
    setError(false);
    setScope(nextScope);
  };
  const moveTabFocus = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const currentIndex = activityScopes.indexOf(scope);
    const nextIndex =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? activityScopes.length - 1
          : event.key === 'ArrowRight'
            ? (currentIndex + 1) % activityScopes.length
            : (currentIndex - 1 + activityScopes.length) % activityScopes.length;
    const nextScope = activityScopes[nextIndex];
    if (nextScope === undefined) return;
    const nextTab = event.currentTarget.querySelector<HTMLButtonElement>(
      `[data-activity-scope="${nextScope}"]`,
    );
    nextTab?.focus();
    selectScope(nextScope);
  };

  return (
    <Dialog
      title={t('activity')}
      closeLabel={t('closeDialog', { title: t('activity') })}
      onClose={onClose}
      className="activity-dialog"
    >
      <div className="activity-sticky">
        <div
          className="activity-tabs"
          role="tablist"
          aria-label={t('activity')}
          onKeyDown={moveTabFocus}
        >
          {activityScopes.map((value) => {
            const selected = scope === value;
            const label =
              value === 'ALL'
                ? t('activityAll')
                : value === 'MINE'
                  ? t('activityMine')
                  : t('activityPending');
            return (
              <Button
                id={tabId(value)}
                data-activity-scope={value}
                role="tab"
                aria-selected={selected}
                aria-controls={panelId}
                tabIndex={selected ? 0 : -1}
                variant="quiet"
                key={value}
                onClick={() => selectScope(value)}
              >
                {label}
              </Button>
            );
          })}
        </div>
      </div>
      <div
        id={panelId}
        className="activity-scroll"
        role="tabpanel"
        aria-labelledby={tabId(scope)}
        tabIndex={0}
      >
        {error && <Notice tone="error">{t('unableLoadHistory')}</Notice>}
        <ol className="activity-ledger">
          {items.map((item) =>
            'state' in item ? (
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
              />
            ),
          )}
        </ol>
        {!loading && items.length === 0 && (
          <p className="muted">{scope === 'PENDING' ? t('noPendingActivity') : t('noActivity')}</p>
        )}
        {loading && (
          <StatPill variant="muted" live>
            {t('loadingGame')}
          </StatPill>
        )}
        {page.nextCursor !== null && (
          <Button
            variant="secondary"
            className="activity-load-more"
            disabled={loading}
            onClick={() => {
              const cursor = page.nextCursor;
              if (cursor !== null) void loadMore(cursor);
            }}
          >
            {t('loadMore')}
          </Button>
        )}
      </div>
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
    <li className="activity-pending">
      <Row
        title={
          <>
            {creator} → {approver}
          </>
        }
        timestamp={new Intl.DateTimeFormat(locale, {
          dateStyle: 'medium',
          timeStyle: 'short',
        }).format(new Date(request.createdAt))}
      />
      <span>
        <MoneyValue amount={request.amount} currency={currency} />
      </span>
      <small className="activity-status">{t('pendingPayment')}</small>
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
