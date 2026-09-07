import { describe, expect, it } from 'vitest';
import { ApiValidationError, parseCreateGameRequest, parseJoinGameRequest, parseRegisterRequest, parseUpdateProfileRequest } from './api-validation.js';

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
      name: 'Friday table', startingBalance: 1500, passGoReward: 200, currency: 'K',
      players: [{ name: 'Owner', color: '#e05263' }],
    }))).resolves.toEqual({
      name: 'Friday table', startingBalance: 1500, passGoReward: 200, currency: 'K',
      players: [{ name: 'Owner', color: '#e05263' }],
    });
  });

  it('accepts joining a public lobby without a password', async () => {
    await expect(parseJoinGameRequest(jsonRequest({ joinCode: 'TABLE42' }))).resolves.toEqual({ joinCode: 'TABLE42' });
  });

  it('accepts a four-character game password and rejects a shorter one', async () => {
    const request = { name: 'Friday table', startingBalance: 1500, passGoReward: 200, currency: 'K', players: [{ name: 'Owner', color: '#e05263' }] };
    await expect(parseCreateGameRequest(jsonRequest({ ...request, gameAccessPassword: '1234' }))).resolves.toMatchObject({ gameAccessPassword: '1234' });
    await expect(parseCreateGameRequest(jsonRequest({ ...request, gameAccessPassword: '123' }))).rejects.toBeInstanceOf(ApiValidationError);
  });

  it('accepts six-character account passwords and invitation tokens', async () => {
    await expect(parseRegisterRequest(jsonRequest({ nickname: 'Player', avatar: '🎩', email: 'Player@Example.test', password: '123456' }))).resolves.toMatchObject({ email: 'player@example.test', password: '123456' });
    await expect(parseJoinGameRequest(jsonRequest({ invitationToken: 'A'.repeat(43) }))).resolves.toEqual({ invitationToken: 'A'.repeat(43) });
  });
});

function jsonRequest(body: object): Request {
  return new Request('https://example.test/api/profile', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
}
