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
import { useLanguage } from '../i18n/language-context';
import { formatMoney } from '../utils/money';
import { transactionAmount, transactionDescription } from '../utils/transaction-history';

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
              <button
                id={tabId(value)}
                data-activity-scope={value}
                type="button"
                role="tab"
                aria-selected={selected}
                aria-controls={panelId}
                tabIndex={selected ? 0 : -1}
                className="button button-quiet"
                key={value}
                onClick={() => selectScope(value)}
              >
                {label}
              </button>
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
        {error && (
          <p className="notice notice-error" role="alert">
            {t('unableLoadHistory')}
          </p>
        )}
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
              <li key={item.id}>
                <div className="activity-transaction">
                  <strong>{transactionDescription(item, players, language)}</strong>
                  <time>
                    {new Intl.DateTimeFormat(locale, {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    }).format(new Date(item.createdAt))}
                  </time>
                </div>
                <span>{transactionAmount(item, currency, language)}</span>
                {item.comment !== null && <em>{item.comment}</em>}
              </li>
            ),
          )}
        </ol>
        {!loading && items.length === 0 && (
          <p className="muted">{scope === 'PENDING' ? t('noPendingActivity') : t('noActivity')}</p>
        )}
        {loading && (
          <p role="status" className="muted">
            {t('loadingGame')}
          </p>
        )}
        {page.nextCursor !== null && (
          <button
            className="button button-secondary activity-load-more"
            type="button"
            disabled={loading}
            onClick={() => {
              const cursor = page.nextCursor;
              if (cursor !== null) void loadMore(cursor);
            }}
          >
            {t('loadMore')}
          </button>
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
      <div className="activity-transaction">
        <strong>
          {creator} → {approver}
        </strong>
        <time>
          {new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'short' }).format(
            new Date(request.createdAt),
          )}
        </time>
      </div>
      <span>{formatMoney(request.amount, currency)}</span>
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
