import { Tab, TabGroup, TabList, TabPanel, TabPanels } from '@headlessui/react';
import { Fragment, useEffect, useState } from 'react';
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
  const selectScope = (index: number) => {
    const nextScope = activityScopes[index];
    if (nextScope === undefined || nextScope === scope) return;
    setLoading(true);
    setError(false);
    setScope(nextScope);
  };
  const panel = (
    <>
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
    </>
  );

  // Headless UI renders only the selected panel; the other two stay registered as hidden stubs
  // so every tab keeps its `aria-controls` target.
  return (
    <Dialog
      title={t('activity')}
      closeLabel={t('closeDialog', { title: t('activity') })}
      onClose={onClose}
      className="activity-dialog"
    >
      <TabGroup as={Fragment} selectedIndex={activityScopes.indexOf(scope)} onChange={selectScope}>
        <div className="activity-sticky">
          <TabList className="activity-tabs" aria-label={t('activity')}>
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
            <TabPanel key={value} className="activity-scroll">
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
