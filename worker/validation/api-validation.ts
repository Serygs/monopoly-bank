import type {
  AddAccountEmailRequest,
  AuthTokenRequest,
  BankruptcyRequest,
  CreateGameRequest,
  CreateTransactionRequest,
  DuplicateGameRequest,
  FinishGameRequest,
  PlaceBidRequest,
  StartAuctionRequest,
  GuestJoinGameRequest,
  JoinGameRequest,
  LoginRequest,
  PasswordResetConfirmationRequest,
  PasswordResetRequest,
  RegisterRequest,
  UpdateProfileRequest,
  UpgradeGuestRequest,
  RecordDiceRollRequest,
} from '../../shared/contracts/api.js';
import {
  gameRuleKeys,
  paymentModes,
  selectableCurrencies,
  transactionTypes,
  type GameRules,
  type InterestRatePercent,
  type PaymentMode,
  type SelectableCurrency,
  type TransactionType,
} from '../../shared/types/monopoly.js';
import { isBoardMode, type BoardMode } from '../../shared/board/index.js';
import { isInterestRatePercent } from '../../shared/domain/bank-loan.js';
import { normalizePropertyName } from '../../shared/domain/mortgage.js';
import { ValidationError } from '../services/errors.js';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class ApiValidationError extends ValidationError {
  constructor(message: string, details: Record<string, unknown> = {}) {
    super(message, details);
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

  if (players.length < 1 || players.length > 6) {
    throw new ApiValidationError('A lobby must have between 1 and 6 players.', {
      playerCount: players.length,
    });
  }

  if (body.isPublic !== undefined && typeof body.isPublic !== 'boolean')
    throw new ApiValidationError('isPublic must be a boolean.');
  const isPublic = body.isPublic === true;
  if (isPublic && body.gameAccessPassword !== undefined)
    throw new ApiValidationError('A public lobby cannot have a table password.');

  return {
    name: readRequiredString(body, 'name', 'name'),
    startingBalance: readPositiveInteger(body, 'startingBalance'),
    passGoReward: readPositiveInteger(body, 'passGoReward'),
    currency: readCurrency(body),
    ...(body.paymentMode === undefined ? {} : { paymentMode: readPaymentMode(body) }),
    ...(body.rules === undefined ? {} : { rules: readGameRules(body.rules) }),
    ...(body.board === undefined ? {} : { board: readBoardMode(body.board) }),
    ...(isPublic ? { isPublic } : {}),
    ...(body.gameAccessPassword === undefined
      ? {}
      : { gameAccessPassword: readGamePassword(body, 'gameAccessPassword') }),
    players,
  };
}

export async function parseRegisterRequest(request: Request): Promise<RegisterRequest> {
  const body = await parseJsonObject(request);
  return {
    nickname: readNickname(body),
    avatar: readAvatar(body),
    password: readAccountPassword(body, 'password'),
  };
}
export async function parseLoginRequest(request: Request): Promise<LoginRequest> {
  const body = await parseJsonObject(request);
  const password = readAccountPassword(body, 'password');
  return body.email === undefined
    ? { nickname: readNickname(body), password }
    : { email: readEmail(body), password };
}
export async function parseUpdateProfileRequest(request: Request): Promise<UpdateProfileRequest> {
  const body = await parseJsonObject(request);
  return { nickname: readNickname(body), avatar: readAvatar(body) };
}
export async function parseJoinGameRequest(request: Request): Promise<JoinGameRequest> {
  const body = await parseJsonObject(request);
  if (body.invitationToken !== undefined) return { invitationToken: readInvitationToken(body) };
  return {
    joinCode: readJoinCode(body),
    ...(body.gameAccessPassword === undefined || body.gameAccessPassword === ''
      ? {}
      : { gameAccessPassword: readGamePassword(body, 'gameAccessPassword') }),
  };
}
export async function parseGuestJoinGameRequest(request: Request): Promise<GuestJoinGameRequest> {
  const body = await parseJsonObject(request);
  const credentials = parseJoinGameBody(body);
  return { nickname: readNickname(body), avatar: readAvatar(body), ...credentials };
}
export async function parseUpgradeGuestRequest(request: Request): Promise<UpgradeGuestRequest> {
  const body = await parseJsonObject(request);
  return { email: readEmail(body), password: readAccountPassword(body, 'password') };
}
export async function parseAddAccountEmailRequest(
  request: Request,
): Promise<AddAccountEmailRequest> {
  const body = await parseJsonObject(request);
  return { email: readEmail(body) };
}
export async function parseAuthTokenRequest(request: Request): Promise<AuthTokenRequest> {
  const body = await parseJsonObject(request);
  return { token: readAuthToken(body) };
}
export async function parsePasswordResetRequest(request: Request): Promise<PasswordResetRequest> {
  const body = await parseJsonObject(request);
  return { email: readEmail(body) };
}
export async function parsePasswordResetConfirmationRequest(
  request: Request,
): Promise<PasswordResetConfirmationRequest> {
  const body = await parseJsonObject(request);
  return { token: readAuthToken(body), password: readAccountPassword(body, 'password') };
}
export async function parseDuplicateGameRequest(request: Request): Promise<DuplicateGameRequest> {
  const body = await parseJsonObject(request);
  return { gameAccessPassword: readGamePassword(body, 'gameAccessPassword') };
}
export async function parseBankruptcyRequest(request: Request): Promise<BankruptcyRequest> {
  const body = await parseJsonObject(request);
  const creditorPlayerId =
    body.creditorPlayerId === undefined ? undefined : readUuid(body, 'creditorPlayerId');
  return {
    playerId: readUuid(body, 'playerId'),
    ...(creditorPlayerId === undefined ? {} : { creditorPlayerId }),
  };
}
export async function parseFinishGameRequest(request: Request): Promise<FinishGameRequest> {
  const body = await parseJsonObject(request);
  const winnerPlayerIds = readArray(body, 'winnerPlayerIds').map((value, index) =>
    parseResourceId(
      readRequiredString({ value }, 'value', `winnerPlayerIds[${index}]`),
      `winnerPlayerIds[${index}]`,
    ),
  );
  if (new Set(winnerPlayerIds).size !== winnerPlayerIds.length)
    throw new ApiValidationError('winnerPlayerIds must not contain duplicates.');
  return { winnerPlayerIds };
}

export async function parseStartAuctionRequest(request: Request): Promise<StartAuctionRequest> {
  const body = await parseJsonObject(request);
  const tileId = body.tileId === undefined ? undefined : readTileId(body);
  // A board auction takes its lot name from the tile on the server; a free-text one needs it.
  const name =
    tileId !== undefined && body.lotName === undefined
      ? tileId
      : typeof body.lotName === 'string'
        ? normalizePropertyName(body.lotName)
        : null;
  if (name === null)
    throw new ApiValidationError('lotName must be 1 to 60 characters without control characters.');
  return {
    initiatorPlayerId: readUuid(body, 'initiatorPlayerId'),
    lotName: name,
    ...(tileId === undefined ? {} : { tileId }),
  };
}

/** The auction id comes from the URL, so the body carries everything else. */
export async function parsePlaceBidRequest(
  request: Request,
  auctionId: string,
): Promise<PlaceBidRequest> {
  const body = await parseJsonObject(request);
  return {
    bidderPlayerId: readUuid(body, 'bidderPlayerId'),
    auctionId: parseResourceId(auctionId, 'auctionId'),
    expectedVersion: readPositiveInteger(body, 'expectedVersion'),
    step: readPositiveInteger(body, 'step'),
  };
}

export async function parseRecordDiceRollRequest(request: Request): Promise<RecordDiceRollRequest> {
  const body = await parseJsonObject(request);
  return {
    id: readUuid(body, 'id'),
    dieOne: readDie(body, 'dieOne'),
    dieTwo: readDie(body, 'dieTwo'),
  };
}

function readDie(body: Record<string, unknown>, key: string): number {
  const value = body[key];
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 6)
    throw new ApiValidationError(`${key} must be an integer from 1 to 6.`);
  return value;
}

function readCurrency(body: Record<string, unknown>): SelectableCurrency {
  const value = body.currency;
  if (typeof value !== 'string' || !selectableCurrencies.includes(value as SelectableCurrency)) {
    throw new ApiValidationError('currency must be one of USD, EUR, or UAH.');
  }
  return value as SelectableCurrency;
}

function readBoardMode(value: unknown): BoardMode {
  if (!isBoardMode(value))
    throw new ApiValidationError('board must be one of none or monopoly-ru-2012.');
  return value;
}

function readGameRules(value: unknown): GameRules {
  const object = readObject(value, 'rules');
  const unknownKey = Object.keys(object).find(
    (key) => !(gameRuleKeys as readonly string[]).includes(key),
  );
  if (unknownKey !== undefined) throw new ApiValidationError(`rules.${unknownKey} is not a rule.`);
  const rules = {} as GameRules;
  for (const key of gameRuleKeys) {
    const flag = object[key];
    if (flag !== undefined && typeof flag !== 'boolean')
      throw new ApiValidationError(`rules.${key} must be true or false.`);
    rules[key] = flag === true;
  }
  return rules;
}

export function readTileId(body: Record<string, unknown>): string {
  const value = body.tileId;
  if (typeof value !== 'string' || !/^[a-z][a-z0-9_]{0,63}$/u.test(value))
    throw new ApiValidationError('tileId must be a board tile id.');
  return value;
}

/** A list of board tile ids (at most one per tile of the board), possibly empty. */
function readTileIdList(body: Record<string, unknown>, key: string): string[] {
  const value = body[key];
  if (!Array.isArray(value) || value.length > 28)
    throw new ApiValidationError(`${key} must be a list of board tile ids.`);
  return value.map((item) => {
    if (typeof item !== 'string' || !/^[a-z][a-z0-9_]{0,63}$/u.test(item))
      throw new ApiValidationError(`${key} must be a list of board tile ids.`);
    return item;
  });
}

function readNonNegativeInteger(body: Record<string, unknown>, key: string): number {
  const value = body[key];
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
    throw new ApiValidationError(`${key} must be zero or a positive integer.`);
  return value;
}

function readPropertyName(body: Record<string, unknown>): string {
  const value = body.propertyName;
  const name = typeof value === 'string' ? normalizePropertyName(value) : null;
  if (name === null)
    throw new ApiValidationError(
      'propertyName must be 1 to 60 characters without control characters.',
    );
  return name;
}

function readInterestRatePercent(body: Record<string, unknown>): InterestRatePercent {
  const value = body.interestRatePercent;
  if (!isInterestRatePercent(value))
    throw new ApiValidationError('interestRatePercent must be 0, 10 or 20.');
  return value;
}

function readPaymentMode(body: Record<string, unknown>): PaymentMode {
  const value = body.paymentMode;
  if (typeof value !== 'string' || !paymentModes.includes(value as PaymentMode))
    throw new ApiValidationError('paymentMode must be FAST or CONFIRMATION.');
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
    case 'MORTGAGE':
      // A board game names the tile; the server reads its name and mortgage value from the snapshot.
      if (body.tileId !== undefined)
        return { type, playerId: readUuid(body, 'playerId'), tileId: readTileId(body) };
      return {
        type,
        playerId: readUuid(body, 'playerId'),
        propertyName: readPropertyName(body),
        amount: readPositiveInteger(body, 'amount'),
      };
    case 'PROPERTY_PURCHASE':
      return {
        type,
        playerId: readUuid(body, 'playerId'),
        tileId: readTileId(body),
        ...(body.priceOverride === undefined
          ? {}
          : { priceOverride: readPositiveInteger(body, 'priceOverride') }),
      };
    case 'PROPERTY_TRANSFER': {
      const playerId = readUuid(body, 'playerId');
      const counterpartyPlayerId = readUuid(body, 'counterpartyPlayerId');
      if (playerId === counterpartyPlayerId)
        throw new ApiValidationError('counterpartyPlayerId must be another player.');
      const giveTileIds = readTileIdList(body, 'giveTileIds');
      const takeTileIds = readTileIdList(body, 'takeTileIds');
      if (
        new Set([...giveTileIds, ...takeTileIds]).size !==
        giveTileIds.length + takeTileIds.length
      )
        throw new ApiValidationError('A property can only be traded once.');
      if (giveTileIds.length + takeTileIds.length === 0)
        throw new ApiValidationError('A trade needs at least one property.');
      return {
        type,
        playerId,
        counterpartyPlayerId,
        giveTileIds,
        takeTileIds,
        ...(body.cashGive === undefined
          ? {}
          : { cashGive: readNonNegativeInteger(body, 'cashGive') }),
        ...(body.cashTake === undefined
          ? {}
          : { cashTake: readNonNegativeInteger(body, 'cashTake') }),
      };
    }
    case 'PROPERTY_BUILD':
    case 'PROPERTY_SELL_BUILDING':
      return { type, playerId: readUuid(body, 'playerId'), tileId: readTileId(body) };
    case 'PAY_RENT':
      return {
        type,
        payerPlayerId: readUuid(body, 'payerPlayerId'),
        tileId: readTileId(body),
        ...(body.diceSum === undefined ? {} : { diceSum: readDiceSum(body) }),
      };
    case 'MORTGAGE_REDEMPTION':
      return {
        type,
        playerId: readUuid(body, 'playerId'),
        mortgageId: readUuid(body, 'mortgageId'),
      };
    case 'LOAN_ISSUE':
      if (
        body.lenderKind !== undefined &&
        body.lenderKind !== 'PLAYER' &&
        body.lenderKind !== 'BANK'
      )
        throw new ApiValidationError('lenderKind must be PLAYER or BANK.');
      if (body.lenderKind === 'BANK') {
        if (body.acknowledgeCooldown !== undefined && typeof body.acknowledgeCooldown !== 'boolean')
          throw new ApiValidationError('acknowledgeCooldown must be true or false.');
        return {
          type,
          lenderKind: 'BANK',
          playerId: readUuid(body, 'playerId'),
          amount: readPositiveInteger(body, 'amount'),
          ...(body.acknowledgeCooldown === true ? { acknowledgeCooldown: true } : {}),
        };
      }
      return {
        type,
        borrowerPlayerId: readUuid(body, 'borrowerPlayerId'),
        lenderPlayerId: readUuid(body, 'lenderPlayerId'),
        amount: readPositiveInteger(body, 'amount'),
      };
    case 'LOAN_REPAYMENT':
      return {
        type,
        playerId: readUuid(body, 'playerId'),
        loanId: readUuid(body, 'loanId'),
        amount: readPositiveInteger(body, 'amount'),
        ...(body.interestRatePercent === undefined
          ? {}
          : { interestRatePercent: readInterestRatePercent(body) }),
      };
    case 'TO_JACKPOT':
      return {
        type,
        playerId: readUuid(body, 'playerId'),
        amount: readPositiveInteger(body, 'amount'),
        ...(comment === undefined ? {} : { comment }),
      };
    case 'JACKPOT_PAYOUT':
      // The paid amount is the whole pot, read on the server; any `amount` is ignored. The client
      // only says which pot it reviewed, so a pot that changed since is refused (JACKPOT_CHANGED).
      return {
        type,
        playerId: readUuid(body, 'playerId'),
        expectedAmount: readPositiveInteger(body, 'expectedAmount'),
      };
    case 'REVERSAL':
      return {
        type,
        transactionId: readUuid(body, 'transactionId'),
        ...(comment === undefined ? {} : { comment }),
      };
    case 'PASS_GO': {
      if (body.exactLanding !== undefined && typeof body.exactLanding !== 'boolean')
        throw new ApiValidationError('exactLanding must be true or false.');
      return {
        type,
        playerId: readUuid(body, 'playerId'),
        ...(body.exactLanding === true ? { exactLanding: true } : {}),
        ...(comment === undefined ? {} : { comment }),
      };
    }
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

function readRequiredString(body: Record<string, unknown>, key: string, field: string): string {
  const value = body[key];
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new ApiValidationError(`${field} is required.`);
  }
  return value.trim();
}

function readNickname(body: Record<string, unknown>): string {
  const value = readRequiredString(body, 'nickname', 'nickname');
  if (value.length < 2 || value.length > 40)
    throw new ApiValidationError('nickname must be between 2 and 40 characters.');
  return value;
}
function readEmail(body: Record<string, unknown>): string {
  const value = readRequiredString(body, 'email', 'email').toLowerCase();
  if (value.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value))
    throw new ApiValidationError('email must be a valid email address.');
  return value;
}
function readAvatar(body: Record<string, unknown>): string {
  const value = readRequiredString(body, 'avatar', 'avatar');
  if (value.length <= 32) return value;
  if (
    value.length <= 100_000 &&
    /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/u.test(value)
  )
    return value;
  throw new ApiValidationError(
    'avatar must be an emoji or a JPG, PNG, or WebP image smaller than 100 KB.',
  );
}
function readAccountPassword(body: Record<string, unknown>, field: string): string {
  const value = readRequiredString(body, field, field);
  if (value.length < 6 || value.length > 256)
    throw new ApiValidationError(`${field} must be between 6 and 256 characters.`);
  return value;
}
function readGamePassword(body: Record<string, unknown>, field: string): string {
  const value = readRequiredString(body, field, field);
  if (value.length < 4 || value.length > 256)
    throw new ApiValidationError(`${field} must be between 4 and 256 characters.`);
  return value;
}
function readJoinCode(body: Record<string, unknown>): string {
  const value = readRequiredString(body, 'joinCode', 'joinCode').trim().toUpperCase();
  if (!/^[A-Z0-9]{4,12}$/u.test(value))
    throw new ApiValidationError('joinCode must contain 4 to 12 letters or digits.');
  return value;
}
function readInvitationToken(body: Record<string, unknown>): string {
  const value = readRequiredString(body, 'invitationToken', 'invitationToken');
  if (!/^[A-Za-z0-9_-]{32,128}$/u.test(value))
    throw new ApiValidationError('invitationToken is invalid.');
  return value;
}
function readAuthToken(body: Record<string, unknown>): string {
  const value = readRequiredString(body, 'token', 'token');
  if (!/^[A-Za-z0-9_-]{32,128}$/u.test(value)) throw new ApiValidationError('token is invalid.');
  return value;
}
function parseJoinGameBody(body: Record<string, unknown>): JoinGameRequest {
  if (body.invitationToken !== undefined) return { invitationToken: readInvitationToken(body) };
  return {
    joinCode: readJoinCode(body),
    ...(body.gameAccessPassword === undefined || body.gameAccessPassword === ''
      ? {}
      : { gameAccessPassword: readGamePassword(body, 'gameAccessPassword') }),
  };
}

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

/** Two six-sided dice: the sum is between 2 and 12. */
function readDiceSum(body: Record<string, unknown>): number {
  const value = readPositiveInteger(body, 'diceSum');
  if (value < 2 || value > 12) {
    throw new ApiValidationError('diceSum must be between 2 and 12.');
  }
  return value;
}

function readTransactionType(
  body: Record<string, unknown>,
): Exclude<TransactionType, 'BANKRUPTCY_TRANSFER' | 'AUCTION_PAYMENT'> {
  const value = body.type;
  if (
    typeof value !== 'string' ||
    !transactionTypes.includes(value as TransactionType) ||
    value === 'BANKRUPTCY_TRANSFER' ||
    // Written only when an auction closes; never requested by a client.
    value === 'AUCTION_PAYMENT'
  ) {
    throw new ApiValidationError('type must be a supported transaction type.');
  }
  return value as Exclude<TransactionType, 'BANKRUPTCY_TRANSFER' | 'AUCTION_PAYMENT'>;
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
