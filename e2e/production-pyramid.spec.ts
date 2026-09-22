import { expect, test, type Browser, type BrowserContext, type Page } from '@playwright/test';

import { EMAIL_FEATURES_ENABLED } from '../src/utils/email-features';

const baseURL = process.env.E2E_BASE_URL;
const runE2E = baseURL !== undefined && process.env.E2E_RUN === 'true';

test.describe('production browser pyramid', () => {
  test.skip(!runE2E, 'Set E2E_BASE_URL and E2E_RUN=true against an isolated staging environment.');

  test('six independent devices join by QR invitation and converge after reconnect', async ({ browser }) => {
    const owner = await register(browser, 'Owner');
    const gameId = await createLobby(owner.page, 'FAST', 0);
    const invitation = await createInvitation(owner.page);
    const guests = await Promise.all(Array.from({ length: 5 }, (_, index) => joinAsGuest(browser, invitation, `Guest ${index + 1}`)));

    await expect(owner.page.getByText(/Guest 5/)).toBeVisible();
    if (EMAIL_FEATURES_ENABLED) await upgradeGuest(guests[0].page);
    await owner.page.reload();
    await expect(owner.page.getByRole('heading', { name: /load test/i })).toBeVisible();
    await Promise.all(guests.map(({ context }) => context.close()));
    await owner.context.close();
    expect(gameId).toMatch(/^[0-9a-f-]{36}$/i);
  });

  test('FAST and CONFIRMATION payments preserve one command result after retry, then finish with final statistics', async ({ browser }) => {
    const owner = await register(browser, 'Payment owner');
    const fastGameId = await createLobby(owner.page, 'FAST', 1);
    await startLobby(owner.page);
    await assertCommandIdempotency(owner.page, fastGameId);

    await owner.page.goto('/');
    const confirmationGameId = await createLobby(owner.page, 'CONFIRMATION', 1);
    const invitation = await createInvitation(owner.page);
    const guest = await joinAsGuest(browser, invitation, 'Approver');
    await startLobby(owner.page);
    await assertConfirmationPayment(owner.page, guest.page, confirmationGameId);
    await expect(owner.page.getByText(/live|наживо/i)).toBeVisible();
    await finishWithNoWinner(owner.page);
    await owner.page.getByRole('button', { name: /statistics|статистика/i }).click();
    await expect(owner.page.getByText(/cash leaderboard|рейтинг за готівкою/i)).toBeVisible();

    await guest.context.close();
    await owner.context.close();
    expect(confirmationGameId).toMatch(/^[0-9a-f-]{36}$/i);
  });

  test('local second wallet, guest upgrade and keyboard/focus semantics remain usable', async ({ browser }) => {
    const owner = await register(browser, 'Local owner');
    await createLobby(owner.page, 'FAST', 1);
    await expect(owner.page.getByText(/primary wallet|основний гаманець/i)).toBeVisible();
    await owner.page.keyboard.press('Tab');
    await expect(owner.page.locator(':focus')).toBeVisible();
    await owner.page.getByRole('button', { name: /settings|налаштування/i }).click();
    await owner.page.keyboard.press('Escape');
    await expect(owner.page.getByRole('button', { name: /settings|налаштування/i })).toBeFocused();
    await owner.context.close();
  });

  test('amount unit toggle drives the recorded transaction amount', async ({ browser }) => {
    const owner = await register(browser, 'Unit owner');
    const gameId = await createLobby(owner.page, 'FAST', 1);
    await startLobby(owner.page);
    const before = await readGameDetails(owner.page, gameId);
    const playerId = before.data.controlledPlayerIds[0];
    const balanceBefore = balanceOf(before, playerId);

    // Full unit names come from aria-label; the short K/M and Т./М. captions are ambiguous.
    const thousands = owner.page.getByRole('button', { name: /^thousands$|^тисячі$/i });
    const millions = owner.page.getByRole('button', { name: /^millions$|^мільйони$/i });
    const amountField = owner.page.getByRole('textbox', { name: /amount|сума/i });

    await openPayBank(owner.page);
    await expect(thousands).toHaveAttribute('aria-pressed', 'true');
    await expect(millions).toHaveAttribute('aria-pressed', 'false');

    await millions.click();
    await pressKeypadDigit(owner.page, '1');
    await expect(amountField).toHaveValue('1');
    await expect(owner.page.getByText(/^(amount|сума): \D*1 000\D*$/i)).toBeVisible();

    await thousands.click();
    await expect(amountField).toHaveValue('');
    await expect(owner.page.getByText(/enter a positive whole number|введіть додатне ціле число/i)).toBeVisible();

    await millions.click();
    await pressKeypadDigit(owner.page, '1');
    await owner.page.getByRole('button', { name: /review transaction|перевірити транзакцію/i }).click();
    await owner.page.getByRole('button', { name: /confirm transaction|підтвердити транзакцію/i }).click();
    await expect(owner.page.getByRole('dialog')).toBeHidden();
    // The canonical amount is thousands: one million entered must be recorded as 1000, not 1.
    await expect.poll(async () => balanceOf(await readGameDetails(owner.page, gameId), playerId)).toBe(balanceBefore - 1000);
    const history = await readPlayerTransactions(owner.page, gameId, playerId);
    expect(history.data[0]).toMatchObject({ type: 'PLAYER_TO_BANK', amount: 1000 });

    await owner.page.reload();
    await expect(owner.page.getByRole('heading', { name: /load test/i })).toBeVisible();
    await openPayBank(owner.page);
    await expect(millions).toHaveAttribute('aria-pressed', 'true');
    await expect(thousands).toHaveAttribute('aria-pressed', 'false');
    await owner.context.close();
  });
});

test.describe('visual and accessibility matrix', () => {
  test.skip(!runE2E, 'Set E2E_BASE_URL and E2E_RUN=true against an isolated staging environment.');
  for (const language of ['en', 'uk'] as const) {
    for (const width of [320, 390, 768, 1280]) {
      for (const colorScheme of ['light', 'dark'] as const) {
        for (const reducedMotion of ['reduce', 'no-preference'] as const) {
          test(`${language} ${width}px ${colorScheme} ${reducedMotion}`, async ({ browser }, testInfo) => {
          const context = await browser.newContext({ viewport: { width, height: 900 }, colorScheme, reducedMotion });
          await context.addInitScript((selectedLanguage) => window.localStorage.setItem('monopoly-bank-language', selectedLanguage), language);
          const page = await context.newPage();
          await page.goto('/');
          await expect(page.locator('html')).toHaveAttribute('lang', language);
          await expect(page.locator('body')).toEvaluate((body) => body.scrollWidth <= window.innerWidth);
          await testInfo.attach(`matrix-${language}-${width}-${colorScheme}-${reducedMotion}`, { body: await page.screenshot({ fullPage: true }), contentType: 'image/png' });
          await context.close();
        });
      }
    }
  }
  }
});

async function register(browser: Browser, nickname: string): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext();
  await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: baseURL ?? 'http://localhost' });
  const page = await context.newPage();
  await page.goto('/');
  await page.getByRole('button', { name: /create your account|створіть обліковий запис/i }).click();
  await page.getByLabel(/nickname|псевдонім/i).fill(`${nickname} ${Date.now()} ${Math.random().toString(36).slice(2, 7)}`);
  await page.getByLabel(/^password$|^пароль$/i).fill('SafeE2EPassword123!');
  await page.getByRole('button', { name: /create your account|створіть обліковий запис/i }).click();
  await expect(page.getByRole('heading', { name: /saved games|збережені ігри/i })).toBeVisible();
  return { context, page };
}

async function createLobby(page: Page, paymentMode: 'FAST' | 'CONFIRMATION', localPlayers: number): Promise<string> {
  await page.getByRole('button', { name: /create.*game|створити.*гру/i }).click();
  await page.getByLabel(/game name|назва гри/i).fill(`Load test ${paymentMode} ${Date.now()}`);
  await page.getByLabel(/payment mode|режим платежів/i).selectOption(paymentMode);
  for (let index = 0; index < localPlayers; index += 1) {
    await page.getByRole('button', { name: /add player|додати гравця/i }).click();
    await page.getByLabel(new RegExp(`player ${index + 2} name|ім.?я гравця ${index + 2}`, 'i')).fill(`Local ${index + 1}`);
  }
  await page.getByRole('button', { name: /create lobby|створити лобі/i }).click();
  // `/games/new` also contains `/games/`, so match the created game's UUID instead.
  await expect(page).toHaveURL(/\/games\/[0-9a-f-]{36}/i);
  return page.url().split('/games/')[1];
}

async function createInvitation(page: Page): Promise<string> {
  await page.getByRole('button', { name: /invite|запросити/i }).click();
  await page.getByRole('button', { name: /create invite link|створити.*запрошення/i }).click();
  await expect(page.locator('svg[role="img"]')).toBeVisible();
  await page.getByRole('button', { name: /copy invite link|копіювати посилання-запрошення/i }).click();
  const invitationUrl = await page.evaluate(() => navigator.clipboard.readText());
  await page.getByRole('button', { name: /close|закрити/i }).first().click();
  if (!invitationUrl.includes('#invite=')) throw new Error('The copied invitation is not a secure fragment URL.');
  return invitationUrl;
}

async function joinAsGuest(browser: Browser, invitationUrl: string, nickname: string): Promise<{ context: BrowserContext; page: Page }> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(invitationUrl);
  await page.getByLabel(/nickname|псевдонім/i).fill(nickname);
  await page.getByRole('button', { name: /join as guest|приєднатися як гість/i }).click();
  await expect(page).toHaveURL(/\/games\/[0-9a-f-]{36}$/i);
  await expect(page.getByRole('heading', { name: /load test/i })).toBeVisible();
  return { context, page };
}

async function startLobby(page: Page): Promise<void> { await page.getByRole('button', { name: /start game|почати гру/i }).click(); }
async function openPayBank(page: Page): Promise<void> { await page.getByRole('button', { name: /open banking actions|відкрити банківські дії/i }).click(); await page.getByRole('button', { name: /^pay bank$|^заплатити банку$/i }).click(); }
async function pressKeypadDigit(page: Page, digit: string): Promise<void> { await page.getByRole('group', { name: /numeric keypad|цифрова клавіатура/i }).getByRole('button', { name: digit, exact: true }).click(); }
async function readGameDetails(page: Page, gameId: string): Promise<GameDetailsResponse> { return await page.evaluate(async (id) => (await fetch(`/api/games/${id}`)).json(), gameId) as GameDetailsResponse; }
async function readPlayerTransactions(page: Page, gameId: string, playerId: string): Promise<{ data: Array<{ type: string; amount: number }> }> { return await page.evaluate(async ({ id, player }) => (await fetch(`/api/games/${id}/players/${player}/transactions`)).json(), { id: gameId, player: playerId }) as { data: Array<{ type: string; amount: number }> }; }
function balanceOf(details: GameDetailsResponse, playerId: string): number { const player = details.data.players.find((candidate) => candidate.id === playerId); if (player === undefined) throw new Error(`Player ${playerId} is missing from the game details.`); return player.balance; }
type GameDetailsResponse = { data: { controlledPlayerIds: string[]; players: Array<{ id: string; balance: number }> } };
async function finishWithNoWinner(page: Page): Promise<void> { await page.getByRole('button', { name: /finish game|завершити гру/i }).click(); await page.getByRole('button', { name: /no winner|без переможця/i }).click(); }
async function upgradeGuest(page: Page): Promise<void> {
  await page.getByRole('button', { name: /Guest 1/ }).click();
  await page.getByLabel(/email|електронна пошта/i).last().fill(`upgrade-${crypto.randomUUID()}@example.test`);
  await page.getByLabel(/^password$|^пароль$/i).last().fill('SafeE2EPassword123!');
  await page.getByRole('button', { name: /secure this guest account|захистити гостьовий обліковий запис/i }).click();
  await expect(page.getByText(/not verified|не підтверджено/i)).toBeVisible();
}

async function assertCommandIdempotency(page: Page, gameId: string): Promise<void> {
  const details = await page.evaluate(async (id) => {
    const response = await fetch(`/api/games/${id}`); return response.json();
  }, gameId) as { data: { controlledPlayerIds: string[] } };
  const commandId = crypto.randomUUID();
  const request = { type: 'PLAYER_TO_BANK', playerId: details.data.controlledPlayerIds[0], amount: 1 };
  const responses = await page.evaluate(async ({ id, request, commandId: idempotencyKey }) => Promise.all([0, 1].map(async () => {
    const response = await fetch(`/api/games/${id}/transactions`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-command-id': idempotencyKey }, body: JSON.stringify(request) });
    return response.json();
  })), { id: gameId, request, commandId });
  expect(responses[0]).toEqual(responses[1]);
}

async function assertConfirmationPayment(owner: Page, guest: Page, gameId: string): Promise<void> {
  const [ownerDetails, guestDetails] = await Promise.all([owner, guest].map((page) => page.evaluate(async (id) => (await fetch(`/api/games/${id}`)).json(), gameId))) as Array<{ data: { controlledPlayerIds: string[] } }>;
  const request = await owner.evaluate(async ({ id, sourcePlayerId, destinationPlayerId }) => {
    const response = await fetch(`/api/games/${id}/transactions`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-command-id': crypto.randomUUID() }, body: JSON.stringify({ type: 'PLAYER_TO_PLAYER', sourcePlayerId, destinationPlayerId, amount: 1 }) });
    return response.json();
  }, { id: gameId, sourcePlayerId: ownerDetails.data.controlledPlayerIds[0], destinationPlayerId: guestDetails.data.controlledPlayerIds[0] }) as { data: { paymentRequests: Array<{ id: string }> } };
  const paymentRequestId = request.data.paymentRequests[0]?.id;
  if (paymentRequestId === undefined) throw new Error('CONFIRMATION payment did not create a payment request.');
  const accepted = await guest.evaluate(async ({ id, paymentRequestId: requestId }) => {
    const response = await fetch(`/api/games/${id}/payment-requests/${requestId}/accept`, { method: 'POST', headers: { 'x-command-id': crypto.randomUUID() } });
    return response.json();
  }, { id: gameId, paymentRequestId }) as { data: { transaction?: { id: string } } };
  expect(accepted.data.transaction?.id).toBeDefined();
}
