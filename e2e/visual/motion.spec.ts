import { expect, test, type Page } from '@playwright/test';

import { fixtureActiveGame } from '../fixtures/api';
import { prepareVisualPage } from './visual.setup';

/**
 * The dialog entrance is a Headless UI `Transition` (a `data-closed` first frame, then CSS
 * transitions gated on `motion-safe:`). The rest of the visual harness runs with reduced motion,
 * so these checks switch motion back on and prove the entrance runs and then settles fully
 * visible. No screenshots.
 */

declare global {
  interface Window {
    __dialogTransitionLog?: string[];
  }
}

/** Runs in the browser before any page script. Must stay self-contained (it is serialized). */
function recordDialogTransitions(): void {
  const log: string[] = [];
  window.__dialogTransitionLog = log;
  const note = (element: Element) => {
    const part = element.classList.contains('dialog')
      ? 'panel'
      : element.classList.contains('dialog-backdrop')
        ? 'backdrop'
        : null;
    if (part === null) return;
    for (const attribute of ['data-closed', 'data-enter', 'data-transition'])
      if (element.hasAttribute(attribute)) log.push(`${part}:${attribute}`);
  };
  new MutationObserver((records) => {
    for (const record of records) {
      if (record.type === 'attributes' && record.target instanceof Element) note(record.target);
      for (const node of record.addedNodes)
        if (node instanceof Element) {
          note(node);
          node.querySelectorAll('.dialog, .dialog-backdrop').forEach(note);
        }
    }
  }).observe(document, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ['data-closed', 'data-enter', 'data-transition', 'class'],
  });
}

async function openBankingDialog(page: Page) {
  await page.goto(`/games/${fixtureActiveGame.id}`);
  await expect(
    page.getByRole('heading', { name: fixtureActiveGame.name, exact: true }),
  ).toBeVisible();
  await expect(page.locator('.wallet-card')).toHaveCount(4);
  await page.locator('button.wallet-card-active').click();
  const backdrop = page.getByRole('dialog');
  await expect(backdrop).toBeVisible();
  return { backdrop, panel: backdrop.locator('.dialog') };
}

const transitionStates = '[data-closed], [data-enter], [data-leave], [data-transition]';

for (const visualStyle of ['classic-bank', 'liquid-glass'] as const) {
  for (const width of [390, 1280] as const) {
    test.describe(`dialog motion ${visualStyle} ${width}`, () => {
      test.beforeEach(async ({ page }) => {
        await page.setViewportSize({ width, height: width === 390 ? 844 : 800 });
        await prepareVisualPage(page, { visualStyle, colorMode: 'light', language: 'en' });
        await page.emulateMedia({ reducedMotion: 'no-preference' });
        await page.addInitScript(recordDialogTransitions);
      });

      test('the entrance transition runs, then settles fully visible; Escape removes it', async ({
        page,
      }) => {
        expect(
          await page.evaluate(() => matchMedia('(prefers-reduced-motion: no-preference)').matches),
        ).toBe(true);
        const { backdrop, panel } = await openBankingDialog(page);

        // Motion is really on: both surfaces carry a non-zero transition.
        for (const surface of [backdrop, panel])
          expect(
            await surface.evaluate((element) =>
              getComputedStyle(element)
                .transitionDuration.split(',')
                .some((duration) => parseFloat(duration) > 0),
            ),
          ).toBe(true);

        // Settle: Headless UI clears its transition data attributes once the transition ends,
        // and no animation is left running on either surface.
        await expect
          .poll(() =>
            backdrop.evaluate(
              (element, selector) => element.matches(selector) || !!element.querySelector(selector),
              transitionStates,
            ),
          )
          .toBe(false);
        await expect
          .poll(() =>
            backdrop.evaluate((element) => element.getAnimations({ subtree: true }).length),
          )
          .toBe(0);

        // The entrance started from the closed frame on both surfaces.
        const log = await page.evaluate(() => window.__dialogTransitionLog ?? []);
        expect(log).toContain('backdrop:data-closed');
        expect(log).toContain('panel:data-closed');

        expect(await backdrop.evaluate((element) => getComputedStyle(element).opacity)).toBe('1');
        const settled = await panel.evaluate((element) => {
          const style = getComputedStyle(element);
          return {
            opacity: style.opacity,
            transform: style.transform,
            translate: style.translate,
            scale: style.scale,
          };
        });
        expect(settled.opacity).toBe('1');
        expect(['none', 'matrix(1, 0, 0, 1, 0, 0)']).toContain(settled.transform);
        expect(['none', '0px', '0px 0px']).toContain(settled.translate);
        expect(['none', '1']).toContain(settled.scale);

        await page.keyboard.press('Escape');
        await expect(page.getByRole('dialog')).toHaveCount(0);
        await expect(page.locator('.dialog-backdrop, .dialog')).toHaveCount(0);
      });
    });
  }
}
