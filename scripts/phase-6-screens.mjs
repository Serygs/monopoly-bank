// One-off visual check for the board UI: signs in, creates a game on the classic
// board with a few deeds moved, then screenshots the property panel, the trade
// dialog and the board picker at 320px and 390px in both themes and languages,
// reporting any horizontal overflow. Usage: node scripts/phase-6-screens.mjs <baseURL> <outDir>
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from '@playwright/test';

const [baseURL = 'http://127.0.0.1:5199', outDir = 'reports/phase-6-screens'] = process.argv.slice(2);
await mkdir(outDir, { recursive: true });

const browser = await chromium.launch();
const setup = await browser.newContext({ baseURL });
const api = setup.request;
const uuid = () => crypto.randomUUID();
const nickname = `screens-${Date.now().toString(36)}`;
const registration = await api.post('/api/auth/register', { data: { nickname, avatar: '🎩', password: 'screens-pass-1' } });
if (!registration.ok()) throw new Error(`register failed: ${registration.status()} ${await registration.text()}`);
// The session cookie is Secure; over plain http the request context drops it, so it travels as an explicit header.
const sessionCookie = (registration.headers()['set-cookie'] ?? '').split(';')[0];
const [cookieName, cookieValue] = sessionCookie.split('=');
const cookies = [{ name: cookieName, value: cookieValue, domain: new URL(baseURL).hostname, path: '/', httpOnly: true, secure: false, sameSite: 'Lax' }];
const post = async (path, body) => { const response = await api.post(path, { data: body, headers: { cookie: sessionCookie, 'x-command-id': uuid() } }); if (!response.ok()) throw new Error(`${path} ${response.status()} ${await response.text()}`); return response.json(); };

const created = await post('/api/games', { name: 'Friday board', startingBalance: 1500, passGoReward: 200, currency: 'USD', paymentMode: 'FAST', boardId: 'board-classic', players: [{ name: 'Ada', color: '#d83f55' }, { name: 'Bob', color: '#2878d0' }, { name: 'Zoë', color: '#238b57' }] });
const gameId = created.data.game.id;
await post(`/api/games/${gameId}/start`, {});
// Only the owner's own wallet is controllable from this session, so every deed below is Ada's.
const details = await (await api.get(`/api/games/${gameId}`, { headers: { cookie: sessionCookie } })).json();
const adaId = details.data.controlledWallets[0].playerId;
for (const boardSpaceId of ['board-classic-space-01', 'board-classic-space-03', 'board-classic-space-05', 'board-classic-space-12', 'board-classic-space-37']) await post(`/api/games/${gameId}/properties/purchase`, { boardSpaceId, playerId: adaId });
await post(`/api/games/${gameId}/properties/build`, { boardSpaceId: 'board-classic-space-01', playerId: adaId, count: 1 });
await post(`/api/games/${gameId}/properties/build`, { boardSpaceId: 'board-classic-space-03', playerId: adaId, count: 1 });
await post(`/api/games/${gameId}/properties/mortgage`, { boardSpaceId: 'board-classic-space-12', playerId: adaId });
// Three doubles in a row put Ada in jail, so the badge and the bail button are on the screenshots.
for (let roll = 0; roll < 3; roll += 1) await post(`/api/games/${gameId}/dice-rolls`, { playerId: adaId, first: 6, second: 6 });
await setup.close();

const report = [];
for (const width of [320, 390]) {
  for (const theme of ['light', 'dark']) {
    for (const language of ['en', 'uk']) {
      const context = await browser.newContext({ baseURL, viewport: { width, height: 844 }, deviceScaleFactor: 2 });
      await context.addCookies(cookies);
      await context.addInitScript(([lang, mode]) => { window.localStorage.setItem('monopoly-bank-language', lang); window.localStorage.setItem('monopoly-bank-device-preferences', JSON.stringify({ theme: mode, sound: false, vibration: false })); }, [language, theme]);
      const page = await context.newPage();
      const tag = `${width}-${theme}-${language}`;
      const overflow = async (screen) => { const widths = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth, inner: window.innerWidth })); report.push({ screen, width, theme, language, scrollWidth: widths.scroll, innerWidth: widths.inner, horizontalScroll: widths.scroll > widths.inner }); };

      await page.goto(`/games/${gameId}`);
      await page.waitForSelector('[data-testid="property-panel"]');
      await page.locator('.property-free summary').click();
      await page.waitForTimeout(150);
      await page.locator('[data-testid="property-panel"]').scrollIntoViewIfNeeded();
      await page.screenshot({ path: join(outDir, `property-panel-${tag}.png`), fullPage: true });
      await overflow('property-panel');

      await page.locator('[data-testid="property-panel"] .deed-chip-button').first().click();
      await page.waitForSelector('[role="dialog"]');
      await page.screenshot({ path: join(outDir, `space-sheet-${tag}.png`) });
      await overflow('space-sheet');
      await page.keyboard.press('Escape');

      await page.locator('[data-testid="trade-inbox"] button').first().click();
      await page.waitForSelector('.trade-dialog');
      await page.locator('.trade-dialog .player-choice').first().click();
      await page.waitForSelector('.trade-sides');
      await page.locator('.trade-sides .deed-chip-button:not([disabled])').first().click();
      await page.screenshot({ path: join(outDir, `trade-dialog-${tag}.png`) });
      await overflow('trade-dialog');
      await page.keyboard.press('Escape');

      await page.goto('/games/new');
      await page.waitForSelector('[data-testid="board-picker"] .board-option');
      await page.locator('[data-testid="board-picker"] .board-option').nth(1).click();
      await page.locator('[data-testid="board-picker"]').scrollIntoViewIfNeeded();
      await page.screenshot({ path: join(outDir, `board-picker-${tag}.png`), fullPage: true });
      await overflow('board-picker');

      await page.getByRole('button', { name: /Create your own|Створити свою/u }).click();
      await page.waitForSelector('.custom-board-dialog .custom-board-group');
      await page.screenshot({ path: join(outDir, `custom-board-${tag}.png`) });
      await overflow('custom-board');
      await context.close();
    }
  }
}
await browser.close();
await writeFile(join(outDir, 'overflow-report.json'), JSON.stringify(report, null, 2));
const overflowing = report.filter((entry) => entry.horizontalScroll);
console.log(`${report.length} screens checked, ${overflowing.length} with horizontal scroll`);
for (const entry of overflowing) console.log(`  overflow: ${entry.screen} ${entry.width}px ${entry.theme} ${entry.language} scrollWidth=${entry.scrollWidth}`);
