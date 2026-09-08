import { describe, expect, it } from 'vitest';

import type { AuthTokenPurpose, AuthTokenRepository } from '../repositories/auth-token-repository.js';
import type { SessionRepository } from '../repositories/session-repository.js';
import type { CreateUserInput, UserRecord, UserRepository } from '../repositories/user-repository.js';
import { EmailDeliveryError, InvalidCredentialsError } from './errors.js';
import { AuthService } from './auth-service.js';
import type { TransactionalEmail, TransactionalEmailProvider } from './transactional-email.js';

describe('AuthService email accounts and guests', () => {
  it('registers an account from just a nickname and password, without an email', async () => {
    const fixture = createFixture();
    const result = await fixture.auth.register({ nickname: 'Ada', avatar: '🎩', password: 'secure-password' });

    expect(result.profile).toMatchObject({ accountType: 'REGISTERED', email: null, emailVerified: false });
    expect(fixture.email.messages).toHaveLength(0);
    await expect(fixture.auth.login({ nickname: 'Ada', password: 'secure-password' })).resolves.toMatchObject({ profile: { id: result.profile.id } });
  });

  it('upgrades a guest in place, normalizing and storing only a token hash, and sends verification', async () => {
    const fixture = createFixture();
    const guest = await fixture.auth.createGuest('Ada', '🎩');
    const upgraded = await fixture.auth.upgradeGuest(guest.profile.id, ' Ada@Example.TEST ', 'secure-password');

    expect(upgraded.profile).toMatchObject({ id: guest.profile.id, accountType: 'REGISTERED', email: ' Ada@Example.TEST ', emailVerified: false });
    expect(fixture.users.byEmail.get('ada@example.test')?.email).toBe(' Ada@Example.TEST ');
    expect(fixture.email.messages).toHaveLength(1);
    const rawToken = new URL(fixture.email.messages[0].text.split(': ')[1]).hash.split('=')[1] ?? null;
    expect(rawToken).not.toBeNull();
    expect(fixture.tokens.issued[0].tokenHash).not.toBe(rawToken);
  });

  it('returns the same invalid-credentials result for unknown email and bad password', async () => {
    const fixture = createFixture();
    const guest = await fixture.auth.createGuest('Ada', '🎩');
    await fixture.auth.upgradeGuest(guest.profile.id, 'ada@example.test', 'secure-password');

    await expect(fixture.auth.login({ email: 'missing@example.test', password: 'secure-password' })).rejects.toBeInstanceOf(InvalidCredentialsError);
    await expect(fixture.auth.login({ email: 'ada@example.test', password: 'wrong-password' })).rejects.toBeInstanceOf(InvalidCredentialsError);
  });

  it('returns normally for known and unknown password-reset emails without sending to the unknown address', async () => {
    const fixture = createFixture();
    const guest = await fixture.auth.createGuest('Ada', '🎩');
    await fixture.auth.upgradeGuest(guest.profile.id, 'ada@example.test', 'secure-password');
    fixture.email.messages.length = 0;

    await expect(fixture.auth.requestPasswordReset('missing@example.test')).resolves.toBeUndefined();
    await expect(fixture.auth.requestPasswordReset('ada@example.test')).resolves.toBeUndefined();
    expect(fixture.email.messages).toHaveLength(1);
  });

  it('throttles repeated reset requests by leaving the existing usable token in place', async () => {
    const fixture = createFixture();
    const guest = await fixture.auth.createGuest('Ada', '🎩');
    await fixture.auth.upgradeGuest(guest.profile.id, 'ada@example.test', 'secure-password');
    fixture.email.messages.length = 0;

    await fixture.auth.requestPasswordReset('ada@example.test');
    await fixture.auth.requestPasswordReset('ada@example.test');

    expect(fixture.email.messages).toHaveLength(1);
  });

  it('consumes a reset token and revokes all sessions after changing the password', async () => {
    const fixture = createFixture();
    const guest = await fixture.auth.createGuest('Ada', '🎩');
    const registered = await fixture.auth.upgradeGuest(guest.profile.id, 'ada@example.test', 'secure-password');
    fixture.tokens.nextConsumedUserId = registered.profile.id;
    fixture.sessions.revokedUserIds.length = 0;

    await fixture.auth.resetPassword('reset-token-value-that-is-long-enough', 'new-secure-password');

    expect(fixture.sessions.revokedUserIds).toEqual([registered.profile.id]);
    await expect(fixture.auth.login({ email: 'ada@example.test', password: 'secure-password' })).rejects.toBeInstanceOf(InvalidCredentialsError);
    await expect(fixture.auth.login({ email: 'ada@example.test', password: 'new-secure-password' })).resolves.toMatchObject({ profile: { id: registered.profile.id } });
  });

  it('upgrades a guest in place without replacing its identity', async () => {
    const fixture = createFixture();
    const guest = await fixture.auth.createGuest('Table guest', '🎲');
    const upgraded = await fixture.auth.upgradeGuest(guest.profile.id, 'guest@example.test', 'secure-password');

    expect(upgraded.profile).toMatchObject({ id: guest.profile.id, accountType: 'REGISTERED', email: 'guest@example.test', emailVerified: false });
    expect(fixture.users.byId.get(guest.profile.id)?.accountType).toBe('REGISTERED');
  });

  it('keeps registration and guest upgrade available when email delivery is unavailable', async () => {
    const fixture = createFixture();
    fixture.email.fail = true;

    await expect(fixture.auth.register({ nickname: 'Ada', avatar: 'рџЋ©', password: 'secure-password' })).resolves.toMatchObject({ profile: { accountType: 'REGISTERED' } });
    const guest = await fixture.auth.createGuest('Guest', 'рџЋІ');
    await expect(fixture.auth.upgradeGuest(guest.profile.id, 'guest@example.test', 'secure-password')).resolves.toMatchObject({ profile: { accountType: 'REGISTERED' } });
  });

  it('replaces an active verification token when the user explicitly resends', async () => {
    const fixture = createFixture();
    const guest = await fixture.auth.createGuest('Ada', '🎩');
    const registered = await fixture.auth.upgradeGuest(guest.profile.id, 'ada@example.test', 'secure-password');

    await fixture.auth.resendVerification(registered.profile.id);

    expect(fixture.email.messages).toHaveLength(2);
    expect(fixture.tokens.issued).toHaveLength(2);
    expect(fixture.email.messages[1].text).not.toBe(fixture.email.messages[0].text);
  });

  it('reports resend delivery failures and permits another retry', async () => {
    const fixture = createFixture();
    const guest = await fixture.auth.createGuest('Ada', '🎩');
    const registered = await fixture.auth.upgradeGuest(guest.profile.id, 'ada@example.test', 'secure-password');
    fixture.email.fail = true;

    await expect(fixture.auth.resendVerification(registered.profile.id)).rejects.toBeInstanceOf(EmailDeliveryError);
    fixture.email.fail = false;
    await expect(fixture.auth.resendVerification(registered.profile.id)).resolves.toBeUndefined();
    expect(fixture.email.messages).toHaveLength(2);
  });
});

function createFixture() {
  const users = new MemoryUsers(); const sessions = new MemorySessions(); const tokens = new MemoryTokens(); const email = new MemoryEmail(); let sequence = 0;
  return { users, sessions, tokens, email, auth: new AuthService(users, sessions, tokens, email, () => `id-${++sequence}`, 'https://bank.example.test') };
}

class MemoryUsers implements UserRepository {
  readonly byId = new Map<string, UserRecord>(); readonly byEmail = new Map<string, UserRecord>(); readonly byNickname = new Map<string, UserRecord>();
  async create(input: CreateUserInput): Promise<UserRecord> { const user: UserRecord = { ...input, gamesPlayed: 0, gamesWon: 0, gamesLost: 0, createdAt: '', updatedAt: '' }; this.save(user); return user; }
  async findByNickname(nickname: string): Promise<UserRecord | null> { return this.byNickname.get(nickname) ?? null; }
  async findByNormalizedEmail(email: string): Promise<UserRecord | null> { return this.byEmail.get(email) ?? null; }
  async findById(id: string): Promise<UserRecord | null> { return this.byId.get(id) ?? null; }
  async updateProfile(id: string, nickname: string, avatar: string): Promise<UserRecord | null> { const user = this.byId.get(id); if (user === undefined) return null; this.byNickname.delete(user.nickname); const updated = { ...user, nickname, avatar }; this.save(updated); return updated; }
  async markEmailVerified(id: string): Promise<UserRecord | null> { const user = this.byId.get(id); if (user === undefined) return null; const updated = { ...user, emailVerifiedAt: '2026-01-01T00:00:00Z' }; this.save(updated); return updated; }
  async changePassword(id: string, passwordHash: string, passwordSalt: string): Promise<UserRecord | null> { const user = this.byId.get(id); if (user === undefined) return null; const updated = { ...user, passwordHash, passwordSalt }; this.save(updated); return updated; }
  async upgradeGuest(input: { id: string; email: string; normalizedEmail: string; passwordHash: string; passwordSalt: string }): Promise<UserRecord | null> { const user = this.byId.get(input.id); if (user === undefined || user.accountType !== 'GUEST' || this.byEmail.has(input.normalizedEmail)) return null; const updated = { ...user, accountType: 'REGISTERED' as const, email: input.email, normalizedEmail: input.normalizedEmail, emailVerifiedAt: null, passwordHash: input.passwordHash, passwordSalt: input.passwordSalt }; this.save(updated); return updated; }
  private save(user: UserRecord): void { this.byId.set(user.id, user); this.byNickname.set(user.nickname, user); if (user.normalizedEmail !== null) this.byEmail.set(user.normalizedEmail, user); }
}

class MemorySessions implements SessionRepository { readonly revokedUserIds: string[] = []; async create(): Promise<void> {} async findUserId(): Promise<string | null> { return null; } async delete(): Promise<void> {} async deleteAllForUser(userId: string): Promise<void> { this.revokedUserIds.push(userId); } async deleteExpired(): Promise<void> {} }
class MemoryTokens implements AuthTokenRepository { readonly issued: Array<{ userId: string; purpose: AuthTokenPurpose; tokenHash: string }> = []; readonly active = new Map<string, string>(); nextConsumedUserId: string | null = null; async issue(input: { id: string; userId: string; purpose: AuthTokenPurpose; tokenHash: string; replaceActive?: boolean }): Promise<boolean> { const key = `${input.userId}:${input.purpose}`; if (this.active.has(key) && input.replaceActive !== true) return false; this.active.set(key, input.tokenHash); this.issued.push(input); return true; } async consume(_tokenHash: string, purpose: AuthTokenPurpose): Promise<string | null> { const userId = this.nextConsumedUserId; if (userId !== null) this.active.delete(`${userId}:${purpose}`); this.nextConsumedUserId = null; return userId; } async discard(tokenHash: string): Promise<void> { for (const [key, activeHash] of this.active) if (activeHash === tokenHash) this.active.delete(key); } async deleteExpired(): Promise<void> {} }
class MemoryEmail implements TransactionalEmailProvider { readonly messages: TransactionalEmail[] = []; fail = false; async send(message: TransactionalEmail): Promise<void> { if (this.fail) throw new Error('provider unavailable'); this.messages.push(message); } }
