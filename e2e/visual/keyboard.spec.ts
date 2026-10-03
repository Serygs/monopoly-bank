import { expect, test, type Page } from '@playwright/test';

import { translate } from '../../src/i18n/translations';
import { fixtureActiveGame, fixtureSavedGames } from '../fixtures/api';
import { prepareVisualPage } from './visual.setup';

/**
 * Real-browser keyboard checks for the Headless UI overlays: focus trap, Escape, focus
 * restoration and menu arrows. Runs with the visual harness (stubbed API, reduced motion).
 */

async function openWalletDialog(page: Page) {
  await page.goto(`/games/${fixtureActiveGame.id}`);
  const trigger = page.locator('button.wallet-card-active');
  await expect(trigger).toBeVisible();
  await trigger.click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect
    .poll(() => dialog.evaluate((element) => element.contains(document.activeElement)))
    .toBe(true);
  return { trigger, dialog };
}

for (const visualStyle of ['classic-bank', 'liquid-glass'] as const) {
  test.describe(`keyboard ${visualStyle}`, () => {
    test.beforeEach(async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await prepareVisualPage(page, { visualStyle, colorMode: 'light', language: 'en' });
    });

    test('Tab and Shift+Tab stay inside the dialog; Escape closes and restores focus', async ({
      page,
    }) => {
      const { trigger, dialog } = await openWalletDialog(page);
      for (let step = 0; step < 12; step += 1) {
        await page.keyboard.press('Tab');
        expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(
          true,
        );
      }
      for (let step = 0; step < 12; step += 1) {
        await page.keyboard.press('Shift+Tab');
        expect(await dialog.evaluate((element) => element.contains(document.activeElement))).toBe(
          true,
        );
      }
      await expect(page.locator('html')).toHaveCSS('overflow', 'hidden');
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
      await expect(trigger).toBeFocused();
      await expect(page.locator('html')).not.toHaveCSS('overflow', 'hidden');
    });

    test('the game actions menu opens and moves with the arrow keys', async ({ page }) => {
      await page.goto('/');
      await expect(page.locator('.game-card')).toHaveCount(fixtureSavedGames.length);
      const trigger = page
        .getByRole('button', {
          name: translate('en', 'gameActions', { name: fixtureSavedGames[0].game.name }),
          exact: true,
        })
        .first();
      await trigger.focus();
      await page.keyboard.press('ArrowDown');
      const menu = page.getByRole('menu');
      await expect(menu).toBeFocused();
      const active = () =>
        menu.evaluate(
          (element) =>
            document.getElementById(element.getAttribute('aria-activedescendant') ?? '')
              ?.textContent ?? null,
        );
      const labels = await page.getByRole('menuitem').allTextContents();
      expect(await active()).toBe(labels[0]);
      await page.keyboard.press('End');
      expect(await active()).toBe(labels.at(-1));
      await page.keyboard.press('Escape');
      await expect(menu).toBeHidden();
      await expect(trigger).toBeFocused();
    });
  });
}
