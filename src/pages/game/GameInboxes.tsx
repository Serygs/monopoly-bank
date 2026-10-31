import type { PaymentRequest, TradeRequest } from '../../../shared/contracts/api';
import { monopolyBankApi } from '../../api/monopoly-bank-api';
import { useFeedback } from '../../components/ui';
import { usePendingTitle } from '../../hooks/usePendingTitle';
import { useLanguage } from '../../i18n/language-context';
import { playPaymentFeedback, vibrate } from '../../utils/feedback';
import type { GameContext } from './game-context';
import { applyBankingResponse } from './game-page-helpers';
import { PaymentInbox } from './PaymentInbox';
import { TradeInbox } from './TradeInbox';

type RequestAction = 'accept' | 'decline' | 'cancel';

function answerPaymentRequest(
  gameId: string,
  request: PaymentRequest,
  action: RequestAction,
  commandId: string,
) {
  if (action === 'accept')
    return monopolyBankApi.acceptPaymentRequest(gameId, request.id, commandId);
  if (action === 'cancel')
    return monopolyBankApi.cancelPaymentRequest(gameId, request.id, commandId);
  return monopolyBankApi.declinePaymentRequest(gameId, request.id, commandId);
}

function answerTradeRequest(
  gameId: string,
  request: TradeRequest,
  action: RequestAction,
  commandId: string,
) {
  if (action === 'accept') return monopolyBankApi.acceptTradeRequest(gameId, request.id, commandId);
  if (action === 'cancel') return monopolyBankApi.cancelTradeRequest(gameId, request.id, commandId);
  return monopolyBankApi.declineTradeRequest(gameId, request.id, commandId);
}

function PaymentInboxSection({ ctx }: { ctx: GameContext }) {
  const { gameId, details, view, preferences, setDetails, setPaymentRequests } = ctx;
  const onAction = async (request: PaymentRequest, action: RequestAction) => {
    const result = await answerPaymentRequest(gameId, request, action, crypto.randomUUID());
    setPaymentRequests((current) => current.filter((item) => item.id !== request.id));
    if (result.transaction === undefined) return;
    playPaymentFeedback(preferences.sound);
    vibrate(35, preferences.vibration);
    setDetails((current) => (current === null ? current : applyBankingResponse(current, result)));
  };
  return (
    <PaymentInbox
      requests={view.inboxRequests}
      outgoing={view.outgoingLoanRequests}
      players={details.players}
      currency={details.game.currency}
      onAction={onAction}
    />
  );
}

function TradeInboxSection({ ctx }: { ctx: GameContext }) {
  const { t } = useLanguage();
  const notify = useFeedback();
  const { gameId, details, view, preferences, setDetails, putTradeRequest } = ctx;
  if (view.board === null) return null;
  const onAction = async (request: TradeRequest, action: RequestAction) => {
    const result = await answerTradeRequest(gameId, request, action, crypto.randomUUID());
    putTradeRequest(result.tradeRequest);
    if (result.transaction === undefined) return;
    playPaymentFeedback(preferences.sound);
    vibrate(35, preferences.vibration);
    setDetails((current) =>
      current === null
        ? current
        : applyBankingResponse(current, { players: result.players, properties: result.properties }),
    );
    notify({ tone: 'success', message: t('tradeRecorded') });
  };
  return (
    <TradeInbox
      incoming={view.incomingTrades}
      outgoing={view.outgoingTrades}
      players={details.players}
      currency={details.game.currency}
      board={view.board}
      properties={view.properties}
      onAction={onAction}
    />
  );
}

export function GameInboxes({ ctx }: { ctx: GameContext }) {
  const { view } = ctx;
  usePendingTitle(view.canMutate ? view.inboxRequests.length + view.incomingTrades.length : 0);
  if (!view.canMutate) return null;
  const showPayments =
    view.confirmationMode || view.inboxRequests.length > 0 || view.outgoingLoanRequests.length > 0;
  return (
    <>
      {showPayments && <PaymentInboxSection ctx={ctx} />}
      <TradeInboxSection ctx={ctx} />
    </>
  );
}
