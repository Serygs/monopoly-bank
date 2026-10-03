import { expect, test, type Locator, type Page } from '@playwright/test';

import { translate } from '../../src/i18n/translations';
import { fixtureActiveGame } from '../fixtures/api';
import { prepareVisualPage } from './visual.setup';

/*
 * Behaviour the screenshots cannot show: live appearance switching, the reduced-motion and
 * forced-colours overrides of the Liquid Glass effects, and the safe-area offsets on a phone.
 * No screenshots.
 */

const t = (key: Parameters<typeof translate>[1]) => translate('en', key);

const css = (locator: Locator, property: string) =>
  locator.evaluate((element, name) => getComputedStyle(element).getPropertyValue(name), property);

async function openBankingSheet(page: Page) {
  await page.goto(`/games/${fixtureActiveGame.id}`);
  await expect(page.locator('.wallet-card')).toHaveCount(4);
  await page.locator('button.wallet-card-active').click();
  const backdrop = page.getByRole('dialog');
  await expect(backdrop).toBeVisible();
  return { backdrop, panel: backdrop.locator('.dialog') };
}

test('the appearance settings switch style and colour mode both ways without a reload', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await prepareVisualPage(page, {
    visualStyle: 'classic-bank',
    colorMode: 'light',
    language: 'en',
  });
  await page.goto('/');
  const html = page.locator('html');
  const header = page.locator('.app-header');
  const body = page.locator('body');
  await page.getByRole('button', { name: t('settings'), exact: true }).click();
  await expect(page.locator('#settings-panel')).toBeVisible();
  await page.evaluate(() => {
    (window as Window & { __noReload?: boolean }).__noReload = true;
  });

  const classicHeader = await css(header, 'color');
  expect(await css(header, 'backdrop-filter')).toBe('none');

  await page.getByRole('button', { name: t('visualStyleLiquidGlass') }).click();
  await expect(html).toHaveAttribute('data-visual-style', 'liquid-glass');
  await expect.poll(() => css(header, 'backdrop-filter')).toBe('blur(20px) saturate(1.3)');
  expect(await css(header, 'color')).not.toBe(classicHeader);

  await page.getByRole('button', { name: t('visualStyleClassicBank') }).click();
  await expect(html).toHaveAttribute('data-visual-style', 'classic-bank');
  await expect.poll(() => css(header, 'backdrop-filter')).toBe('none');
  expect(await css(header, 'color')).toBe(classicHeader);

  const lightCanvas = await css(body, 'background-color');
  await page.getByRole('radio', { name: t('themeDark'), exact: true }).click();
  await expect(html).toHaveAttribute('data-color-mode', 'dark');
  await expect.poll(() => css(body, 'background-color')).not.toBe(lightCanvas);
  await page.getByRole('radio', { name: t('themeLight'), exact: true }).click();
  await expect(html).toHaveAttribute('data-color-mode', 'light');
  await expect.poll(() => css(body, 'background-color')).toBe(lightCanvas);

  // Same document throughout: the marker set before the first switch survived.
  expect(await page.evaluate(() => (window as Window & { __noReload?: boolean }).__noReload)).toBe(
    true,
  );
});

test.describe('Liquid Glass motion and forced colours', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await prepareVisualPage(page, {
      visualStyle: 'liquid-glass',
      colorMode: 'light',
      language: 'en',
    });
  });

  const ambient = (page: Page) =>
    page.evaluate(() =>
      document
        .getAnimations()
        .filter((a) => a instanceof CSSAnimation && a.animationName === 'liquid-ambient')
        .map((a) => a.playState),
    );

  test('without reduced motion the ambient drift and dialog transitions run', async ({ page }) => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.goto('/');
    await expect(page.locator('.game-card').first()).toBeVisible();
    expect(await ambient(page)).toEqual(['running']);
    const { panel } = await openBankingSheet(page);
    expect(await css(panel, 'transition-duration')).not.toMatch(/^0s(, 0s)*$/);
  });

  test('reduced motion stops the ambient drift and the dialog transitions', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.game-card').first()).toBeVisible();
    expect(await ambient(page)).toEqual([]);
    expect(await css(page.locator('.app-shell'), 'animation-name')).toBe('none');
    const { backdrop, panel } = await openBankingSheet(page);
    for (const surface of [backdrop, panel]) {
      const property = await css(surface, 'transition-property');
      const duration = await css(surface, 'transition-duration');
      expect(property === 'none' || /^0s(, 0s)*$/.test(duration)).toBe(true);
    }
    expect(await backdrop.evaluate((element) => element.getAnimations({ subtree: true }))).toEqual(
      [],
    );
  });

  test('forced colours drop the backdrop blur of the glass surfaces', async ({ page }) => {
    await page.goto('/');
    const card = page.locator('.game-card').first();
    await expect(card).toBeVisible();
    const { panel } = await openBankingSheet(page);
    expect(await css(panel, 'backdrop-filter')).toBe('blur(26px) saturate(1.3)');
    await page.emulateMedia({ forcedColors: 'active' });
    await expect.poll(() => css(panel, 'backdrop-filter')).toBe('none');
  });
});

test('safe-area insets offset the header and the bottom sheet at 390px', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await prepareVisualPage(page, {
    visualStyle: 'liquid-glass',
    colorMode: 'light',
    language: 'en',
  });
  const cdp = await page.context().newCDPSession(page);
  const send = cdp.send.bind(cdp) as (method: string, params: object) => Promise<unknown>;
  await send('Emulation.setSafeAreaInsetsOverride', {
    insets: { top: 47, bottom: 34, left: 0, right: 0 },
  });
  await page.goto(`/games/${fixtureActiveGame.id}`);
  const header = page.locator('.app-header');
  await expect(header).toBeVisible();
  expect(await css(header, 'padding-top')).toBe('47px');
  const { backdrop, panel } = await openBankingSheet(page);
  expect(await css(backdrop, 'padding-top')).toBe('47px');
  expect(await css(panel, 'padding-bottom')).toBe('48px');
  const sheet = await panel.boundingBox();
  expect(sheet).not.toBeNull();
  expect(Math.round((sheet?.y ?? 0) + (sheet?.height ?? 0))).toBe(844);
  expect(await css(panel, 'max-height')).toBe(`${844 - 47 - 8}px`);
});
