import { expect, test } from '@playwright/test';
import { translate } from '../../src/i18n/translations';
import { prepareVisualPage } from './visual.setup';

for (const visualStyle of ['classic-bank', 'liquid-glass'] as const) {
  for (const language of ['en', 'uk'] as const) {
    test.describe(`merged features ${visualStyle} ${language}`, () => {
      test.beforeEach(async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        await prepareVisualPage(page, { visualStyle, colorMode: 'dark', language });
      });

      test('suggestions remain editable alongside Headless UI colour controls', async ({
        page,
      }) => {
        await page.goto('/games/new');
        const name = page.getByLabel(translate(language, 'gameName'), { exact: true });
        const trigger = page.getByRole('button', { name: translate(language, 'suggestGameName') });
        await trigger.click();
        const suggestions = page.getByRole('dialog', {
          name: translate(language, 'suggestedGameNames'),
        });
        await expect(suggestions.getByRole('button')).toHaveCount(6);
        await expect(trigger).toHaveCSS('min-height', '44px');
        await suggestions.getByRole('button').first().click();
        await expect(name).toBeFocused();
        await name.fill('Edited game');
        await expect(name).toHaveValue('Edited game');
        await expect(page.getByRole('radio')).toHaveCount(6);
        await trigger.click();
        await page.keyboard.press('Escape');
        await expect(suggestions).toBeHidden();
        await expect(name).toBeFocused();
        await expect(page).toHaveURL(/\/games\/new$/);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
          true,
        );
      });

      test('settings retain radios and toggles while sign-out handles pending, failure and success', async ({
        page,
      }) => {
        await page.goto('/');
        await page
          .getByRole('button', { name: translate(language, 'settings'), exact: true })
          .click();
        const dialog = page.getByRole('dialog', {
          name: translate(language, 'settings'),
          exact: true,
        });
        await expect(dialog.getByRole('switch')).toHaveCount(2);
        await expect(dialog.getByRole('radiogroup')).toHaveCount(2);
        await expect(
          dialog.getByRole('button', {
            name: translate(language, 'visualStyleClassicBank'),
            exact: true,
          }),
        ).toBeVisible();

        let releaseLogout: (() => void) | undefined;
        const pendingLogout = new Promise<void>((resolve) => {
          releaseLogout = resolve;
        });
        let requests = 0;
        await page.route('**/api/auth/logout', async (route) => {
          requests += 1;
          await pendingLogout;
          await route.fulfill({
            status: 503,
            json: { error: { code: 'API_ERROR', message: 'Unavailable' } },
          });
        });
        const signOut = dialog.getByRole('button', {
          name: translate(language, 'signOut'),
          exact: true,
        });
        await signOut.click();
        await expect(
          dialog.getByRole('button', { name: translate(language, 'signingOut') }),
        ).toBeDisabled();
        await page.keyboard.press('Escape');
        await expect(dialog).toBeVisible();
        expect(requests).toBe(1);
        releaseLogout?.();
        await expect(dialog.getByRole('alert')).toHaveText(translate(language, 'errorUnexpected'));
        await expect(signOut).toBeEnabled();

        await page.unroute('**/api/auth/logout');
        await page.route('**/api/auth/logout', (route) => route.fulfill({ json: { data: null } }));
        await signOut.click();
        await expect(
          page.getByRole('heading', { name: translate(language, 'welcomeBack'), exact: true }),
        ).toBeVisible();
        await expect(page).toHaveURL(/\/$/);
        await expect(dialog).toBeHidden();
      });
    });
  }
}
