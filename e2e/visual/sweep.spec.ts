import { expect, test, type Page } from '@playwright/test';

import { visualStyles } from '../../src/appearance/visual-styles';
import { translate, type Language } from '../../src/i18n/translations';
import { fixtureActiveGame, fixtureSavedGames } from '../fixtures/api';
import { prepareVisualPage, type VisualColorMode } from './visual.setup';

/**
 * Responsive sweep, no screenshots: every visual style × colour mode × language over the
 * documented validation widths. Each screen is loaded once and then resized through the widths.
 * It asserts no horizontal overflow, no console errors, and the overlay presentation: a
 * full-width bottom sheet below 768px, a centred modal (and the anchored settings popover) from
 * 768px up.
 */

const widths = [320, 390, 430, 768, 1024, 1280, 1440] as const;
const colorModes: readonly VisualColorMode[] = ['light', 'dark'];
const languages: readonly Language[] = ['en', 'uk'];
const heightFor = (width: number) => (width < 768 ? 844 : 900);
/*
 * `index.html` ships its CSP as a <meta> element, where Chromium ignores `frame-ancestors` and
 * logs this on every load. It is a deployment-header concern, not a UI error.
 */
const knownConsoleErrors = [
  "The Content Security Policy directive 'frame-ancestors' is ignored when delivered via a <meta> element.",
];

interface SweepScreen {
  name: string;
  open: (page: Page, language: Language) => Promise<void>;
  /** Checks the open overlay at the current width, if the screen has one. */
  overlay?: 'modal' | 'settings';
}

const signedInScreens: readonly SweepScreen[] = [
  {
    name: 'saved games',
    open: async (page, language) => {
      await page.goto('/');
      await expect(
        page.getByRole('heading', { name: translate(language, 'savedGames'), exact: true }),
      ).toBeVisible();
      await expect(page.locator('.game-card')).toHaveCount(fixtureSavedGames.length);
    },
  },
  {
    name: 'settings',
    overlay: 'settings',
    open: async (page, language) => {
      await page.goto('/');
      await expect(page.locator('.game-card')).toHaveCount(fixtureSavedGames.length);
      await page
        .getByRole('button', { name: translate(language, 'settings'), exact: true })
        .click();
      await expect(page.getByRole('dialog')).toBeVisible();
    },
  },
  {
    name: 'create game',
    open: async (page, language) => {
      await page.goto('/games/new');
      await expect(
        page.getByRole('heading', { name: translate(language, 'createLobby'), exact: true }),
      ).toBeVisible();
    },
  },
  { name: 'game', open: openGame },
  {
    name: 'banking dialog',
    overlay: 'modal',
    open: async (page) => {
      await openGame(page);
      await page.locator('button.wallet-card-active').click();
      await expect(page.getByRole('dialog')).toBeVisible();
    },
  },
  {
    name: 'profile',
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

const authScreen: SweepScreen = {
  name: 'auth',
  open: async (page, language) => {
    await page.goto('/');
    await expect(
      page.getByRole('heading', { name: translate(language, 'welcomeBack'), exact: true }),
    ).toBeVisible();
  },
};

async function openGame(page: Page): Promise<void> {
  await page.goto(`/games/${fixtureActiveGame.id}`);
  await expect(
    page.getByRole('heading', { name: fixtureActiveGame.name, exact: true }),
  ).toBeVisible();
  await expect(page.locator('.wallet-card')).toHaveCount(4);
}

/**
 * `body` clips horizontal overflow, so the document scroll width alone cannot see it. This also
 * lists visible elements that reach past the viewport without a clipping or scrolling ancestor.
 */
function measureOverflow(): { scrollWidth: number; clientWidth: number; escaping: string[] } {
  const root = document.documentElement;
  const viewport = root.clientWidth;
  const clipped = (element: Element): boolean => {
    for (let node = element.parentElement; node !== null && node !== document.body;) {
      if (/(auto|scroll|hidden|clip)/.test(getComputedStyle(node).overflowX)) return true;
      node = node.parentElement;
    }
    return false;
  };
  const escaping: string[] = [];
  for (const element of document.body.querySelectorAll('*')) {
    const rect = element.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue;
    if (getComputedStyle(element).visibility === 'hidden') continue;
    if ((rect.right <= viewport + 1 && rect.left >= -1) || clipped(element)) continue;
    const label = `${element.tagName.toLowerCase()}.${[...element.classList].slice(0, 2).join('.')}`;
    escaping.push(`${label} [${Math.round(rect.left)}, ${Math.round(rect.right)}]`);
  }
  return { scrollWidth: root.scrollWidth, clientWidth: viewport, escaping };
}

async function expectOverlayPresentation(
  page: Page,
  overlay: 'modal' | 'settings',
  width: number,
): Promise<void> {
  const panel = page.getByRole('dialog').locator('.dialog');
  const height = heightFor(width);
  await expect
    .poll(async () => {
      const box = await panel.boundingBox();
      if (box === null) return 'no panel';
      const right = width - (box.x + box.width);
      const bottom = height - (box.y + box.height);
      if (width < 768)
        return Math.abs(box.x) <= 1 && Math.abs(right) <= 1 && Math.abs(bottom) <= 1
          ? 'sheet'
          : `not a sheet: x=${box.x} right=${right} bottom=${bottom}`;
      if (overlay === 'settings')
        return box.width < width / 2 && bottom > 1 && right > 1
          ? 'anchored'
          : `not anchored: width=${box.width} right=${right} bottom=${bottom}`;
      return Math.abs(box.x - right) <= 1 && Math.abs(box.y - bottom) <= 1
        ? 'centred'
        : `not centred: x=${box.x} right=${right} top=${box.y} bottom=${bottom}`;
    })
    .toBe(width < 768 ? 'sheet' : overlay === 'settings' ? 'anchored' : 'centred');
}

async function sweep(page: Page, screen: SweepScreen, language: Language): Promise<void> {
  await page.setViewportSize({ width: widths[0], height: heightFor(widths[0]) });
  await screen.open(page, language);
  await page.evaluate(() => document.fonts.ready);
  for (const width of widths) {
    await page.setViewportSize({ width, height: heightFor(width) });
    if (screen.overlay !== undefined) await expectOverlayPresentation(page, screen.overlay, width);
    const overflow = await page.evaluate(measureOverflow);
    expect(
      overflow.scrollWidth,
      `${screen.name} @${width}: document scroll width`,
    ).toBeLessThanOrEqual(overflow.clientWidth);
    expect(overflow.escaping, `${screen.name} @${width}: elements past the viewport`).toEqual([]);
  }
}

for (const { id: visualStyle } of visualStyles) {
  for (const colorMode of colorModes) {
    for (const language of languages) {
      for (const signedIn of [true, false]) {
        const cases = signedIn ? signedInScreens : [authScreen];
        test(`sweep ${visualStyle} ${colorMode} ${language} ${signedIn ? 'signed in' : 'signed out'}`, async ({
          page,
        }) => {
          const errors: string[] = [];
          page.on('console', (message) => {
            const text = message.text();
            // Signed out, the harness answers `/api/profile` with the 401 that selects AuthPage.
            const expected401 = !signedIn && text.includes('status of 401');
            if (message.type() === 'error' && !knownConsoleErrors.includes(text) && !expected401)
              errors.push(text);
          });
          page.on('pageerror', (error) => errors.push(error.message));
          await prepareVisualPage(
            page,
            { visualStyle, colorMode, language },
            { authenticated: signedIn },
          );
          for (const screen of cases) await sweep(page, screen, language);
          expect(errors).toEqual([]);
        });
      }
    }
  }
}
