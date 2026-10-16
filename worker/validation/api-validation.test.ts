import { describe, expect, it } from 'vitest';
import {
  ApiValidationError,
  parseCreateGameRequest,
  parseCreateTransactionRequest,
  parseJoinGameRequest,
  parseRegisterRequest,
  parseUpdateProfileRequest,
} from './api-validation.js';

describe('profile avatar validation', () => {
  it('accepts a compact JPEG data URL for an uploaded avatar', async () => {
    const avatar = 'data:image/jpeg;base64,SGVsbG8=';
    await expect(
      parseUpdateProfileRequest(jsonRequest({ nickname: 'Player', avatar })),
    ).resolves.toEqual({ nickname: 'Player', avatar });
  });

  it('rejects unsafe or unsupported data URLs', async () => {
    await expect(
      parseUpdateProfileRequest(
        jsonRequest({ nickname: 'Player', avatar: 'data:image/svg+xml;base64,PHN2Zy8+' }),
      ),
    ).rejects.toBeInstanceOf(ApiValidationError);
  });
});

describe('lobby request validation', () => {
  it('accepts a public lobby with its account owner as the only initial player', async () => {
    await expect(
      parseCreateGameRequest(
        jsonRequest({
          name: 'Friday table',
          startingBalance: 1500,
          passGoReward: 200,
          currency: 'USD',
          players: [{ name: 'Owner', color: '#e05263' }],
        }),
      ),
    ).resolves.toEqual({
      name: 'Friday table',
      startingBalance: 1500,
      passGoReward: 200,
      currency: 'USD',
      players: [{ name: 'Owner', color: '#e05263' }],
    });
  });

  it('rejects the legacy K currency and unknown currencies for new games', async () => {
    const request = {
      name: 'Friday table',
      startingBalance: 1500,
      passGoReward: 200,
      players: [{ name: 'Owner', color: '#e05263' }],
    };
    await expect(
      parseCreateGameRequest(jsonRequest({ ...request, currency: 'K' })),
    ).rejects.toBeInstanceOf(ApiValidationError);
    await expect(
      parseCreateGameRequest(jsonRequest({ ...request, currency: 'GBP' })),
    ).rejects.toBeInstanceOf(ApiValidationError);
    await expect(
      parseCreateGameRequest(jsonRequest({ ...request, currency: 'UAH' })),
    ).resolves.toMatchObject({ currency: 'UAH' });
  });

  it('accepts joining a public lobby without a password', async () => {
    await expect(parseJoinGameRequest(jsonRequest({ joinCode: 'TABLE42' }))).resolves.toEqual({
      joinCode: 'TABLE42',
    });
  });

  it('accepts a four-character game password and rejects a shorter one', async () => {
    const request = {
      name: 'Friday table',
      startingBalance: 1500,
      passGoReward: 200,
      currency: 'USD',
      players: [{ name: 'Owner', color: '#e05263' }],
    };
    await expect(
      parseCreateGameRequest(jsonRequest({ ...request, gameAccessPassword: '1234' })),
    ).resolves.toMatchObject({ gameAccessPassword: '1234' });
    await expect(
      parseCreateGameRequest(jsonRequest({ ...request, gameAccessPassword: '123' })),
    ).rejects.toBeInstanceOf(ApiValidationError);
  });

  it('accepts six-character account passwords and invitation tokens', async () => {
    await expect(
      parseRegisterRequest(jsonRequest({ nickname: 'Player', avatar: '🎩', password: '123456' })),
    ).resolves.toMatchObject({ nickname: 'Player', password: '123456' });
    await expect(
      parseJoinGameRequest(jsonRequest({ invitationToken: 'A'.repeat(43) })),
    ).resolves.toEqual({ invitationToken: 'A'.repeat(43) });
  });
});

function jsonRequest(body: object): Request {
  return new Request('https://example.test/api/profile', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('game rules validation', () => {
  const lobby = {
    name: 'Friday table',
    startingBalance: 1500,
    passGoReward: 200,
    currency: 'USD',
    players: [{ name: 'Owner', color: '#e05263' }],
  };

  it('leaves rules out when the client sends none, so every rule is off', async () => {
    await expect(parseCreateGameRequest(jsonRequest(lobby))).resolves.not.toHaveProperty('rules');
  });

  it('fills missing rules as off and keeps the chosen ones', async () => {
    const parsed = await parseCreateGameRequest(
      jsonRequest({ ...lobby, rules: { playerLoans: true, auctions: true } }),
    );
    expect(parsed.rules).toEqual({
      doubleRewardOnExactGo: false,
      playerLoans: true,
      bankLoans: false,
      freeParkingJackpot: false,
      auctions: true,
    });
  });

  it.each([
    ['an unknown rule', { houseRule: true }],
    ['a non-boolean flag', { playerLoans: 'yes' }],
    ['a numeric flag', { auctions: 1 }],
  ])('rejects %s', async (_name, rules) => {
    await expect(parseCreateGameRequest(jsonRequest({ ...lobby, rules }))).rejects.toBeInstanceOf(
      ApiValidationError,
    );
  });

  it.each([null, [], 'all', 3])('rejects rules that are not an object: %j', async (rules) => {
    await expect(parseCreateGameRequest(jsonRequest({ ...lobby, rules }))).rejects.toBeInstanceOf(
      ApiValidationError,
    );
  });
});

describe('Pass GO validation', () => {
  const playerId = '11111111-1111-4111-8111-111111111111';

  it('accepts the exact-landing flag and drops it when false', async () => {
    await expect(
      parseCreateTransactionRequest(jsonRequest({ type: 'PASS_GO', playerId, exactLanding: true })),
    ).resolves.toEqual({ type: 'PASS_GO', playerId, exactLanding: true });
    await expect(
      parseCreateTransactionRequest(
        jsonRequest({ type: 'PASS_GO', playerId, exactLanding: false }),
      ),
    ).resolves.toEqual({ type: 'PASS_GO', playerId });
  });

  it('rejects a flag that is not a boolean', async () => {
    await expect(
      parseCreateTransactionRequest(
        jsonRequest({ type: 'PASS_GO', playerId, exactLanding: 'true' }),
      ),
    ).rejects.toBeInstanceOf(ApiValidationError);
  });
});

describe('reversal validation', () => {
  const transactionId = '33333333-3333-4333-8333-333333333333';

  it('accepts a reversal of a transaction with an optional comment', async () => {
    await expect(
      parseCreateTransactionRequest(
        jsonRequest({ type: 'REVERSAL', transactionId, comment: ' Wrong player ' }),
      ),
    ).resolves.toEqual({ type: 'REVERSAL', transactionId, comment: 'Wrong player' });
    await expect(
      parseCreateTransactionRequest(jsonRequest({ type: 'REVERSAL', transactionId })),
    ).resolves.toEqual({ type: 'REVERSAL', transactionId });
  });

  it('rejects a missing or malformed transaction id', async () => {
    await expect(
      parseCreateTransactionRequest(jsonRequest({ type: 'REVERSAL' })),
    ).rejects.toBeInstanceOf(ApiValidationError);
    await expect(
      parseCreateTransactionRequest(jsonRequest({ type: 'REVERSAL', transactionId: 'nope' })),
    ).rejects.toBeInstanceOf(ApiValidationError);
  });
});
