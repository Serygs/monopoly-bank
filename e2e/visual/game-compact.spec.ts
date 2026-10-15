import { expect, test } from '@playwright/test';

import { visualStyles } from '../../src/appearance/visual-styles';
import { translate, type Language } from '../../src/i18n/translations';
import { fixtureActiveGame } from '../fixtures/api';
import { prepareVisualPage } from './visual.setup';

/**
 * Compact game screen: the bottom navigation replaces the header actions, the Wallets view fits
 * a phone without vertical scrolling, and nothing changes from `md` up. Behavioural checks only
 * (no screenshots), so they hold on any machine.
 */

const phones = [
  { width: 393, height: 852 },
  { width: 430, height: 932 },
] as const;
const languages: readonly Language[] = ['en', 'uk'];

for (const { id: visualStyle } of visualStyles) {
  for (const language of languages) {
    for (const phone of phones) {
      test(`game-compact-${language}-${visualStyle}-${phone.width}`, async ({ page }) => {
        await page.setViewportSize(phone);
        await prepareVisualPage(page, { visualStyle, colorMode: 'light', language });
        await page.goto(`/games/${fixtureActiveGame.id}`);
        await expect(page.locator('.wallet-card')).toHaveCount(4);
        await page.evaluate(() => document.fonts.ready);

        const nav = page.getByRole('navigation', { name: translate(language, 'gameNavigation') });
        await expect(nav).toBeVisible();
        const scroll = await page.evaluate(() => ({
          scrollHeight: document.documentElement.scrollHeight,
          innerHeight: window.innerHeight,
          scrollWidth: document.documentElement.scrollWidth,
          clientWidth: document.documentElement.clientWidth,
        }));
        expect(scroll.scrollHeight, 'wallets view must not scroll vertically').toBeLessThanOrEqual(
          scroll.innerHeight,
        );
        expect(scroll.scrollWidth).toBeLessThanOrEqual(scroll.clientWidth);

        // The header copy of Activity is hidden below md; only the bar's button is reachable.
        await expect(
          page.getByRole('button', { name: translate(language, 'activity'), exact: true }),
        ).toHaveCount(1);

        // No label may be clipped.
        const clipped = await nav
          .locator('li span:not(.sr-only)')
          .evaluateAll((labels) =>
            labels
              .filter((label) => label.scrollWidth > label.clientWidth)
              .map((label) => label.textContent),
          );
        expect(clipped).toEqual([]);

        // Tools is a sheet: it opens over the wallets and its close button dismisses it.
        await nav.getByRole('button', { name: translate(language, 'navTools') }).click();
        const tools = page.getByRole('dialog', { name: translate(language, 'navTools') });
        await expect(tools).toBeVisible();
        await expect(
          tools.getByRole('heading', { name: translate(language, 'rollDice') }),
        ).toBeVisible();
        await tools
          .getByRole('button', {
            name: translate(language, 'closeDialog', { title: translate(language, 'navTools') }),
          })
          .click();
        await expect(tools).toBeHidden();

        await nav.getByRole('button', { name: translate(language, 'navPay') }).click();
        await expect(page.getByRole('dialog')).toBeVisible();
      });

      test(`game-compact-pay-form-${language}-${visualStyle}-${phone.width}`, async ({ page }) => {
        await page.setViewportSize(phone);
        await prepareVisualPage(page, { visualStyle, colorMode: 'light', language });
        await page.goto(`/games/${fixtureActiveGame.id}`);
        await expect(page.locator('.wallet-card')).toHaveCount(4);
        await page.getByRole('button', { name: translate(language, 'navPay') }).click();

        for (const action of ['payPlayer', 'payBank'] as const) {
          await page
            .getByRole('button', { name: translate(language, action), exact: true })
            .click();
          const panel = page.locator('section.dialog');
          await expect(
            panel.getByRole('group', { name: translate(language, 'numericKeypad') }),
          ).toBeVisible();
          await page.waitForTimeout(400);

          // The body is the only scrolling part and the footer sits below it, never over it.
          const layout = await panel.evaluate((element) => {
            const body = element.children[1] as HTMLElement;
            const footer = element.querySelector('.dialog-actions') as HTMLElement;
            return {
              bodyOverflow: body.scrollHeight - body.clientHeight,
              bodyBottom: body.getBoundingClientRect().bottom,
              footerTop: footer.getBoundingClientRect().top,
              panelTop: element.getBoundingClientRect().top,
              pageOverflowX:
                document.documentElement.scrollWidth - document.documentElement.clientWidth,
            };
          });
          expect(layout.footerTop, `${action}: footer overlaps the body`).toBeGreaterThanOrEqual(
            layout.bodyBottom - 1,
          );
          expect(layout.bodyOverflow, `${action}: the form needs scrolling`).toBeLessThanOrEqual(0);
          expect(layout.panelTop).toBeGreaterThanOrEqual(0);
          expect(layout.pageOverflowX).toBeLessThanOrEqual(0);

          // The amount field keeps the system keyboard closed; the keypad types instead.
          await expect(
            panel.getByRole('textbox', { name: translate(language, 'amount'), exact: true }),
          ).toHaveAttribute('inputmode', 'none');

          await panel
            .getByRole('button', { name: translate(language, 'back'), exact: true })
            .click();
        }
      });
    }
  }
}

test('game-compact-nav-hidden-from-md', async ({ page }) => {
  await page.setViewportSize({ width: 768, height: 1024 });
  await prepareVisualPage(page, {
    visualStyle: 'classic-bank',
    colorMode: 'light',
    language: 'en',
  });
  await page.goto(`/games/${fixtureActiveGame.id}`);
  await expect(page.locator('.wallet-card')).toHaveCount(4);
  await expect(page.getByRole('navigation', { name: 'Game navigation' })).toBeHidden();
  await expect(page.getByRole('button', { name: 'Activity', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Roll dice' }).first()).toBeVisible();
});
