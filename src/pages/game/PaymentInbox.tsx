import { useState } from 'react';
import type { PaymentRequest } from '../../../shared/contracts/api';
import type { Currency, Player } from '../../../shared/types/monopoly';
import { Button, DialogActions, Notice, StatPill } from '../../components/ui';
import { apiErrorMessage } from '../../i18n/api-errors';
import { useLanguage } from '../../i18n/language-context';
import { formatMoney } from '../../utils/money';

export type PaymentRequestAction = 'accept' | 'decline';

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
    <section className="payment-inbox" aria-labelledby="payment-inbox-title">
      <header>
        <h2 id="payment-inbox-title">{t('paymentInbox')}</h2>
        <StatPill variant="pill">{requests.length}</StatPill>
      </header>
      {error !== null && (
        <Notice tone="error">{apiErrorMessage(error, t, 'unableRecordTransaction')}</Notice>
      )}
      {requests.length === 0 ? (
        <p className="muted">{t('noPaymentRequests')}</p>
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
