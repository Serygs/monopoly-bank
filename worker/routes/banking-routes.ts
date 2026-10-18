import { TransactionNotFoundError } from '../../shared/domain/banking.js';
import { controlledPlayerIdForBankingCommand } from '../../shared/domain/player-control.js';
import { NotFoundError } from '../services/errors.js';
import {
  parseBankruptcyRequest,
  parseCreateTradeRequest,
  parseCreateTransactionRequest,
  parseResourceId,
} from '../validation/api-validation.js';
import {
  readCommandId,
  readHistoryLimit,
  route,
  success,
  walletIds,
  type AuthedRouteContext,
  type Route,
} from './route-support.js';

type RequestAction = 'accept' | 'decline' | 'cancel';

const REQUEST_ACTIONS: readonly RequestAction[] = ['accept', 'decline', 'cancel'];

const PAYMENT_LIVE_TYPES = {
  accept: 'ACCEPT_PAYMENT_REQUEST',
  decline: 'DECLINE_PAYMENT_REQUEST',
  cancel: 'CANCEL_PAYMENT_REQUEST',
} as const;

const PAYMENT_DIRECT_METHODS = {
  accept: 'acceptPaymentRequest',
  decline: 'declinePaymentRequest',
  cancel: 'cancelPaymentRequest',
} as const;

const TRADE_LIVE_TYPES = {
  accept: 'ACCEPT_TRADE_REQUEST',
  decline: 'DECLINE_TRADE_REQUEST',
  cancel: 'CANCEL_TRADE_REQUEST',
} as const;

const TRADE_DIRECT_METHODS = {
  accept: 'acceptTradeRequest',
  decline: 'declineTradeRequest',
  cancel: 'cancelTradeRequest',
} as const;

function gameIdOf(context: AuthedRouteContext): string {
  return parseResourceId(context.params[0], 'gameId');
}

async function declareBankruptcy(context: AuthedRouteContext): Promise<Response> {
  const { request, dependencies, actor } = context;
  const gameId = gameIdOf(context);
  await dependencies.access.requireMember(gameId, actor.id);
  const body = await parseBankruptcyRequest(request);
  await dependencies.access.requirePlayerController(
    gameId,
    actor.id,
    controlledPlayerIdForBankingCommand(body),
  );
  if (dependencies.live !== undefined)
    return dependencies.live.mutate(gameId, actor, {
      type: 'DECLARE_BANKRUPTCY',
      commandId: readCommandId(request),
      request: body,
    });
  return success(await dependencies.banking.declareBankruptcy(gameId, body), 201);
}

async function createTransaction(context: AuthedRouteContext): Promise<Response> {
  const { request, dependencies, actor } = context;
  const gameId = gameIdOf(context);
  await dependencies.access.requireMember(gameId, actor.id);
  const body = await parseCreateTransactionRequest(request);
  if (body.type === 'REVERSAL') {
    const original = await dependencies.banking.getTransaction(gameId, body.transactionId);
    if (original === null) throw new TransactionNotFoundError(body.transactionId);
    await dependencies.access.requireReversalAuthority(gameId, actor.id, original);
  } else
    await dependencies.access.requirePlayerController(
      gameId,
      actor.id,
      controlledPlayerIdForBankingCommand(body),
    );
  if (dependencies.live !== undefined)
    return dependencies.live.mutate(gameId, actor, {
      type: 'CREATE_TRANSACTION',
      commandId: readCommandId(request),
      request: body,
    });
  return success(await dependencies.banking.createTransaction(gameId, body), 201);
}

async function listTransactions(context: AuthedRouteContext): Promise<Response> {
  const { request, dependencies, actor } = context;
  const gameId = gameIdOf(context);
  await dependencies.access.requireMember(gameId, actor.id);
  return success(await dependencies.banking.listTransactions(gameId, readHistoryLimit(request)));
}

async function listPlayerTransactions(context: AuthedRouteContext): Promise<Response> {
  const { request, dependencies, actor } = context;
  const gameId = gameIdOf(context);
  await dependencies.access.requireMember(gameId, actor.id);
  const playerId = parseResourceId(context.params[1], 'playerId');
  await dependencies.access.requirePlayerController(gameId, actor.id, playerId);
  return success(
    await dependencies.banking.listPlayerTransactions(gameId, playerId, readHistoryLimit(request)),
  );
}

async function listPaymentRequests(context: AuthedRouteContext): Promise<Response> {
  const { dependencies, actor } = context;
  const gameId = gameIdOf(context);
  await dependencies.access.requireMember(gameId, actor.id);
  const wallets = await dependencies.access.controlledWallets(gameId, actor.id);
  return success(await dependencies.banking.listPaymentRequests(gameId, walletIds(wallets)));
}

async function paymentRequestAction(
  context: AuthedRouteContext,
  action: RequestAction,
): Promise<Response> {
  const { request, dependencies, actor } = context;
  const gameId = gameIdOf(context);
  const paymentRequestId = parseResourceId(context.params[1], 'paymentRequestId');
  await dependencies.access.requireMember(gameId, actor.id);
  const paymentRequest = await dependencies.banking.getPaymentRequest(gameId, paymentRequestId);
  if (paymentRequest === null)
    throw new NotFoundError('PAYMENT_REQUEST_NOT_FOUND', 'Payment request not found.');
  const controlledPlayerId =
    action === 'cancel' ? paymentRequest.creatorPlayerId : paymentRequest.approverPlayerId;
  await dependencies.access.requirePlayerController(gameId, actor.id, controlledPlayerId);
  const commandId = readCommandId(request);
  if (dependencies.live !== undefined)
    return dependencies.live.mutate(gameId, actor, {
      type: PAYMENT_LIVE_TYPES[action],
      commandId,
      paymentRequestId,
    });
  return success(
    await dependencies.banking[PAYMENT_DIRECT_METHODS[action]](gameId, paymentRequestId),
  );
}

// A trade only happens when the counterparty accepts: the proposer's wallet starts it, the
// counterparty's wallet answers, and the one PROPERTY_TRANSFER is written on accept.
async function listTradeRequests(context: AuthedRouteContext): Promise<Response> {
  const { dependencies, actor } = context;
  const gameId = gameIdOf(context);
  await dependencies.access.requireMember(gameId, actor.id);
  const wallets = await dependencies.access.controlledWallets(gameId, actor.id);
  return success(await dependencies.banking.listTradeRequests(gameId, walletIds(wallets)));
}

async function createTradeRequest(context: AuthedRouteContext): Promise<Response> {
  const { request, dependencies, actor } = context;
  const gameId = gameIdOf(context);
  await dependencies.access.requireMember(gameId, actor.id);
  const body = await parseCreateTradeRequest(request);
  await dependencies.access.requirePlayerController(gameId, actor.id, body.playerId);
  if (dependencies.live !== undefined)
    return dependencies.live.mutate(gameId, actor, {
      type: 'CREATE_TRADE_REQUEST',
      commandId: readCommandId(request),
      request: body,
    });
  return success(await dependencies.banking.createTradeRequest(gameId, body), 201);
}

async function tradeRequestAction(
  context: AuthedRouteContext,
  action: RequestAction,
): Promise<Response> {
  const { request, dependencies, actor } = context;
  const gameId = gameIdOf(context);
  const tradeRequestId = parseResourceId(context.params[1], 'tradeRequestId');
  await dependencies.access.requireMember(gameId, actor.id);
  const tradeRequest = await dependencies.banking.getTradeRequest(gameId, tradeRequestId);
  if (tradeRequest === null)
    throw new NotFoundError('TRADE_REQUEST_NOT_FOUND', 'Trade request not found.');
  await dependencies.access.requirePlayerController(
    gameId,
    actor.id,
    action === 'cancel' ? tradeRequest.proposerPlayerId : tradeRequest.counterpartyPlayerId,
  );
  const commandId = readCommandId(request);
  if (dependencies.live !== undefined)
    return dependencies.live.mutate(gameId, actor, {
      type: TRADE_LIVE_TYPES[action],
      commandId,
      tradeRequestId,
    });
  return success(await dependencies.banking[TRADE_DIRECT_METHODS[action]](gameId, tradeRequestId));
}

const requestActionRoutes = (
  segment: string,
  handle: (context: AuthedRouteContext, action: RequestAction) => Promise<Response>,
): Route<AuthedRouteContext>[] =>
  REQUEST_ACTIONS.map((action) =>
    route(
      'POST',
      new RegExp(`^/api/games/([^/]+)/${segment}/([^/]+)/${action}$`),
      (context: AuthedRouteContext) => handle(context, action),
    ),
  );

export const bankingRoutes: Route<AuthedRouteContext>[] = [
  route('POST', /^\/api\/games\/([^/]+)\/bankruptcy$/, declareBankruptcy),
  route('POST', /^\/api\/games\/([^/]+)\/transactions$/, createTransaction),
  route('GET', /^\/api\/games\/([^/]+)\/transactions$/, listTransactions),
  route('GET', /^\/api\/games\/([^/]+)\/payment-requests$/, listPaymentRequests),
  ...requestActionRoutes('payment-requests', paymentRequestAction),
  route('GET', /^\/api\/games\/([^/]+)\/trade-requests$/, listTradeRequests),
  route('POST', /^\/api\/games\/([^/]+)\/trade-requests$/, createTradeRequest),
  ...requestActionRoutes('trade-requests', tradeRequestAction),
  route('GET', /^\/api\/games\/([^/]+)\/players\/([^/]+)\/transactions$/, listPlayerTransactions),
];
