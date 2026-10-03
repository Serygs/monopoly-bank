import { describe, expect, it } from 'vitest';
import { hashPassword, passwordHashIterations, verifyPassword } from './password-security.js';

describe('password security', () => {
  it('uses a Cloudflare Workers-compatible PBKDF2 work factor and verifies passwords', async () => {
    expect(passwordHashIterations).toBe(100_000);

    const credentials = await hashPassword(
      'correct-horse-battery-staple',
      'MDEyMzQ1Njc4OWFiY2RlZg',
    );

    await expect(verifyPassword('correct-horse-battery-staple', credentials)).resolves.toBe(true);
    await expect(verifyPassword('different-password', credentials)).resolves.toBe(false);
  });
});
