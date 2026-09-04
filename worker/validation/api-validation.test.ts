import { describe, expect, it } from 'vitest';
import { ApiValidationError, parseUpdateProfileRequest } from './api-validation.js';

describe('profile avatar validation', () => {
  it('accepts a compact JPEG data URL for an uploaded avatar', async () => {
    const avatar = 'data:image/jpeg;base64,SGVsbG8=';
    await expect(parseUpdateProfileRequest(jsonRequest({ nickname: 'Player', avatar }))).resolves.toEqual({ nickname: 'Player', avatar });
  });

  it('rejects unsafe or unsupported data URLs', async () => {
    await expect(parseUpdateProfileRequest(jsonRequest({ nickname: 'Player', avatar: 'data:image/svg+xml;base64,PHN2Zy8+' }))).rejects.toBeInstanceOf(ApiValidationError);
  });
});

function jsonRequest(body: object): Request {
  return new Request('https://example.test/api/profile', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
}
