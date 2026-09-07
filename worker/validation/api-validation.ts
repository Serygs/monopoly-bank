import type { AddAccountEmailRequest, AuthTokenRequest, BankruptcyRequest, CreateGameRequest, CreateTransactionRequest, DuplicateGameRequest, FinishGameRequest, GuestJoinGameRequest, JoinGameRequest, LoginRequest, PasswordResetConfirmationRequest, PasswordResetRequest, RegisterRequest, UpdateProfileRequest, UpgradeGuestRequest } from '../../shared/contracts/api.js';
import { currencies, paymentModes, transactionTypes, type Currency, type PaymentMode, type TransactionType } from '../../shared/types/monopoly.js';
import { ValidationError } from '../services/errors.js';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class ApiValidationError extends ValidationError { constructor(message: string, details: Record<string, unknown> = {}) { super(message, details); } }

export function parseResourceId(value: string, field: string): string {
  if (!uuidPattern.test(value)) {
    throw new ApiValidationError(`${field} must be a UUID.`);
  }
  return value;
}

export async function parseCreateGameRequest(request: Request): Promise<CreateGameRequest> {
  const body = await parseJsonObject(request);
  const players = readArray(body, 'players').map((player, index) => {
    const value = readObject(player, `players[${index}]`);
    return {
      name: readRequiredString(value, 'name', `players[${index}].name`),
      color: readRequiredString(value, 'color', `players[${index}].color`),
    };
  });

  if (players.length < 1 || players.length > 6) {
    throw new ApiValidationError('A lobby must have between 1 and 6 players.', {
      playerCount: players.length,
    });
  }

  return {
    name: readRequiredString(body, 'name', 'name'),
    startingBalance: readPositiveInteger(body, 'startingBalance'),
    passGoReward: readPositiveInteger(body, 'passGoReward'),
    currency: readCurrency(body),
    ...(body.paymentMode === undefined ? {} : { paymentMode: readPaymentMode(body) }),
    ...(body.gameAccessPassword === undefined ? {} : { gameAccessPassword: readGamePassword(body, 'gameAccessPassword') }),
    players,
  };
}

export async function parseRegisterRequest(request: Request): Promise<RegisterRequest> { const body = await parseJsonObject(request); return { nickname: readNickname(body), avatar: readAvatar(body), email: readEmail(body), password: readAccountPassword(body, 'password') }; }
export async function parseLoginRequest(request: Request): Promise<LoginRequest> { const body = await parseJsonObject(request); const password = readAccountPassword(body, 'password'); return body.email === undefined ? { nickname: readNickname(body), password } : { email: readEmail(body), password }; }
export async function parseUpdateProfileRequest(request: Request): Promise<UpdateProfileRequest> { const body = await parseJsonObject(request); return { nickname: readNickname(body), avatar: readAvatar(body) }; }
export async function parseJoinGameRequest(request: Request): Promise<JoinGameRequest> { const body = await parseJsonObject(request); if (body.invitationToken !== undefined) return { invitationToken: readInvitationToken(body) }; return { joinCode: readJoinCode(body), ...(body.gameAccessPassword === undefined || body.gameAccessPassword === '' ? {} : { gameAccessPassword: readGamePassword(body, 'gameAccessPassword') }) }; }
export async function parseGuestJoinGameRequest(request: Request): Promise<GuestJoinGameRequest> { const body = await parseJsonObject(request); const credentials = await parseJoinGameBody(body); return { nickname: readNickname(body), avatar: readAvatar(body), ...credentials }; }
export async function parseUpgradeGuestRequest(request: Request): Promise<UpgradeGuestRequest> { const body = await parseJsonObject(request); return { email: readEmail(body), password: readAccountPassword(body, 'password') }; }
export async function parseAddAccountEmailRequest(request: Request): Promise<AddAccountEmailRequest> { const body = await parseJsonObject(request); return { email: readEmail(body) }; }
export async function parseAuthTokenRequest(request: Request): Promise<AuthTokenRequest> { const body = await parseJsonObject(request); return { token: readAuthToken(body) }; }
export async function parsePasswordResetRequest(request: Request): Promise<PasswordResetRequest> { const body = await parseJsonObject(request); return { email: readEmail(body) }; }
export async function parsePasswordResetConfirmationRequest(request: Request): Promise<PasswordResetConfirmationRequest> { const body = await parseJsonObject(request); return { token: readAuthToken(body), password: readAccountPassword(body, 'password') }; }
export async function parseDuplicateGameRequest(request: Request): Promise<DuplicateGameRequest> { const body = await parseJsonObject(request); return { gameAccessPassword: readGamePassword(body, 'gameAccessPassword') }; }
export async function parseBankruptcyRequest(request: Request): Promise<BankruptcyRequest> { const body = await parseJsonObject(request); const creditorPlayerId = body.creditorPlayerId === undefined ? undefined : readUuid(body, 'creditorPlayerId'); return { playerId: readUuid(body, 'playerId'), ...(creditorPlayerId === undefined ? {} : { creditorPlayerId }) }; }
export async function parseFinishGameRequest(request: Request): Promise<FinishGameRequest> { const body = await parseJsonObject(request); const winnerPlayerIds = readArray(body, 'winnerPlayerIds').map((value, index) => parseResourceId(readRequiredString({ value }, 'value', `winnerPlayerIds[${index}]`), `winnerPlayerIds[${index}]`)); if (new Set(winnerPlayerIds).size !== winnerPlayerIds.length) throw new ApiValidationError('winnerPlayerIds must not contain duplicates.'); return { winnerPlayerIds }; }

function readCurrency(body: Record<string, unknown>): Currency {
  const value = body.currency;
  if (typeof value !== 'string' || !currencies.includes(value as Currency)) {
    throw new ApiValidationError('currency must be one of USD, EUR, UAH, or K.');
  }
  return value as Currency;
}

function readPaymentMode(body: Record<string, unknown>): PaymentMode {
  const value = body.paymentMode;
  if (typeof value !== 'string' || !paymentModes.includes(value as PaymentMode)) throw new ApiValidationError('paymentMode must be FAST or CONFIRMATION.');
  return value as PaymentMode;
}

export async function parseCreateTransactionRequest(
  request: Request,
): Promise<CreateTransactionRequest> {
  const body = await parseJsonObject(request);
  const type = readTransactionType(body);
  const comment = readOptionalComment(body);

  switch (type) {
    case 'PLAYER_TO_PLAYER':
      return {
        type,
        sourcePlayerId: readUuid(body, 'sourcePlayerId'),
        destinationPlayerId: readUuid(body, 'destinationPlayerId'),
        amount: readPositiveInteger(body, 'amount'),
        ...(comment === undefined ? {} : { comment }),
      };
    case 'PLAYER_TO_BANK':
    case 'BANK_TO_PLAYER':
      return {
        type,
        playerId: readUuid(body, 'playerId'),
        amount: readPositiveInteger(body, 'amount'),
        ...(comment === undefined ? {} : { comment }),
      };
    case 'PLAYER_TO_ALL':
      return {
        type,
        payerPlayerId: readUuid(body, 'payerPlayerId'),
        amountPerPlayer: readPositiveInteger(body, 'amountPerPlayer'),
        ...(comment === undefined ? {} : { comment }),
      };
    case 'ALL_TO_PLAYER':
      return {
        type,
        recipientPlayerId: readUuid(body, 'recipientPlayerId'),
        amountPerPlayer: readPositiveInteger(body, 'amountPerPlayer'),
        ...(comment === undefined ? {} : { comment }),
      };
    case 'PASS_GO':
      return {
        type,
        playerId: readUuid(body, 'playerId'),
        ...(comment === undefined ? {} : { comment }),
      };
  }
}

async function parseJsonObject(request: Request): Promise<Record<string, unknown>> {
  try {
    return readObject(await request.json(), 'body');
  } catch (error) {
    if (error instanceof ApiValidationError) {
      throw error;
    }
    throw new ApiValidationError('Request body must be valid JSON.');
  }
}

function readObject(value: unknown, field: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new ApiValidationError(`${field} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function readArray(body: Record<string, unknown>, field: string): unknown[] {
  const value = body[field];
  if (!Array.isArray(value)) {
    throw new ApiValidationError(`${field} must be an array.`);
  }
  return value;
}

function readRequiredString(
  body: Record<string, unknown>,
  key: string,
  field: string,
): string {
  const value = body[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ApiValidationError(`${field} is required.`);
  }
  return value.trim();
}

function readNickname(body: Record<string, unknown>): string { const value = readRequiredString(body, 'nickname', 'nickname'); if (value.length < 2 || value.length > 40) throw new ApiValidationError('nickname must be between 2 and 40 characters.'); return value; }
function readEmail(body: Record<string, unknown>): string { const value = readRequiredString(body, 'email', 'email').toLowerCase(); if (value.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value)) throw new ApiValidationError('email must be a valid email address.'); return value; }
function readAvatar(body: Record<string, unknown>): string {
  const value = readRequiredString(body, 'avatar', 'avatar');
  if (value.length <= 32) return value;
  if (value.length <= 100_000 && /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/u.test(value)) return value;
  throw new ApiValidationError('avatar must be an emoji or a JPG, PNG, or WebP image smaller than 100 KB.');
}
function readAccountPassword(body: Record<string, unknown>, field: string): string { const value = readRequiredString(body, field, field); if (value.length < 6 || value.length > 256) throw new ApiValidationError(`${field} must be between 6 and 256 characters.`); return value; }
function readGamePassword(body: Record<string, unknown>, field: string): string { const value = readRequiredString(body, field, field); if (value.length < 4 || value.length > 256) throw new ApiValidationError(`${field} must be between 4 and 256 characters.`); return value; }
function readJoinCode(body: Record<string, unknown>): string { const value = readRequiredString(body, 'joinCode', 'joinCode').toUpperCase(); if (!/^[A-Z0-9]{6,12}$/u.test(value)) throw new ApiValidationError('joinCode must contain 6 to 12 letters or digits.'); return value; }
function readInvitationToken(body: Record<string, unknown>): string { const value = readRequiredString(body, 'invitationToken', 'invitationToken'); if (!/^[A-Za-z0-9_-]{32,128}$/u.test(value)) throw new ApiValidationError('invitationToken is invalid.'); return value; }
function readAuthToken(body: Record<string, unknown>): string { const value = readRequiredString(body, 'token', 'token'); if (!/^[A-Za-z0-9_-]{32,128}$/u.test(value)) throw new ApiValidationError('token is invalid.'); return value; }
async function parseJoinGameBody(body: Record<string, unknown>): Promise<JoinGameRequest> { if (body.invitationToken !== undefined) return { invitationToken: readInvitationToken(body) }; return { joinCode: readJoinCode(body), ...(body.gameAccessPassword === undefined || body.gameAccessPassword === '' ? {} : { gameAccessPassword: readGamePassword(body, 'gameAccessPassword') }) }; }

function readUuid(body: Record<string, unknown>, key: string): string {
  return parseResourceId(readRequiredString(body, key, key), key);
}

function readPositiveInteger(body: Record<string, unknown>, key: string): number {
  const value = body[key];
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) {
    throw new ApiValidationError(`${key} must be a positive integer.`);
  }
  return value;
}

function readTransactionType(body: Record<string, unknown>): Exclude<TransactionType, 'PAY_RENT' | 'BANKRUPTCY_TRANSFER'> {
  const value = body.type;
  if (typeof value !== 'string' || !transactionTypes.includes(value as TransactionType) || value === 'PAY_RENT' || value === 'BANKRUPTCY_TRANSFER') {
    throw new ApiValidationError('type must be a supported transaction type.');
  }
  return value as Exclude<TransactionType, 'PAY_RENT' | 'BANKRUPTCY_TRANSFER'>;
}

function readOptionalComment(body: Record<string, unknown>): string | undefined {
  const value = body.comment;
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string') {
    throw new ApiValidationError('comment must be a string.');
  }
  return value.trim();
}
