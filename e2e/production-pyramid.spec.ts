import { expect, test, type Browser, type BrowserContext, type Page, type TestInfo } from '@playwright/test';

import type { ActivityPage, GameDetails, GameSummary, LedgerStatistics, UserProfile } from '../shared/contracts/api';
import type { Game, Player, Transaction } from '../shared/types/monopoly';
import { translate, type Language } from '../src/i18n/translations';
import { EMAIL_FEATURES_ENABLED } from '../src/utils/email-features';
import type { VisualStyleId } from '../src/appearance/visual-styles';

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

// Coverage is governed by docs/ui-design-system.md; screenshots remain diagnostic attachments rather than baselines.
test.describe('visual and accessibility matrix', () => {
  test.skip(!runE2E, 'Set E2E_BASE_URL and E2E_RUN=true against an isolated staging environment.');

  const responsiveCases = [
    { width: 320, language: 'en', colorScheme: 'light', reducedMotion: 'no-preference' },
    { width: 390, language: 'uk', colorScheme: 'dark', reducedMotion: 'reduce' },
    { width: 430, language: 'en', colorScheme: 'dark', reducedMotion: 'no-preference' },
    { width: 768, language: 'uk', colorScheme: 'light', reducedMotion: 'reduce' },
    { width: 1024, language: 'en', colorScheme: 'dark', reducedMotion: 'reduce' },
    { width: 1280, language: 'uk', colorScheme: 'light', reducedMotion: 'no-preference' },
    { width: 1440, language: 'en', colorScheme: 'light', reducedMotion: 'no-preference' },
  ] as const;

  for (const visualCase of responsiveCases) {
    test(`major routes at ${visualCase.width}px ${visualCase.language} ${visualCase.colorScheme}`, async ({ browser }, testInfo) => {
      const context = await createVisualContext(browser, visualCase);
      const page = await context.newPage();
      await mockVisualApi(page);
      await exerciseMajorViews(page, visualCase.language, `${visualCase.width}-${visualCase.language}-${visualCase.colorScheme}`, testInfo);
      await context.close();
    });
  }

  for (const language of ['en', 'uk'] as const) {
    for (const colorScheme of ['light', 'dark'] as const) {
      for (const reducedMotion of ['reduce', 'no-preference'] as const) {
        for (const visualStyle of ['classic-bank', 'liquid-glass'] as const) {
        test(`${visualStyle} ${language} ${colorScheme} ${reducedMotion}`, async ({ browser }, testInfo) => {
          const context = await createVisualContext(browser, { width: 390, language, colorScheme, reducedMotion, visualStyle });
          const page = await context.newPage();
          await mockVisualApi(page);
          await page.goto('/');
          await assertSearchFieldGeometry(page);
          await openGame(page, language);
          await assertViewportHealth(page);
          await expect(page.locator('html')).toHaveAttribute('data-visual-style', visualStyle);
          await expect(page.locator('html')).toHaveAttribute('data-color-mode', colorScheme);
          if (reducedMotion === 'reduce') {
            const motion = await page.locator('.wallet-card').first().evaluate((element) => {
              const style = getComputedStyle(element);
              return { animation: style.animationName, transition: style.transitionDuration };
            });
            expect(motion).toEqual({ animation: 'none', transition: '0s' });
          }
          await openActivity(page, language);
          await attachPage(page, testInfo, `${visualStyle}-${language}-${colorScheme}-${reducedMotion}-activity`);
          await page.keyboard.press('Escape');
          await openStatistics(page, language);
          await attachPage(page, testInfo, `${visualStyle}-${language}-${colorScheme}-${reducedMotion}-statistics`);
          await page.keyboard.press('Escape');
          await openSettings(page, language);
          await attachPage(page, testInfo, `${visualStyle}-${language}-${colorScheme}-${reducedMotion}-settings`);
          await context.close();
        });
        }
      }
    }
  }

  for (const visualStyle of ['classic-bank', 'liquid-glass'] as const) {
    for (const colorScheme of ['light', 'dark'] as const) {
      test(`${visualStyle} desktop ${colorScheme}`, async ({ browser }, testInfo) => {
        const context = await createVisualContext(browser, { width: 1280, language: 'en', colorScheme, reducedMotion: 'no-preference', visualStyle });
        const page = await context.newPage();
        await mockVisualApi(page);
        await exerciseMajorViews(page, 'en', `${visualStyle}-1280-en-${colorScheme}`, testInfo);
        await context.close();
      });
    }
  }

  const liquidGlassQaCases = [
    { width: 320, language: 'en', colorScheme: 'light' },
    { width: 390, language: 'uk', colorScheme: 'dark' },
    { width: 430, language: 'uk', colorScheme: 'light' },
    { width: 768, language: 'en', colorScheme: 'dark' },
    { width: 1024, language: 'uk', colorScheme: 'light' },
    { width: 1280, language: 'en', colorScheme: 'dark' },
    { width: 1440, language: 'uk', colorScheme: 'light' },
    { width: 1920, language: 'en', colorScheme: 'dark' },
  ] as const;

  for (const visualCase of liquidGlassQaCases) {
    test(`liquid-glass functional surfaces at ${visualCase.width}px ${visualCase.colorScheme}`, async ({ browser }) => {
      const context = await createVisualContext(browser, { ...visualCase, reducedMotion: 'no-preference', visualStyle: 'liquid-glass' });
      const page = await context.newPage();
      await mockVisualApi(page);
      await exerciseLiquidGlassSurfaces(page, visualCase.language, visualCase.colorScheme);
      await context.close();
    });
  }

  for (const width of [390, 1280] as const) {
    test(`liquid-glass saved-game menu exposes duplicate and delete at ${width}px`, async ({ browser }) => {
      const context = await createVisualContext(browser, { width, language: 'en', colorScheme: 'light', reducedMotion: 'no-preference', visualStyle: 'liquid-glass' });
      const page = await context.newPage();
      await mockVisualApi(page);
      await page.goto('/');
      await page.getByRole('button', { name: translate('en', 'gameActions', { name: visualGame.name }), exact: true }).click();
      await expect(page.getByRole('menuitem', { name: translate('en', 'duplicate'), exact: true })).toBeVisible();
      await expect(page.getByRole('menuitem', { name: translate('en', 'removeGame'), exact: true })).toBeVisible();
      await context.close();
    });
  }

  for (const visualCase of [
    { width: 430, colorScheme: 'light' },
    { width: 1280, colorScheme: 'dark' },
  ] as const) {
    test(`liquid-glass incoming payments at ${visualCase.width}px ${visualCase.colorScheme}`, async ({ browser }) => {
      const context = await createVisualContext(browser, { ...visualCase, language: 'en', reducedMotion: 'no-preference', visualStyle: 'liquid-glass' });
      const page = await context.newPage();
      await mockVisualApi(page);
      await mockActivePaymentInbox(page);
      await openGame(page, 'en');
      await expect(page.getByRole('heading', { name: translate('en', 'paymentInbox'), exact: true })).toBeVisible();
      await assertViewportHealth(page);
      await assertNoHorizontalOverflow(page, '.payment-inbox');
      await assertNoHorizontalOverflow(page, '.payment-inbox li');
      await context.close();
    });
  }

  for (const width of [320, 390, 768, 1280, 1440] as const) {
    test(`liquid-glass settings remain contained after switching to Ukrainian at ${width}px`, async ({ browser }, testInfo) => {
      const context = await createVisualContext(browser, { width, language: 'en', colorScheme: 'light', reducedMotion: 'no-preference', visualStyle: 'liquid-glass' });
      const page = await context.newPage();
      await mockVisualApi(page);
      await openGame(page, 'en');
      await openSettings(page, 'en');
      await page.getByRole('button', { name: translate('en', 'ukrainian'), exact: true }).click();
      const panel = page.getByRole('dialog');
      await expect(panel.getByRole('heading', { name: translate('uk', 'settings'), exact: true })).toBeVisible();
      await expect(page.locator('html')).toHaveAttribute('lang', 'uk');
      await assertNoHorizontalOverflow(page, '.settings-panel');
      await assertNoHorizontalOverflow(page, '.settings-panel h2');
      await assertDescendantsContained(page, '.settings-panel', 'button, input');
      if (width >= 768) await assertSettingsAnchor(page, 'uk');
      await attachPage(page, testInfo, `liquid-glass-${width}-settings-switched-uk`);
      await context.close();
    });
  }

  for (const zoom of [1.25, 1.5] as const) {
    test(`liquid-glass functional surfaces at ${zoom * 100}% zoom`, async ({ browser }) => {
      const context = await createVisualContext(browser, { width: 1280, language: 'en', colorScheme: 'light', reducedMotion: 'no-preference', visualStyle: 'liquid-glass' });
      const page = await context.newPage();
      await mockVisualApi(page);
      await page.goto(`/games/${visualGame.id}`);
      await page.locator('body').evaluate((body, scale) => { body.style.zoom = String(scale); }, zoom);
      await exerciseLiquidGlassSurfaces(page, 'en', 'light', false);
      await context.close();
    });
  }
});

type VisualCase = {
  width: number;
  language: Language;
  colorScheme: 'light' | 'dark';
  reducedMotion: 'reduce' | 'no-preference';
  visualStyle?: VisualStyleId;
};

async function createVisualContext(browser: Browser, visualCase: VisualCase): Promise<BrowserContext> {
  const context = await browser.newContext({
    viewport: { width: visualCase.width, height: visualCase.width <= 430 ? 780 : 900 },
    colorScheme: visualCase.colorScheme,
    reducedMotion: visualCase.reducedMotion,
    serviceWorkers: 'block',
  });
  await context.addInitScript(({ language, colorMode, visualStyle }) => {
    try {
      window.localStorage.setItem('monopoly-bank-language', language);
      window.localStorage.setItem('monopoly-bank-device-preferences', JSON.stringify({ visualStyle, colorMode, sound: false, vibration: false }));
    } catch { /* The initial opaque about:blank document does not expose storage. */ }
  }, { language: visualCase.language, colorMode: visualCase.colorScheme, visualStyle: visualCase.visualStyle ?? 'classic-bank' });
  return context;
}

async function exerciseMajorViews(page: Page, language: Language, attachmentPrefix: string, testInfo: TestInfo): Promise<void> {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: translate(language, 'savedGames'), exact: true })).toBeVisible();
  await assertSearchFieldGeometry(page);
  await assertViewportHealth(page);
  await attachPage(page, testInfo, `${attachmentPrefix}-saved-games`);

  await page.goto('/profile');
  await expect(page.getByRole('heading', { name: translate(language, 'playerProfile'), exact: true }).first()).toBeVisible();
  await assertViewportHealth(page);
  await attachPage(page, testInfo, `${attachmentPrefix}-profile`);

  await page.goto('/games/new');
  await expect(page.getByRole('heading', { name: translate(language, 'createLobby'), exact: true })).toBeVisible();
  await assertViewportHealth(page);
  await attachPage(page, testInfo, `${attachmentPrefix}-create-game`);

  await page.goto('/games/join');
  await expect(page.getByRole('heading', { name: translate(language, 'joinGame'), exact: true })).toBeVisible();
  await assertViewportHealth(page);
  await attachPage(page, testInfo, `${attachmentPrefix}-join-game`);

  await openGame(page, language);
  await assertViewportHealth(page);
  await attachPage(page, testInfo, `${attachmentPrefix}-game`);

  const activityTrigger = page.getByRole('button', { name: translate(language, 'activity'), exact: true });
  await openActivity(page, language);
  if (language === 'uk') {
    await expect(page.getByText(translate(language, 'bankruptcyTransactionDescription', { source: visualPlayers[2].name, destination: visualPlayers[1].name }), { exact: true })).toBeVisible();
    await expect(page.getByText('declared bankruptcy', { exact: false })).toHaveCount(0);
  }
  await attachPage(page, testInfo, `${attachmentPrefix}-operations`);
  await page.getByRole('tab', { name: translate(language, 'activityAll'), exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('tab', { name: translate(language, 'activityMine'), exact: true })).toBeFocused();
  await page.locator('.activity-scroll').evaluate((element) => { element.scrollTop = element.scrollHeight; });
  await expect(page.getByRole('heading', { name: translate(language, 'activity'), exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(activityTrigger).toBeFocused();

  await openStatistics(page, language);
  if (language === 'uk') {
    await expect(page.getByText('2h 40m', { exact: true })).toHaveCount(0);
    await expect(page.getByText(translate(language, 'durationHoursMinutes', { hours: 2, minutes: 40 }), { exact: true })).toBeVisible();
  }
  await attachPage(page, testInfo, `${attachmentPrefix}-statistics`);
  await page.keyboard.press('Escape');

  const settingsTrigger = page.getByRole('button', { name: translate(language, 'settings'), exact: true });
  await openSettings(page, language);
  await assertViewportHealth(page);
  await attachPage(page, testInfo, `${attachmentPrefix}-settings`);
  await page.keyboard.press('Escape');
  await expect(settingsTrigger).toBeFocused();
}

async function openGame(page: Page, language: Language): Promise<void> {
  await page.goto(`/games/${visualGame.id}`);
  await expect(page.getByRole('heading', { name: visualGame.name, exact: true })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', language);
}

async function openActivity(page: Page, language: Language): Promise<void> {
  await page.getByRole('button', { name: translate(language, 'activity'), exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('heading', { name: translate(language, 'activity'), exact: true })).toBeVisible();
  await waitForOverlayMotion(page);
  const scroll = page.locator('.activity-scroll');
  await expect(scroll).toBeVisible();
  expect(await scroll.evaluate((element) => element.scrollHeight > element.clientHeight)).toBe(true);
}

async function openStatistics(page: Page, language: Language): Promise<void> {
  await page.getByRole('button', { name: translate(language, 'statistics'), exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('heading', { name: translate(language, 'statistics'), exact: true })).toBeVisible();
  await waitForOverlayMotion(page);
}

async function openSettings(page: Page, language: Language, assertAnchor = true): Promise<void> {
  const trigger = page.getByRole('button', { name: translate(language, 'settings'), exact: true });
  await trigger.click();
  await expect(page.getByRole('dialog').getByRole('heading', { name: translate(language, 'settings'), exact: true })).toBeVisible();
  await waitForOverlayMotion(page);
  if (assertAnchor && (page.viewportSize()?.width ?? 0) >= 768) await assertSettingsAnchor(page, language);
}

async function assertSettingsAnchor(page: Page, language: Language): Promise<void> {
  const trigger = page.getByRole('button', { name: translate(language, 'settings'), exact: true });
  const [triggerBox, panelBox] = await Promise.all([trigger.boundingBox(), page.getByRole('dialog').boundingBox()]);
  expect(triggerBox).not.toBeNull();
  expect(panelBox).not.toBeNull();
  if (triggerBox !== null && panelBox !== null) {
    expect(panelBox.y).toBeGreaterThanOrEqual(triggerBox.y + triggerBox.height + 11);
    expect(Math.abs((panelBox.x + panelBox.width) - (triggerBox.x + triggerBox.width))).toBeLessThanOrEqual(2);
  }
}

async function waitForOverlayMotion(page: Page): Promise<void> {
  await page.getByRole('dialog').evaluate(async (element) => {
    await Promise.all(element.getAnimations({ subtree: true }).map((animation) => animation.finished.catch(() => undefined)));
  });
}

async function exerciseLiquidGlassSurfaces(page: Page, language: Language, colorScheme: 'light' | 'dark', navigate = true): Promise<void> {
  if (navigate) await openGame(page, language);
  else await expect(page.getByRole('heading', { name: visualGame.name, exact: true })).toBeVisible();

  await assertViewportHealth(page);
  await assertNoHorizontalOverflow(page, '.wallets-section');
  const activeWallet = page.locator('.wallet-card-active').first();
  await expect(activeWallet).toBeVisible();
  const activeWalletColors = await activeWallet.evaluate((element) => {
    const style = getComputedStyle(element);
    return { color: style.color, background: style.backgroundColor };
  });
  if (colorScheme === 'light') {
    expect(activeWalletColors.color).toBe('rgb(20, 32, 51)');
    expect(activeWalletColors.background).not.toBe('rgba(0, 0, 0, 0)');
  }

  await openActivity(page, language);
  await assertFunctionalDialog(page);
  await page.keyboard.press('Escape');

  await openStatistics(page, language);
  await assertFunctionalDialog(page);
  await assertNoHorizontalOverflow(page, '.statistics-report');
  await page.keyboard.press('Escape');

  await openSettings(page, language, navigate);
  await assertNoHorizontalOverflow(page, '.settings-panel');
  await assertNoHorizontalOverflow(page, '.style-preview-grid');
  await assertNoHorizontalOverflow(page, '.settings-segmented');
  await page.keyboard.press('Escape');
}

async function assertFunctionalDialog(page: Page): Promise<void> {
  const dialog = page.getByRole('dialog');
  await assertNoHorizontalOverflow(page, '.dialog');
  const styles = await dialog.evaluate((element) => {
    const dialogStyle = getComputedStyle(element);
    const backdropStyle = getComputedStyle(element.parentElement!);
    return {
      color: dialogStyle.color,
      background: dialogStyle.backgroundColor,
      backdropBackground: backdropStyle.backgroundColor,
      backdropFilter: backdropStyle.backdropFilter || backdropStyle.getPropertyValue('-webkit-backdrop-filter'),
    };
  });
  expect(styles.background).not.toBe('rgba(0, 0, 0, 0)');
  expect(styles.backdropBackground).not.toBe('rgba(0, 0, 0, 0)');
  expect(styles.backdropFilter).toContain('blur');
}

async function assertNoHorizontalOverflow(page: Page, selector: string): Promise<void> {
  const element = page.locator(selector).first();
  await expect(element).toBeVisible();
  expect(await element.evaluate((node) => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
}

async function assertDescendantsContained(page: Page, containerSelector: string, descendantSelector: string): Promise<void> {
  const overflow = await page.locator(containerSelector).first().evaluate((container, selector) => {
    const bounds = container.getBoundingClientRect();
    return Array.from(container.querySelectorAll<HTMLElement>(selector)).filter((element) => {
      const child = element.getBoundingClientRect();
      return child.left < bounds.left - 1 || child.right > bounds.right + 1;
    }).map((element) => element.getAttribute('aria-label') ?? element.textContent?.trim() ?? element.tagName);
  }, descendantSelector);
  expect(overflow).toEqual([]);
}

async function assertViewportHealth(page: Page): Promise<void> {
  expect(await page.locator('body').evaluate((body) => body.scrollWidth <= window.innerWidth + 1)).toBe(true);
  const primaryTargets = page.locator('.button-primary:visible');
  const targetCount = await primaryTargets.count();
  for (let index = 0; index < targetCount; index += 1) {
    const box = await primaryTargets.nth(index).boundingBox();
    expect(box === null || (box.height >= 44 && box.width >= 44)).toBe(true);
  }
}

async function assertSearchFieldGeometry(page: Page): Promise<void> {
  const input = page.locator('.saved-games-search input');
  const icon = page.locator('.saved-games-search-icon');
  await expect(input).toBeVisible();

  const assertGeometry = async () => {
    const [inputBox, iconBox, padding] = await Promise.all([
      input.boundingBox(),
      icon.boundingBox(),
      input.evaluate((element) => getComputedStyle(element).paddingInlineStart),
    ]);
    expect(inputBox).not.toBeNull();
    expect(iconBox).not.toBeNull();
    expect(padding).toBe('48px');
    if (inputBox !== null && iconBox !== null) {
      const scale = iconBox.width / 20;
      expect(Math.abs((iconBox.y + iconBox.height / 2) - (inputBox.y + inputBox.height / 2))).toBeLessThanOrEqual(1);
      expect(Math.abs((iconBox.x - inputBox.x) - 16 * scale)).toBeLessThanOrEqual(1);
    }
  };

  await assertGeometry();
  await page.locator('body').evaluate((body) => { body.style.zoom = '1.25'; });
  await assertGeometry();
  await page.locator('body').evaluate((body) => { body.style.zoom = ''; });
}

async function attachPage(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  const outputDirectory = process.env.VISUAL_QA_OUTPUT;
  const body = await page.screenshot({ fullPage: true, ...(outputDirectory === undefined ? {} : { path: `${outputDirectory}/${name}.png` }) });
  await testInfo.attach(name, { body, contentType: 'image/png' });
}

async function mockVisualApi(page: Page): Promise<void> {
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    let data: unknown;
    if (url.pathname === '/api/profile') data = visualProfile;
    else if (url.pathname === '/api/games') data = visualGames;
    else if (url.pathname === `/api/games/${visualGame.id}/activity`) data = url.searchParams.get('scope') === 'PENDING' ? visualPendingActivity : visualActivity;
    else if (url.pathname === `/api/games/${visualGame.id}/summary`) data = visualStatistics;
    else if (url.pathname === `/api/games/${visualGame.id}`) data = visualGameDetails;
    else {
      await route.continue();
      return;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data }) });
  });
}

async function mockActivePaymentInbox(page: Page): Promise<void> {
  await page.route(`**/api/games/${visualGame.id}/payment-requests`, async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: visualPendingActivity.paymentRequests }) });
  });
  await page.route(`**/api/games/${visualGame.id}`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: { ...visualGameDetails, game: { ...visualGameDetails.game, status: 'ACTIVE', finishedAt: null } } }),
    });
  });
}

const visualGame: Game = {
  id: 'visual-regression-game',
  name: 'Transcontinental Railway & Utilities Championship — 2026',
  startingBalance: 1_500,
  passGoReward: 200,
  currency: 'K',
  paymentMode: 'CONFIRMATION',
  status: 'FINISHED',
  createdAt: '2026-09-20T08:00:00.000Z',
  updatedAt: '2026-09-20T10:40:00.000Z',
  startedAt: '2026-09-20T08:00:00.000Z',
  finishedAt: '2026-09-20T10:40:00.000Z',
};

const visualPlayers: Player[] = [
  { id: 'player-one', gameId: visualGame.id, name: 'Oleksandra Very-Long-Double-Barrelled Rail Baron', color: '#d83f55', balance: 9_007_199_254_740_000, status: 'ACTIVE', userId: 'visual-user', createdAt: visualGame.createdAt },
  { id: 'player-two', gameId: visualGame.id, name: 'Богдан Надзвичайно-Довге-Ім’я Власника Комунальних Служб', color: '#2878d0', balance: 888_888_888_888, status: 'ACTIVE', createdAt: visualGame.createdAt },
  { id: 'player-three', gameId: visualGame.id, name: 'Casey', color: '#238b57', balance: 0, status: 'BANKRUPT', createdAt: visualGame.createdAt },
];

const visualProfile: UserProfile = { id: 'visual-user', nickname: visualPlayers[0].name, avatar: '🎩', accountType: 'REGISTERED', email: null, emailVerified: false, gamesPlayed: 9_876, gamesWon: 5_432, gamesLost: 4_444, winRate: 0.55, createdAt: visualGame.createdAt, updatedAt: visualGame.updatedAt };
const visualGames: GameSummary[] = [{ game: visualGame, playerCount: visualPlayers.length }];
const visualGameDetails: GameDetails = { game: visualGame, players: visualPlayers, favoriteAmounts: [100, 500], recentAmounts: [2_000], controlledPlayerIds: ['player-one'], controlledWallets: [{ playerId: 'player-one', kind: 'PRIMARY' }], canManage: true };

const visualTransactions: Transaction[] = Array.from({ length: 48 }, (_, index) => {
  const amount = index === 0 ? 500 : 9_000_000_000 + index;
  return {
    id: `transaction-${index}`,
    gameId: visualGame.id,
    type: index === 0 ? 'BANKRUPTCY_TRANSFER' : 'PLAYER_TO_PLAYER',
    amount,
    totalAmount: amount,
    comment: index % 9 === 0 ? 'Railway auction settlement' : null,
    createdAt: new Date(Date.parse('2026-09-20T10:39:00.000Z') - index * 60_000).toISOString(),
    participants: [{ playerId: index === 0 ? 'player-three' : 'player-one', balanceDelta: -amount }, { playerId: 'player-two', balanceDelta: amount }],
  };
});

const visualActivity: ActivityPage = { transactions: visualTransactions, paymentRequests: [], nextCursor: null };
const visualPendingActivity: ActivityPage = { transactions: [], paymentRequests: [{ id: 'pending-1', gameId: visualGame.id, payerPlayerId: 'player-one', recipientPlayerId: 'player-two', creatorPlayerId: 'player-two', approverPlayerId: 'player-one', amount: 7_777_777_777, comment: 'Boardwalk settlement', state: 'PENDING', expiresAt: '2026-09-20T11:00:00.000Z', createdAt: '2026-09-20T10:38:00.000Z', resolvedAt: null, transactionId: null }], nextCursor: null };

const visualStatistics: { game: Game; winners: Player[] } & LedgerStatistics = {
  game: visualGame,
  winners: [visualPlayers[0]],
  durationMs: 9_600_000,
  totalTransactions: 12_345,
  totalMoneyTransferred: 9_007_199_254_740_000,
  largestSinglePayment: 888_888_888_888,
  richestActivePlayer: visualPlayers[0],
  lowestActiveBalance: visualPlayers[1].balance,
  players: visualPlayers.map((player) => ({ player, totalReceived: 100, totalPaid: 50, passGoCount: 2, transactionCount: 10 })),
  playerToPlayerTotal: 8_888_888_888,
  paidToBank: 777_777_777,
  receivedFromBank: 666_666_666,
  largestTransaction: 888_888_888_888,
  biggestSenderId: 'player-one',
  leastSenderId: 'player-three',
  biggestPayerRecipient: { payerId: 'player-one', recipientId: 'player-two', amount: 555_555_555, transactionCount: 42 },
  cashLeaderboard: visualPlayers.map((player, index) => ({ player, sent: 900_000_000 - index, received: 800_000_000 - index, passGoCount: 12 - index, transactionCount: 4_000 - index })),
};

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
