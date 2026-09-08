import type { AccountExport, LoginRequest, RegisterRequest, UserProfile } from '../../shared/contracts/api.js';
import type { PrivacyRepository } from '../repositories/privacy-repository.js';
import type { AuthTokenPurpose, AuthTokenRepository } from '../repositories/auth-token-repository.js';
import type { SessionRepository } from '../repositories/session-repository.js';
import type { UserRecord, UserRepository } from '../repositories/user-repository.js';
import { hashPassword, randomToken, tokenHash, verifyPassword } from './password-security.js';
import type { TransactionalEmailProvider } from './transactional-email.js';
import { AuthenticationRequiredError, ConflictError, EmailDeliveryError, InvalidCredentialsError, ResourceNotFoundError, ValidationError } from './errors.js';

export type PublicProfile = UserProfile;
export class AuthenticationError extends AuthenticationRequiredError {}

export class AuthService {
  private readonly users: UserRepository;
  private readonly sessions: SessionRepository;
  private readonly tokens: AuthTokenRepository;
  private readonly email: TransactionalEmailProvider;
  private readonly createId: () => string;
  private readonly appOrigin: string;
  private readonly privacy?: PrivacyRepository;
  constructor(
    users: UserRepository, sessions: SessionRepository, tokens: AuthTokenRepository, email: TransactionalEmailProvider, createId: () => string, appOrigin: string, privacy?: PrivacyRepository,
  ) { this.users = users; this.sessions = sessions; this.tokens = tokens; this.email = email; this.createId = createId; this.appOrigin = appOrigin; this.privacy = privacy; }

  async register(input: RegisterRequest): Promise<{ profile: PublicProfile; cookie: string }> {
    if (await this.users.findByNickname(input.nickname) !== null) throw new ConflictError('ACCOUNT_IDENTIFIER_UNAVAILABLE', 'The account identifier is unavailable.');
    const credentials = await hashPassword(input.password);
    const user = await this.users.create({ id: this.createId(), nickname: input.nickname, avatar: input.avatar, accountType: 'REGISTERED', email: null, normalizedEmail: null, emailVerifiedAt: null, passwordHash: credentials.hash, passwordSalt: credentials.salt });
    return { profile: profile(user), cookie: await this.createSession(user.id) };
  }

  async createGuest(nickname: string, avatar: string): Promise<{ profile: PublicProfile; cookie: string }> {
    const credentials = await hashPassword(randomToken());
    const user = await this.users.create({ id: this.createId(), nickname, avatar, accountType: 'GUEST', email: null, normalizedEmail: null, emailVerifiedAt: null, passwordHash: credentials.hash, passwordSalt: credentials.salt });
    return { profile: profile(user), cookie: await this.createSession(user.id) };
  }

  async login(input: LoginRequest): Promise<{ profile: PublicProfile; cookie: string }> {
    const user = 'email' in input ? await this.users.findByNormalizedEmail(normalizeEmail(input.email)) : await this.users.findByNickname(input.nickname);
    if (user === null || user.accountType !== 'REGISTERED' || !(await verifyPassword(input.password, { hash: user.passwordHash, salt: user.passwordSalt }))) throw new InvalidCredentialsError();
    await this.sessions.deleteAllForUser(user.id);
    return { profile: profile(user), cookie: await this.createSession(user.id) };
  }

  async current(request: Request): Promise<PublicProfile> {
    const token = cookieValue(request.headers.get('cookie'), 'monopoly_bank_session');
    if (token === null) throw new AuthenticationRequiredError();
    const userId = await this.sessions.findUserId(await tokenHash(token));
    if (userId === null) throw new AuthenticationRequiredError();
    const user = await this.users.findById(userId);
    if (user === null) throw new AuthenticationRequiredError();
    return profile(user);
  }

  async update(userId: string, nickname: string, avatar: string): Promise<PublicProfile> { const updated = await this.users.updateProfile(userId, nickname, avatar); if (updated === null) throw new ResourceNotFoundError('User'); return profile(updated); }
  async verifyEmail(token: string): Promise<PublicProfile> { const userId = await this.tokens.consume(await tokenHash(token), 'VERIFY_EMAIL'); if (userId === null) throw new ValidationError('This verification link is invalid or has expired.'); const user = await this.users.markEmailVerified(userId); if (user === null) throw new ResourceNotFoundError('User'); return profile(user); }
  async requestPasswordReset(email: string): Promise<void> { const user = await this.users.findByNormalizedEmail(normalizeEmail(email)); if (user?.accountType === 'REGISTERED' && user.email !== null) await this.issueEmailTokenBestEffort(user, 'RESET_PASSWORD'); }
  async resetPassword(token: string, password: string): Promise<void> { const userId = await this.tokens.consume(await tokenHash(token), 'RESET_PASSWORD'); if (userId === null) throw new ValidationError('This password reset link is invalid or has expired.'); const credentials = await hashPassword(password); const user = await this.users.changePassword(userId, credentials.hash, credentials.salt); if (user === null || user.accountType !== 'REGISTERED') throw new ResourceNotFoundError('User'); await this.sessions.deleteAllForUser(user.id); }
  async resendVerification(userId: string): Promise<void> { const user = await this.users.findById(userId); if (user === null) throw new ResourceNotFoundError('User'); if (user.accountType !== 'REGISTERED' || user.email === null || user.emailVerifiedAt !== null) return; await this.issueEmailToken(user, 'VERIFY_EMAIL', true); }
  async upgradeGuest(userId: string, email: string, password: string): Promise<{ profile: PublicProfile; cookie: string }> {
    const credentials = await hashPassword(password); const normalizedEmail = normalizeEmail(email);
    const user = await this.users.upgradeGuest({ id: userId, email, normalizedEmail, passwordHash: credentials.hash, passwordSalt: credentials.salt });
    if (user === null) throw new ConflictError('GUEST_UPGRADE_UNAVAILABLE', 'This guest account can no longer be upgraded.');
    await this.issueEmailTokenBestEffort(user, 'VERIFY_EMAIL');
    await this.sessions.deleteAllForUser(user.id);
    return { profile: profile(user), cookie: await this.createSession(user.id) };
  }
  async addEmailToLegacyAccount(userId: string, email: string): Promise<PublicProfile> {
    const user = await this.users.addEmailToLegacyAccount(userId, email, normalizeEmail(email));
    if (user === null) throw new ConflictError('EMAIL_MIGRATION_UNAVAILABLE', 'An email cannot be added to this account.');
    await this.issueEmailTokenBestEffort(user, 'VERIFY_EMAIL');
    return profile(user);
  }
  async logout(request: Request): Promise<string> { const token = cookieValue(request.headers.get('cookie'), 'monopoly_bank_session'); if (token !== null) await this.sessions.delete(await tokenHash(token)); return expiredCookie(); }
  async revokeAll(userId: string): Promise<string> { await this.sessions.deleteAllForUser(userId); return expiredCookie(); }
  async cleanupExpired(): Promise<void> { await Promise.all([this.sessions.deleteExpired(), this.tokens.deleteExpired()]); }
  async exportAccount(userId: string): Promise<AccountExport> { if (this.privacy === undefined) throw new ResourceNotFoundError('Account export'); return this.privacy.exportAccount(userId); }
  async deleteAccount(userId: string): Promise<string> {
    if (this.privacy === undefined) throw new ResourceNotFoundError('Account deletion');
    if (await this.privacy.hasActiveMembership(userId)) throw new ConflictError('ACCOUNT_DELETE_ACTIVE_GAME', 'Finish or leave active games before deleting this account.');
    const credentials = await hashPassword(randomToken());
    if (!(await this.privacy.anonymizeAccount(userId, `deleted-${userId}`, credentials.hash, credentials.salt))) throw new ResourceNotFoundError('Account');
    return expiredCookie();
  }

  private async issueEmailToken(user: UserRecord, purpose: AuthTokenPurpose, replaceActive = false): Promise<void> {
    if (user.email === null) return;
    const token = randomToken(); const hash = await tokenHash(token);
    const issued = await this.tokens.issue({ id: this.createId(), userId: user.id, purpose, tokenHash: hash, expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(), replaceActive });
    if (!issued) return;
    const verify = purpose === 'VERIFY_EMAIL';
    const url = new URL(verify ? '/verify-email' : '/reset-password', this.appOrigin);
    // Fragments are never sent in HTTP requests or Referer headers.
    url.hash = new URLSearchParams({ token }).toString();
    const subject = verify ? 'Verify your Monopoly Bank email' : 'Reset your Monopoly Bank password';
    const text = `${verify ? 'Verify your email' : 'Reset your password'}: ${url}`;
    try {
      await this.email.send({ to: user.email, subject, text, html: `<p><a href="${escapeHtml(url.toString())}">${escapeHtml(verify ? 'Verify your email' : 'Reset your password')}</a></p>`, idempotencyKey: `${purpose}:${hash}` });
    } catch (cause) {
      await this.tokens.discard(hash);
      throw new EmailDeliveryError(cause);
    }
  }
  private async issueEmailTokenBestEffort(user: UserRecord, purpose: AuthTokenPurpose): Promise<void> {
    try { await this.issueEmailToken(user, purpose); } catch { /* A provider outage must not invalidate an existing session or guest flow. */ }
  }
  private async createSession(userId: string): Promise<string> { const token = randomToken(); await this.sessions.create(this.createId(), userId, await tokenHash(token), new Date(Date.now() + 1000 * 60 * 60 * 24 * 14).toISOString()); return sessionCookie(token); }
}

export function normalizeEmail(email: string): string { return email.trim().toLowerCase(); }
function profile(user: UserRecord): PublicProfile { return { id: user.id, nickname: user.nickname, avatar: user.avatar, accountType: user.accountType, email: user.email, emailVerified: user.emailVerifiedAt !== null, gamesPlayed: user.gamesPlayed, gamesWon: user.gamesWon, gamesLost: user.gamesLost, winRate: user.gamesPlayed === 0 ? 0 : user.gamesWon / user.gamesPlayed, createdAt: user.createdAt, updatedAt: user.updatedAt }; }
function cookieValue(value: string | null, name: string): string | null { return value?.split(';').map((item) => item.trim()).find((item) => item.startsWith(`${name}=`))?.slice(name.length + 1) ?? null; }
function sessionCookie(token: string): string { return `monopoly_bank_session=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=1209600`; }
function expiredCookie(): string { return 'monopoly_bank_session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0'; }
function escapeHtml(value: string): string { return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;'); }
