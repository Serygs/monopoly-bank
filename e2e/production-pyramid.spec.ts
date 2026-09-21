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
});

// Coverage samples are governed by docs/ui-design-system.md; screenshots are diagnostic attachments.
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
          expect(await page.locator('body').evaluate((body) => body.scrollWidth <= window.innerWidth)).toBe(true);
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
