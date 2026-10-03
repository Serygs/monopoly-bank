import { expect, test } from '@playwright/test';
import type { UserProfile } from '../shared/contracts/api';
import { translate } from '../src/i18n/translations';

const profile: UserProfile = {
  id: 'user',
  nickname: 'Bsenkiv',
  avatar: '🎩',
  accountType: 'REGISTERED',
  email: null,
  emailVerified: false,
  gamesPlayed: 0,
  gamesWon: 0,
  gamesLost: 0,
  winRate: 0,
  createdAt: '2026-10-03T00:00:00Z',
  updatedAt: '2026-10-03T00:00:00Z',
};

test.describe('session recovery with mocked API boundaries', () => {
  test.skip(
    process.env.E2E_BASE_URL === undefined,
    'Set E2E_BASE_URL to a local server. All API calls are intercepted.',
  );

  for (const language of ['en', 'uk'] as const) {
    for (const failure of ['server', 'network'] as const) {
      test(`${language}: ${failure} failure offers retry without sign-in`, async ({ page }) => {
        await page.addInitScript((language) => {
          localStorage.setItem('monopoly-bank-language', language);
          localStorage.setItem(
            'monopoly-bank-device-preferences',
            JSON.stringify({
              visualStyle: language === 'uk' ? 'liquid-glass' : 'classic-bank',
              colorMode: language === 'uk' ? 'dark' : 'light',
            }),
          );
        }, language);
        if (language === 'uk') await page.setViewportSize({ width: 390, height: 844 });
        let available = false;
        await page.route('**/api/**', async (route) => {
          const path = new URL(route.request().url()).pathname;
          if (!path.startsWith('/api/')) return route.continue();
          if (path === '/api/profile') {
            if (available) return route.fulfill({ json: { data: profile } });
            if (failure === 'network') return route.abort('failed');
            return route.fulfill({
              status: 500,
              json: { error: { code: 'INTERNAL_ERROR', message: 'Internal error' } },
            });
          }
          return route.fulfill({ json: { data: [] } });
        });
        await page.goto('/');
        await expect(page.getByRole('alert')).toBeVisible();
        await expect(
          page.getByRole('button', { name: translate(language, 'signIn'), exact: true }),
        ).toHaveCount(0);
        available = true;
        await page
          .getByRole('button', { name: translate(language, 'tryAgain'), exact: true })
          .click();
        await expect(
          page.getByRole('button', { name: new RegExp(profile.nickname) }),
        ).toBeVisible();
      });
    }
  }

  test('confirmed expiry allows sign-in and retains the requested route', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('monopoly-bank-language', 'en'));
    let authenticated = false;
    await page.route('**/api/**', async (route) => {
      const path = new URL(route.request().url()).pathname;
      if (!path.startsWith('/api/')) return route.continue();
      if (path === '/api/auth/login') {
        authenticated = true;
        return route.fulfill({ json: { data: profile } });
      }
      if (path === '/api/profile')
        return route.fulfill(
          authenticated
            ? { json: { data: profile } }
            : {
                status: 401,
                json: { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } },
              },
        );
      return route.fulfill({ json: { data: [] } });
    });
    await page.goto('/profile');
    await page.getByLabel(translate('en', 'nickname'), { exact: true }).fill('Bsenkiv');
    await page.getByLabel(translate('en', 'password'), { exact: true }).fill('secure-password');
    await page.getByRole('button', { name: translate('en', 'signIn'), exact: true }).click();
    await expect(page).toHaveURL(/\/profile$/);
    await expect(
      page.getByRole('heading', { name: translate('en', 'playerProfile'), exact: true }),
    ).toBeVisible();
  });
});
