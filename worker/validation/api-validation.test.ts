import { describe, expect, it } from 'vitest';
import { ApiValidationError, parseCreateBoardRequest, parseCreateGameRequest, parseCreateTradeRequest, parseDiceRollRequest, parseJailBailRequest, parseJoinGameRequest, parsePropertyBuildRequest, parsePropertyPurchaseRequest, parsePropertyRentRequest, parsePropertySellBuildingsRequest, parseRegisterRequest, parseUpdateProfileRequest } from './api-validation.js';

const playerId = '00000000-0000-4000-8000-000000000002';
const otherPlayerId = '00000000-0000-4000-8000-000000000003';
const spaceNames = Object.fromEntries(Array.from({ length: 28 }, (_, index) => [`board-classic-space-${String(index).padStart(2, '0')}`, `Street ${index}`]));

describe('property request validation', () => {
  it('parses a purchase and rejects a malformed space id', async () => {
    await expect(parsePropertyPurchaseRequest(jsonRequest({ playerId, boardSpaceId: 'board-classic-space-01', comment: ' first buy ' }))).resolves.toEqual({ playerId, boardSpaceId: 'board-classic-space-01', comment: 'first buy' });
    await expect(parsePropertyPurchaseRequest(jsonRequest({ playerId, boardSpaceId: 'not a space!' }))).rejects.toBeInstanceOf(ApiValidationError);
    await expect(parsePropertyPurchaseRequest(jsonRequest({ playerId: 'nope', boardSpaceId: 'board-classic-space-01' }))).rejects.toBeInstanceOf(ApiValidationError);
  });

  it('accepts a dice total of 2..12 for rent and rejects 1 and 13', async () => {
    await expect(parsePropertyRentRequest(jsonRequest({ payerPlayerId: playerId, boardSpaceId: 'board-classic-space-12', diceTotal: 2, chargedByOwner: true }))).resolves.toEqual({ payerPlayerId: playerId, boardSpaceId: 'board-classic-space-12', diceTotal: 2, chargedByOwner: true });
    await expect(parsePropertyRentRequest(jsonRequest({ payerPlayerId: playerId, boardSpaceId: 'board-classic-space-12', diceTotal: 12 }))).resolves.toMatchObject({ diceTotal: 12 });
    await expect(parsePropertyRentRequest(jsonRequest({ payerPlayerId: playerId, boardSpaceId: 'board-classic-space-12', diceTotal: 1 }))).rejects.toBeInstanceOf(ApiValidationError);
    await expect(parsePropertyRentRequest(jsonRequest({ payerPlayerId: playerId, boardSpaceId: 'board-classic-space-12', diceTotal: 13 }))).rejects.toBeInstanceOf(ApiValidationError);
    await expect(parsePropertyRentRequest(jsonRequest({ payerPlayerId: playerId, boardSpaceId: 'board-classic-space-12', chargedByOwner: 'yes' }))).rejects.toBeInstanceOf(ApiValidationError);
    // The request cannot name the owner; any such field is simply not read.
    await expect(parsePropertyRentRequest(jsonRequest({ payerPlayerId: playerId, boardSpaceId: 'board-classic-space-12', ownerPlayerId: otherPlayerId }))).resolves.not.toHaveProperty('ownerPlayerId');
  });

  it('accepts a building count of 1..5 and rejects 0 and 6', async () => {
    await expect(parsePropertyBuildRequest(jsonRequest({ playerId, boardSpaceId: 'board-classic-space-01', count: 1 }))).resolves.toMatchObject({ count: 1 });
    await expect(parsePropertySellBuildingsRequest(jsonRequest({ playerId, boardSpaceId: 'board-classic-space-01', count: 5 }))).resolves.toMatchObject({ count: 5 });
    await expect(parsePropertyBuildRequest(jsonRequest({ playerId, boardSpaceId: 'board-classic-space-01', count: 0 }))).rejects.toBeInstanceOf(ApiValidationError);
    await expect(parsePropertySellBuildingsRequest(jsonRequest({ playerId, boardSpaceId: 'board-classic-space-01', count: 6 }))).rejects.toBeInstanceOf(ApiValidationError);
  });

  it('parses jail bail and dice rolls with dice bounded to 1..6', async () => {
    await expect(parseJailBailRequest(jsonRequest({ playerId }))).resolves.toEqual({ playerId });
    await expect(parseDiceRollRequest(jsonRequest({ playerId, first: 1, second: 6 }))).resolves.toEqual({ playerId, first: 1, second: 6 });
    await expect(parseDiceRollRequest(jsonRequest({ playerId, first: 0, second: 6 }))).rejects.toBeInstanceOf(ApiValidationError);
    await expect(parseDiceRollRequest(jsonRequest({ playerId, first: 3, second: 7 }))).rejects.toBeInstanceOf(ApiValidationError);
  });

  it('parses a trade with two distinct parties, non-negative cash and known mortgage resolutions', async () => {
    await expect(parseCreateTradeRequest(jsonRequest({ proposerPlayerId: playerId, responderPlayerId: otherPlayerId, cashFromProposer: 0, propertiesFromResponder: [{ boardSpaceId: 'board-classic-space-05', mortgageResolution: 'REDEEM' }, { boardSpaceId: 'board-classic-space-06' }] }))).resolves.toEqual({ proposerPlayerId: playerId, responderPlayerId: otherPlayerId, cashFromProposer: 0, propertiesFromResponder: [{ boardSpaceId: 'board-classic-space-05', mortgageResolution: 'REDEEM' }, { boardSpaceId: 'board-classic-space-06' }] });
    await expect(parseCreateTradeRequest(jsonRequest({ proposerPlayerId: playerId, responderPlayerId: playerId }))).rejects.toBeInstanceOf(ApiValidationError);
    await expect(parseCreateTradeRequest(jsonRequest({ proposerPlayerId: playerId, responderPlayerId: otherPlayerId, cashFromResponder: -1 }))).rejects.toBeInstanceOf(ApiValidationError);
    await expect(parseCreateTradeRequest(jsonRequest({ proposerPlayerId: playerId, responderPlayerId: otherPlayerId, propertiesFromProposer: [{ boardSpaceId: 'board-classic-space-05', mortgageResolution: 'FORGIVE' }] }))).rejects.toBeInstanceOf(ApiValidationError);
  });

  it('accepts a board copy with exactly 28 names and rejects 27, 29, an empty name and a control character', async () => {
    await expect(parseCreateBoardRequest(jsonRequest({ name: ' Kyiv ', sourceBoardId: 'board-classic', spaceNames }))).resolves.toEqual({ name: 'Kyiv', sourceBoardId: 'board-classic', spaceNames });
    const entries = Object.entries(spaceNames);
    await expect(parseCreateBoardRequest(jsonRequest({ name: 'Kyiv', sourceBoardId: 'board-classic', spaceNames: Object.fromEntries(entries.slice(0, 27)) }))).rejects.toBeInstanceOf(ApiValidationError);
    await expect(parseCreateBoardRequest(jsonRequest({ name: 'Kyiv', sourceBoardId: 'board-classic', spaceNames: { ...spaceNames, 'board-classic-space-99': 'Extra' } }))).rejects.toBeInstanceOf(ApiValidationError);
    await expect(parseCreateBoardRequest(jsonRequest({ name: 'Kyiv', sourceBoardId: 'board-classic', spaceNames: { ...spaceNames, 'board-classic-space-01': '   ' } }))).rejects.toBeInstanceOf(ApiValidationError);
    await expect(parseCreateBoardRequest(jsonRequest({ name: 'Kyiv', sourceBoardId: 'board-classic', spaceNames: { ...spaceNames, 'board-classic-space-01': 'Bad\u0007name' } }))).rejects.toBeInstanceOf(ApiValidationError);
    await expect(parseCreateBoardRequest(jsonRequest({ name: 'K'.repeat(41), sourceBoardId: 'board-classic', spaceNames }))).rejects.toBeInstanceOf(ApiValidationError);
    await expect(parseCreateBoardRequest(jsonRequest({ name: 'Kyiv', sourceBoardId: 'board-classic', spaceNames: { ...spaceNames, 'board-classic-space-01': 'S'.repeat(33) } }))).rejects.toBeInstanceOf(ApiValidationError);
    await expect(parseCreateBoardRequest(jsonRequest({ name: 'Kyiv', sourceBoardId: 'board-classic', spaceNames: 'Kyiv' }))).rejects.toBeInstanceOf(ApiValidationError);
  });

  it('carries an optional boardId on game creation and rejects a malformed one', async () => {
    const request = { name: 'Friday table', startingBalance: 1500, passGoReward: 200, currency: 'USD', players: [{ name: 'Owner', color: '#e05263' }] };
    await expect(parseCreateGameRequest(jsonRequest({ ...request, boardId: 'board-classic' }))).resolves.toMatchObject({ boardId: 'board-classic' });
    await expect(parseCreateGameRequest(jsonRequest(request))).resolves.not.toHaveProperty('boardId');
    await expect(parseCreateGameRequest(jsonRequest({ ...request, boardId: 'board classic' }))).rejects.toBeInstanceOf(ApiValidationError);
  });
});

describe('profile avatar validation', () => {
  it('accepts a compact JPEG data URL for an uploaded avatar', async () => {
    const avatar = 'data:image/jpeg;base64,SGVsbG8=';
    await expect(parseUpdateProfileRequest(jsonRequest({ nickname: 'Player', avatar }))).resolves.toEqual({ nickname: 'Player', avatar });
  });

  it('rejects unsafe or unsupported data URLs', async () => {
    await expect(parseUpdateProfileRequest(jsonRequest({ nickname: 'Player', avatar: 'data:image/svg+xml;base64,PHN2Zy8+' }))).rejects.toBeInstanceOf(ApiValidationError);
  });
});

describe('lobby request validation', () => {
  it('accepts a public lobby with its account owner as the only initial player', async () => {
    await expect(parseCreateGameRequest(jsonRequest({
      name: 'Friday table', startingBalance: 1500, passGoReward: 200, currency: 'USD',
      players: [{ name: 'Owner', color: '#e05263' }],
    }))).resolves.toEqual({
      name: 'Friday table', startingBalance: 1500, passGoReward: 200, currency: 'USD',
      players: [{ name: 'Owner', color: '#e05263' }],
    });
  });

  it('rejects the legacy K currency and unknown currencies for new games', async () => {
    const request = { name: 'Friday table', startingBalance: 1500, passGoReward: 200, players: [{ name: 'Owner', color: '#e05263' }] };
    await expect(parseCreateGameRequest(jsonRequest({ ...request, currency: 'K' }))).rejects.toBeInstanceOf(ApiValidationError);
    await expect(parseCreateGameRequest(jsonRequest({ ...request, currency: 'GBP' }))).rejects.toBeInstanceOf(ApiValidationError);
    await expect(parseCreateGameRequest(jsonRequest({ ...request, currency: 'UAH' }))).resolves.toMatchObject({ currency: 'UAH' });
  });

  it('accepts joining a public lobby without a password', async () => {
    await expect(parseJoinGameRequest(jsonRequest({ joinCode: 'TABLE42' }))).resolves.toEqual({ joinCode: 'TABLE42' });
  });

  it('accepts a four-character game password and rejects a shorter one', async () => {
    const request = { name: 'Friday table', startingBalance: 1500, passGoReward: 200, currency: 'USD', players: [{ name: 'Owner', color: '#e05263' }] };
    await expect(parseCreateGameRequest(jsonRequest({ ...request, gameAccessPassword: '1234' }))).resolves.toMatchObject({ gameAccessPassword: '1234' });
    await expect(parseCreateGameRequest(jsonRequest({ ...request, gameAccessPassword: '123' }))).rejects.toBeInstanceOf(ApiValidationError);
  });

  it('accepts six-character account passwords and invitation tokens', async () => {
    await expect(parseRegisterRequest(jsonRequest({ nickname: 'Player', avatar: '🎩', password: '123456' }))).resolves.toMatchObject({ nickname: 'Player', password: '123456' });
    await expect(parseJoinGameRequest(jsonRequest({ invitationToken: 'A'.repeat(43) }))).resolves.toEqual({ invitationToken: 'A'.repeat(43) });
  });
});

function jsonRequest(body: object): Request {
  return new Request('https://example.test/api/profile', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
}
