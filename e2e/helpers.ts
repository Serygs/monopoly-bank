import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';

const baseURL = process.env.E2E_BASE_URL;

export interface Session { context: BrowserContext; page: Page; }

export interface LobbyOptions {
  /** Defaults to `Load test <mode> <timestamp>`; the board-less screenshot scenario needs a stable name. */
  name?: string;
  /** The label of a board radio to choose on the create page, for example `/^classic/i`; omitted keeps “No board”. */
  board?: RegExp;
}

/** Registers a nickname/password account in a new browser context and lands on Saved games. */
export async function register(browser: Browser, nickname: string, contextOptions: Parameters<Browser['newContext']>[0] = {}): Promise<Session> {
  const context = await browser.newContext(contextOptions);
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: baseURL ?? 'http://localhost' });
  const page = await context.newPage();
  await page.goto('/');
  await page.getByRole('button', { name: /create your account|створіть обліковий запис/i }).click();
  await page.getByLabel(/nickname|псевдонім/i).fill(`${nickname} ${Date.now()} ${Math.random().toString(36).slice(2, 7)}`);
  await page.getByLabel(/^password$|^пароль$/i).fill('SafeE2EPassword123!');
  await page.getByRole('button', { name: /create your account|створіть обліковий запис/i }).click();
  // An empty account also renders the “No saved games yet” heading, so the page title is matched exactly.
  await expect(page.getByRole('heading', { name: /^saved games$|^збережені ігри$/i })).toBeVisible();
  return { context, page };
}

/** Creates a lobby from Saved games and returns the new game's id. */
export async function createLobby(page: Page, paymentMode: 'FAST' | 'CONFIRMATION', localPlayers: number, options: LobbyOptions = {}): Promise<string> {
  // An empty account shows the create button twice (header and empty state); either opens the same page.
  await page.getByRole('button', { name: /create.*game|створити.*гру/i }).first().click();
  await page.getByLabel(/game name|назва гри/i).fill(options.name ?? `Load test ${paymentMode} ${Date.now()}`);
  await page.getByLabel(/payment mode|режим платежів/i).selectOption(paymentMode);
  if (options.board !== undefined) await page.getByRole('radio', { name: options.board }).click();
  for (let index = 0; index < localPlayers; index += 1) {
    await page.getByRole('button', { name: /add player|додати гравця/i }).click();
    await page.getByLabel(new RegExp(`player ${index + 2} name|ім.?я гравця ${index + 2}`, 'i')).fill(`Local ${index + 1}`);
  }
  await page.getByRole('button', { name: /create lobby|створити лобі/i }).click();
  // `/games/new` also contains `/games/`, so match the created game's UUID instead.
  await expect(page).toHaveURL(/\/games\/[0-9a-f-]{36}/i);
  return page.url().split('/games/')[1];
}

/** Creates an invitation through the lobby dialog and returns the copied fragment URL (requires HTTPS for the clipboard). */
export async function createInvitation(page: Page): Promise<string> {
  await page.getByRole('button', { name: /invite|запросити/i }).click();
  await page.getByRole('button', { name: /create invite link|створити.*запрошення/i }).click();
  await expect(page.locator('svg[role="img"]')).toBeVisible();
  await page.getByRole('button', { name: /copy invite link|копіювати посилання-запрошення/i }).click();
  const invitationUrl = await page.evaluate(() => navigator.clipboard.readText());
  await page.getByRole('button', { name: /close|закрити/i }).first().click();
  if (!invitationUrl.includes('#invite=')) throw new Error('The copied invitation is not a secure fragment URL.');
  return invitationUrl;
}

/** Opens the invitation in a fresh context and joins as a guest with `nickname`. */
export async function joinAsGuest(browser: Browser, invitationUrl: string, nickname: string, contextOptions: Parameters<Browser['newContext']>[0] = {}): Promise<Session> {
  const context = await browser.newContext(contextOptions);
  const page = await context.newPage();
  await page.goto(invitationUrl);
  await page.getByLabel(/nickname|псевдонім/i).fill(nickname);
  await page.getByRole('button', { name: /join as guest|приєднатися як гість/i }).click();
  await expect(page).toHaveURL(/\/games\/[0-9a-f-]{36}$/i);
  await expect(page.getByRole('heading', { name: /load test/i })).toBeVisible();
  return { context, page };
}

export async function startLobby(page: Page): Promise<void> { await page.getByRole('button', { name: /start game|почати гру/i }).click(); }

export type GameDetailsResponse = { data: { controlledPlayerIds: string[]; players: Array<{ id: string; name: string; balance: number; isInJail?: boolean; lastRollTotal?: number | null }>; properties?: Array<{ boardSpaceId: string; ownerPlayerId: string | null; houses: number; mortgaged: boolean }> } };
export type PlayerTransactionsResponse = { data: Array<{ type: string; amount: number; totalAmount: number }> };

export async function readGameDetails(page: Page, gameId: string): Promise<GameDetailsResponse> { return await page.evaluate(async (id) => (await fetch(`/api/games/${id}`)).json(), gameId) as GameDetailsResponse; }
export async function readPlayerTransactions(page: Page, gameId: string, playerId: string): Promise<PlayerTransactionsResponse> { return await page.evaluate(async ({ id, player }) => (await fetch(`/api/games/${id}/players/${player}/transactions`)).json(), { id: gameId, player: playerId }) as PlayerTransactionsResponse; }
export function balanceOf(details: GameDetailsResponse, playerId: string): number { const player = details.data.players.find((candidate) => candidate.id === playerId); if (player === undefined) throw new Error(`Player ${playerId} is missing from the game details.`); return player.balance; }
