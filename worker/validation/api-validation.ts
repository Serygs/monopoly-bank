import type { BankruptcyRequest, CreateGameRequest, CreateTransactionRequest, JoinGameRequest, LoginRequest, RegisterRequest, UpdateProfileRequest } from '../../shared/contracts/api.js';
import { currencies, transactionTypes, type Currency, type TransactionType } from '../../shared/types/monopoly.js';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class ApiValidationError extends Error {
  readonly details: Record<string, string | number>;

  constructor(message: string, details: Record<string, string | number> = {}) {
    super(message);
    this.details = details;
  }
}

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

  if (players.length < 2 || players.length > 6) {
    throw new ApiValidationError('A game must have between 2 and 6 players.', {
      playerCount: players.length,
    });
  }

  return {
    name: readRequiredString(body, 'name', 'name'),
    startingBalance: readPositiveInteger(body, 'startingBalance'),
    passGoReward: readPositiveInteger(body, 'passGoReward'),
    currency: readCurrency(body),
    gameAccessPassword: readPassword(body, 'gameAccessPassword'),
    players,
  };
}

export async function parseRegisterRequest(request: Request): Promise<RegisterRequest> { const body = await parseJsonObject(request); return { nickname: readNickname(body), avatar: readAvatar(body), password: readPassword(body, 'password') }; }
export async function parseLoginRequest(request: Request): Promise<LoginRequest> { const body = await parseJsonObject(request); return { nickname: readNickname(body), password: readPassword(body, 'password') }; }
export async function parseUpdateProfileRequest(request: Request): Promise<UpdateProfileRequest> { const body = await parseJsonObject(request); return { nickname: readNickname(body), avatar: readAvatar(body) }; }
export async function parseJoinGameRequest(request: Request): Promise<JoinGameRequest> { const body = await parseJsonObject(request); const playerId = body.playerId === undefined ? undefined : readUuid(body, 'playerId'); return { joinCode: readJoinCode(body), gameAccessPassword: readPassword(body, 'gameAccessPassword'), ...(playerId === undefined ? {} : { playerId }) }; }
export async function parseBankruptcyRequest(request: Request): Promise<BankruptcyRequest> { const body = await parseJsonObject(request); const creditorPlayerId = body.creditorPlayerId === undefined ? undefined : readUuid(body, 'creditorPlayerId'); return { playerId: readUuid(body, 'playerId'), ...(creditorPlayerId === undefined ? {} : { creditorPlayerId }) }; }

function readCurrency(body: Record<string, unknown>): Currency {
  const value = body.currency;
  if (typeof value !== 'string' || !currencies.includes(value as Currency)) {
    throw new ApiValidationError('currency must be one of USD, EUR, UAH, or K.');
  }
  return value as Currency;
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
function readAvatar(body: Record<string, unknown>): string { const value = readRequiredString(body, 'avatar', 'avatar'); if (value.length > 32) throw new ApiValidationError('avatar must be at most 32 characters.'); return value; }
function readPassword(body: Record<string, unknown>, field: string): string { const value = readRequiredString(body, field, field); if (value.length < 10 || value.length > 256) throw new ApiValidationError(`${field} must be between 10 and 256 characters.`); return value; }
function readJoinCode(body: Record<string, unknown>): string { const value = readRequiredString(body, 'joinCode', 'joinCode').toUpperCase(); if (!/^[A-Z0-9]{6,12}$/u.test(value)) throw new ApiValidationError('joinCode must contain 6 to 12 letters or digits.'); return value; }

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
