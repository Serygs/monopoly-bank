import { expect, test, type Page } from '@playwright/test';

import { visualStyles } from '../../src/appearance/visual-styles';
import { translate, type Language } from '../../src/i18n/translations';
import { fixtureActiveGame, fixtureSavedGames, fixtureTransactions } from '../fixtures/api';
import { prepareVisualPage, type VisualColorMode } from './visual.setup';

/**
 * Pre-refactor screenshot baselines: every registered visual style × colour mode × width for
 * the major screens. Baselines are machine-specific (fonts), so this project is opt-in and is
 * never part of `npm test` or CI — run `npm run test:visual` / `npm run test:visual:update`.
 */

const colorModes: readonly VisualColorMode[] = ['light', 'dark'];
const viewports = [
  { width: 390, height: 844 },
  { width: 768, height: 1024 },
  { width: 1280, height: 800 },
] as const;

interface VisualScreen {
  name: string;
  languages: readonly Language[];
  authenticated?: boolean;
  /** Dialog screens capture the viewport; page screens capture the full scroll height. */
  fullPage: boolean;
  /** Restricts the screen to some of `viewports` (by width); all of them when omitted. */
  widths?: readonly number[];
  open: (page: Page, language: Language) => Promise<void>;
}

const screens: readonly VisualScreen[] = [
  {
    name: 'auth',
    languages: ['en'],
    authenticated: false,
    fullPage: true,
    open: async (page, language) => {
      await page.goto('/');
      await expect(
        page.getByRole('heading', { name: translate(language, 'welcomeBack'), exact: true }),
      ).toBeVisible();
    },
  },
  {
    name: 'saved-games',
    languages: ['en', 'uk'],
    fullPage: true,
    open: async (page, language) => {
      await page.goto('/');
      await expect(
        page.getByRole('heading', { name: translate(language, 'savedGames'), exact: true }),
      ).toBeVisible();
      await expect(page.locator('.game-card')).toHaveCount(fixtureSavedGames.length);
    },
  },
  {
    name: 'create-game',
    languages: ['en'],
    fullPage: true,
    open: async (page, language) => {
      await page.goto('/games/new');
      await expect(
        page.getByRole('heading', { name: translate(language, 'createLobby'), exact: true }),
      ).toBeVisible();
    },
  },
  {
    name: 'game-wallet',
    languages: ['en', 'uk'],
    fullPage: true,
    open: async (page) => {
      await openGame(page);
      await page.evaluate(() => document.fonts.ready);
      // A balance never wraps, so it must shrink to fit its card at every width.
      const clipped = await page
        .locator('.wallet-card strong')
        .evaluateAll((balances) =>
          balances
            .filter((balance) => balance.scrollWidth > balance.clientWidth)
            .map((balance) => balance.textContent),
        );
      expect(clipped).toEqual([]);
    },
  },
  {
    name: 'game-banking-dialog',
    languages: ['en'],
    fullPage: false,
    open: async (page) => {
      await openGame(page);
      await page.locator('button.wallet-card-active').click();
      await settleDialog(page);
    },
  },
  {
    name: 'activity',
    languages: ['en'],
    fullPage: false,
    open: async (page, language) => {
      await openGame(page);
      await page
        .getByRole('button', { name: translate(language, 'activity'), exact: true })
        .click();
      await settleDialog(page);
      await expect(page.locator('.activity-ledger > li')).toHaveCount(fixtureTransactions.length);
    },
  },
  {
    // The settings popover presented as the compact bottom sheet (the modal sheet is covered by
    // `game-banking-dialog-*-390`).
    name: 'settings-sheet',
    languages: ['en'],
    fullPage: false,
    widths: [390],
    open: async (page, language) => {
      await page.goto('/');
      await expect(page.locator('.game-card')).toHaveCount(fixtureSavedGames.length);
      await page
        .getByRole('button', { name: translate(language, 'settings'), exact: true })
        .click();
      await settleDialog(page);
    },
  },
  {
    name: 'profile',
    languages: ['en'],
    fullPage: true,
    open: async (page, language) => {
      await page.goto('/profile');
      await expect(
        page
          .getByRole('heading', { name: translate(language, 'playerProfile'), exact: true })
          .first(),
      ).toBeVisible();
    },
  },
];

async function openGame(page: Page): Promise<void> {
  await page.goto(`/games/${fixtureActiveGame.id}`);
  await expect(
    page.getByRole('heading', { name: fixtureActiveGame.name, exact: true }),
  ).toBeVisible();
  await expect(page.locator('.wallet-card')).toHaveCount(4);
}

async function settleDialog(page: Page): Promise<void> {
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  // Dialog moves focus into itself on the next tick; wait so the focus ring is stable.
  await expect
    .poll(() => dialog.evaluate((element) => element.contains(document.activeElement)))
    .toBe(true);
}

for (const screen of screens) {
  for (const language of screen.languages) {
    for (const { id: visualStyle } of visualStyles) {
      for (const colorMode of colorModes) {
        for (const viewport of viewports) {
          if (screen.widths !== undefined && !screen.widths.includes(viewport.width)) continue;
          const name = `${screen.name}-${language}-${visualStyle}-${colorMode}-${viewport.width}`;
          test(name, async ({ page }) => {
            await page.setViewportSize(viewport);
            await prepareVisualPage(
              page,
              { visualStyle, colorMode, language },
              { authenticated: screen.authenticated ?? true },
            );
            await screen.open(page, language);
            await expect(page.locator('html')).toHaveAttribute('data-visual-style', visualStyle);
            await expect(page.locator('html')).toHaveAttribute('data-color-mode', colorMode);
            await expect(page.locator('html')).toHaveAttribute('lang', language);
            // Park the pointer so no hover state leaks into the capture.
            await page.mouse.move(0, 0);
            await page.evaluate(() => document.fonts.ready);
            await expect(page).toHaveScreenshot(`${name}.png`, {
              animations: 'disabled',
              maxDiffPixelRatio: 0.01,
              fullPage: screen.fullPage,
            });
          });
        }
      }
    }
  }
}
