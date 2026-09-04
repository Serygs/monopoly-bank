import type { UserRecord, UserRepository } from '../repositories/user-repository.js';
import type { SessionRepository } from '../repositories/session-repository.js';
import { hashPassword, randomToken, tokenHash, verifyPassword } from './password-security.js';
import { ResourceNotFoundError } from './errors.js';

export type PublicProfile = Pick<UserRecord, 'id' | 'nickname' | 'avatar' | 'gamesPlayed' | 'gamesWon' | 'createdAt' | 'updatedAt'> & { winRate: number };
export class AuthenticationError extends Error {}
export class AuthService {
  private readonly users: UserRepository; private readonly sessions: SessionRepository; private readonly createId: () => string;
  constructor(users: UserRepository, sessions: SessionRepository, createId: () => string) { this.users = users; this.sessions = sessions; this.createId = createId; }
  async register(nickname: string, avatar: string, password: string): Promise<{ profile: PublicProfile; cookie: string }> { if (await this.users.findByNickname(nickname) !== null) throw new AuthenticationError('Nickname is already in use.'); const credentials = await hashPassword(password); const user = await this.users.create({ id: this.createId(), nickname, avatar, passwordHash: credentials.hash, passwordSalt: credentials.salt }); return { profile: profile(user), cookie: await this.createSession(user.id) }; }
  async login(nickname: string, password: string): Promise<{ profile: PublicProfile; cookie: string }> { const user = await this.users.findByNickname(nickname); if (user === null || !(await verifyPassword(password, { hash: user.passwordHash, salt: user.passwordSalt }))) throw new AuthenticationError('Invalid nickname or password.'); return { profile: profile(user), cookie: await this.createSession(user.id) }; }
  async current(request: Request): Promise<PublicProfile> { const token = cookieValue(request.headers.get('cookie'), 'monopoly_bank_session'); if (token === null) throw new AuthenticationError('Authentication is required.'); const userId = await this.sessions.findUserId(await tokenHash(token)); if (userId === null) throw new AuthenticationError('Authentication is required.'); const user = await this.users.findById(userId); if (user === null) throw new AuthenticationError('Authentication is required.'); return profile(user); }
  async update(userId: string, nickname: string, avatar: string): Promise<PublicProfile> { const updated = await this.users.updateProfile(userId, nickname, avatar); if (updated === null) throw new ResourceNotFoundError('User'); return profile(updated); }
  async logout(request: Request): Promise<string> { const token = cookieValue(request.headers.get('cookie'), 'monopoly_bank_session'); if (token !== null) await this.sessions.delete(await tokenHash(token)); return expiredCookie(); }
  private async createSession(userId: string): Promise<string> { const token = randomToken(); await this.sessions.create(this.createId(), userId, await tokenHash(token), new Date(Date.now() + 1000 * 60 * 60 * 24 * 14).toISOString()); return sessionCookie(token); }
}
function profile(user: UserRecord): PublicProfile { return { id: user.id, nickname: user.nickname, avatar: user.avatar, gamesPlayed: user.gamesPlayed, gamesWon: user.gamesWon, winRate: user.gamesPlayed === 0 ? 0 : user.gamesWon / user.gamesPlayed, createdAt: user.createdAt, updatedAt: user.updatedAt }; }
function cookieValue(value: string | null, name: string): string | null { return value?.split(';').map((item) => item.trim()).find((item) => item.startsWith(`${name}=`))?.slice(name.length + 1) ?? null; }
function sessionCookie(token: string): string { return `monopoly_bank_session=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=1209600`; }
function expiredCookie(): string { return 'monopoly_bank_session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0'; }
