import { expect, test } from '@playwright/test';

import type { VisualStyleId } from '../../src/appearance/visual-styles';
import { translate } from '../../src/i18n/translations';
import { fixtureSavedGames } from '../fixtures/api';
import { prepareVisualPage } from './visual.setup';

/**
 * Regenerates the four `docs/ui/reference/*.png` build captures: Saved games, Ukrainian, light
 * mode, per visual style at the original desktop (1672×941 @1x) and phone (426×923 @2x, i.e.
 * 852×1846) sizes. It writes into `docs/`, so it is skipped unless run through
 * `npm run test:visual:reference`; `npm run test:visual` never touches the references.
 */

test.skip(process.env.MB_REFERENCE_CAPTURE !== '1', 'Run with npm run test:visual:reference.');

const styles: readonly { id: VisualStyleId; label: string }[] = [
  { id: 'classic-bank', label: 'Classic' },
  { id: 'liquid-glass', label: 'Liquid Glass' },
];
const formats = [
  { label: 'Desktop', viewport: { width: 1672, height: 941 }, deviceScaleFactor: 1 },
  { label: 'Mobile', viewport: { width: 426, height: 923 }, deviceScaleFactor: 2 },
] as const;

for (const format of formats) {
  test.describe(format.label, () => {
    test.use({ viewport: format.viewport, deviceScaleFactor: format.deviceScaleFactor });

    for (const style of styles) {
      test(`${style.label} ${format.label}`, async ({ page }) => {
        await prepareVisualPage(page, {
          visualStyle: style.id,
          colorMode: 'light',
          language: 'uk',
        });
        await page.goto('/');
        await expect(
          page.getByRole('heading', { name: translate('uk', 'savedGames'), exact: true }),
        ).toBeVisible();
        await expect(page.locator('.game-card')).toHaveCount(fixtureSavedGames.length);
        await page.mouse.move(0, 0);
        await page.evaluate(() => document.fonts.ready);
        await page.screenshot({
          path: `docs/ui/reference/${style.label} ${format.label}.png`,
          animations: 'disabled',
        });
      });
    }
  });
}
