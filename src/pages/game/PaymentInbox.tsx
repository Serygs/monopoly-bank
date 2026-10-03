import { useState } from 'react';
import type { PaymentRequest } from '../../../shared/contracts/api';
import type { Currency, Player } from '../../../shared/types/monopoly';
import { Button, DialogActions, Notice, StatPill } from '../../components/ui';
import { apiErrorMessage } from '../../i18n/api-errors';
import { useLanguage } from '../../i18n/language-context';
import { formatMoney } from '../../utils/money';
import { cx } from '../../components/ui/class-names';
import { MutedText } from '../../components/ui/Text';

export type PaymentRequestAction = 'accept' | 'decline';

/*
 * `payment-inbox` stays as the hook for the e2e overflow checks. Below `md` each request stacks
 * and its two actions share a two-column row.
 */
const inboxClass = cx(
  'payment-inbox my-(--mb-space-6) rounded-card-large border border-accent bg-surface-subtle p-(--mb-space-5) shadow-sm',
  '[&>header]:flex [&>header]:items-center [&>header]:justify-between [&>header]:gap-(--mb-space-3)',
  '[&>ol]:mx-0 [&>ol]:mt-(--mb-space-4) [&>ol]:mb-0 [&>ol]:grid [&>ol]:list-none [&>ol]:gap-(--mb-space-3) [&>ol]:p-0',
  '[&_li]:flex [&_li]:items-center [&_li]:justify-between [&_li]:gap-(--mb-space-3) [&_li]:rounded-control [&_li]:border [&_li]:border-border [&_li]:bg-surface-elevated [&_li]:p-(--mb-space-4)',
  'max-md:[&_li]:flex-col max-md:[&_li]:items-stretch [&_li>div:first-child]:grid [&_li>div:first-child]:gap-(--mb-space-1) [&_small]:text-secondary',
  '[&_.dialog-actions]:items-center max-md:[&_.dialog-actions]:grid max-md:[&_.dialog-actions]:w-full max-md:[&_.dialog-actions]:grid-cols-2',
  'glass:border-[color:color-mix(in_srgb,var(--mb-color-accent)_30%,transparent)] glass:bg-[rgb(255_255_255/0.5)] glass:dark:bg-[rgb(40_49_62/0.6)]',
  'glass:[&_li]:border-[rgb(85_98_116/0.14)] glass:[&_li]:bg-[rgb(255_255_255/0.62)]',
  'glass:dark:[&_li]:border-[rgb(255_255_255/0.14)] glass:dark:[&_li]:bg-[rgb(50_61_76/0.68)]',
);

export interface PaymentInboxProps {
  requests: PaymentRequest[];
  players: Player[];
  currency: Currency;
  onAction: (request: PaymentRequest, action: PaymentRequestAction) => Promise<void>;
}

export function PaymentInbox({ requests, players, currency, onAction }: PaymentInboxProps) {
  const { t, locale } = useLanguage();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<unknown | null>(null);
  const act = async (request: PaymentRequest, action: PaymentRequestAction) => {
    setBusyId(request.id);
    setError(null);
    try {
      await onAction(request, action);
    } catch (caught) {
      setError(caught);
    } finally {
      setBusyId(null);
    }
  };
  return (
    <section className={inboxClass} aria-labelledby="payment-inbox-title">
      <header>
        <h2 id="payment-inbox-title">{t('paymentInbox')}</h2>
        <StatPill variant="pill">{requests.length}</StatPill>
      </header>
      {error !== null && (
        <Notice tone="error">{apiErrorMessage(error, t, 'unableRecordTransaction')}</Notice>
      )}
      {requests.length === 0 ? (
        <MutedText>{t('noPaymentRequests')}</MutedText>
      ) : (
        <ol>
          {requests.map((request) => {
            const creator = players.find((player) => player.id === request.creatorPlayerId);
            return (
              <li key={request.id}>
                <div>
                  <strong>
                    {t('paymentRequestFrom', {
                      name: creator?.name ?? t('playerFallback'),
                      amount: formatMoney(request.amount, currency),
                    })}
                  </strong>
                  <small>
                    {t('paymentRequestExpires', {
                      time: new Intl.DateTimeFormat(locale, { timeStyle: 'short' }).format(
                        new Date(request.expiresAt),
                      ),
                    })}
                  </small>
                </div>
                <DialogActions>
                  <Button
                    variant="primary"
                    disabled={busyId !== null}
                    onClick={() => void act(request, 'accept')}
                  >
                    {t('acceptPayment')}
                  </Button>
                  <Button
                    variant="secondary"
                    disabled={busyId !== null}
                    onClick={() => void act(request, 'decline')}
                  >
                    {t('declinePayment')}
                  </Button>
                </DialogActions>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
