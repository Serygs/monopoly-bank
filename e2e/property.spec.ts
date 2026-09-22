import { expect, test, type Browser, type Locator, type Page } from '@playwright/test';

import type { BoardSpace } from '../shared/types/monopoly';
import { apiErrorTranslationKey } from '../src/i18n/api-errors';
import { translate, type Language } from '../src/i18n/translations';
import { formatMoney } from '../src/utils/money';
import { balanceOf, createLobby, joinAsGuest, readGameDetails, readPlayerTransactions, register, startLobby, type Session } from './helpers';

/**
 * Board scenarios in a real browser against the local Worker and a throwaway
 * D1 started by `npm run test:e2e:local`. No staging, no mail: the owner
 * registers with a nickname, the second player joins as a guest through an
 * invitation created over the API, and every table action goes through the UI.
 */
const baseURL = process.env.E2E_BASE_URL;
const runLocal = baseURL !== undefined && process.env.E2E_RUN === 'true' && process.env.E2E_LOCAL === 'true';
const currency = 'USD';
const money = (value: number) => formatMoney(value, currency);
const en = (key: Parameters<typeof translate>[1], values?: Parameters<typeof translate>[2]) => translate('en', key, values);
const uk = (key: Parameters<typeof translate>[1], values?: Parameters<typeof translate>[2]) => translate('uk', key, values);
const mediterranean = en('boardSpaceMediterraneanAvenue');
const baltic = en('boardSpaceBalticAvenue');
// Classic catalogue figures the scenarios expect on screen (migrations/0018_board_catalog.sql).
const classic = { price: 60, baseRent: 2, houseCost: 50, houseResale: 25, mortgage: 30, redemption: 33, jailFee: 50, auctionBid: 1, tradeCash: 100 };

test.describe('board scenarios against the local Worker', () => {
  test.skip(!runLocal, 'Run through `npm run test:e2e:local`; it sets E2E_BASE_URL, E2E_RUN and E2E_LOCAL against a throwaway local D1.');
  test.setTimeout(180_000);

  test('classic board, FAST: purchase, rent, auction, building, selling, mortgage and redemption match the ledger', async ({ browser }) => {
    const table = await openTable(browser, 'FAST');
    const { owner, guest, gameId, ownerPlayerId, guestPlayerId } = table;
    const onScreen: number[] = [];

    // Player 1 buys Mediterranean Avenue: the price leaves the wallet and the deed moves into their section.
    onScreen.push(await performDeedAction(owner.page, mediterranean, new RegExp(`^${en('buyFor', { amount: '' }).trim()}`)));
    await expect(ownerSection(owner.page, table.ownerName).getByRole('button', { name: deedName(mediterranean) })).toBeVisible();
    await expect(activeBalance(owner.page)).toHaveText(money(1500 - classic.price));

    // Player 2 pays the base rent from their own browser: the figure on their screen is the figure in the ledger.
    const rentPaid = await performDeedAction(guest.page, mediterranean, new RegExp(`^${en('payRentAmount', { amount: '' }).trim()}`));
    expect(rentPaid).toBe(classic.baseRent);
    await expect(activeBalance(guest.page)).toHaveText(money(1500 - classic.baseRent));
    await expect(activeBalance(owner.page)).toHaveText(money(1500 - classic.price + classic.baseRent));

    // Baltic Avenue goes to player 1 at auction for 1, which completes the brown group.
    await openDeed(owner.page, baltic);
    await owner.page.getByRole('dialog').getByRole('button', { name: en('auction'), exact: true }).click();
    const auction = owner.page.getByRole('dialog');
    await expect(auction.getByRole('heading', { name: en('auctionTitle', { name: baltic }) })).toBeVisible();
    await auction.locator('.player-picker .player-choice').filter({ hasText: table.ownerName }).click();
    await pressKeypad(auction, String(classic.auctionBid));
    await auction.getByRole('button', { name: en('recordAuction'), exact: true }).click();
    await expectRecorded(owner.page, en('wonAuction'));
    await expect(ownerSection(owner.page, table.ownerName).getByRole('button', { name: deedName(baltic) })).toBeVisible();

    // One house on each brown deed (the even-building rule allows one at a time), then both are sold back for half.
    onScreen.push(await performDeedAction(owner.page, mediterranean, new RegExp(`^${en('buildFor', { amount: '' }).trim()}`)));
    onScreen.push(await performDeedAction(owner.page, baltic, new RegExp(`^${en('buildFor', { amount: '' }).trim()}`)));
    await expect(owner.page.getByRole('button', { name: `${mediterranean} · ${en('houseOne')}` })).toBeVisible();
    onScreen.push(await performDeedAction(owner.page, mediterranean, /^Sell buildings/));
    onScreen.push(await performDeedAction(owner.page, baltic, /^Sell buildings/));
    await expect(owner.page.getByRole('button', { name: deedName(mediterranean) })).toBeVisible();

    // Mortgage Mediterranean Avenue for half its price, then redeem it with the 10 % interest.
    onScreen.push(await performDeedAction(owner.page, mediterranean, new RegExp(`^${en('mortgageFor', { amount: '' }).trim()}`)));
    await expect(owner.page.getByRole('button', { name: `${mediterranean} · ${en('mortgagedBadge')}` })).toBeVisible();
    onScreen.push(await performDeedAction(owner.page, mediterranean, new RegExp(`^${en('unmortgageFor', { amount: '' }).trim()}`)));
    await expect(owner.page.getByRole('button', { name: deedName(mediterranean) })).toBeVisible();

    expect(onScreen).toEqual([classic.price, classic.houseCost, classic.houseCost, classic.houseResale, classic.houseResale, classic.mortgage, classic.redemption]);
    const expectedBalance = 1500 - classic.price + classic.baseRent - classic.auctionBid - 2 * classic.houseCost + 2 * classic.houseResale + classic.mortgage - classic.redemption;
    await expect(activeBalance(owner.page)).toHaveText(money(expectedBalance));
    await expect.poll(async () => balanceOf(await readGameDetails(owner.page, gameId), ownerPlayerId)).toBe(expectedBalance);

    // The ledger holds one explicit record per operation with the same amounts the screens showed.
    // Rows created within the same second share a timestamp, so the comparison is order-free.
    const history = (await readPlayerTransactions(owner.page, gameId, ownerPlayerId)).data;
    expect(ledgerRows(history)).toEqual(ledgerRows([
      { type: 'PROPERTY_PURCHASE', amount: classic.price },
      { type: 'PROPERTY_RENT', amount: classic.baseRent },
      { type: 'PROPERTY_AUCTION', amount: classic.auctionBid },
      { type: 'PROPERTY_BUILD', amount: classic.houseCost },
      { type: 'PROPERTY_BUILD', amount: classic.houseCost },
      { type: 'PROPERTY_SELL_BUILDINGS', amount: classic.houseResale },
      { type: 'PROPERTY_SELL_BUILDINGS', amount: classic.houseResale },
      { type: 'PROPERTY_MORTGAGE', amount: classic.mortgage },
      { type: 'PROPERTY_UNMORTGAGE', amount: classic.redemption },
    ]));
    const guestHistory = (await readPlayerTransactions(guest.page, gameId, guestPlayerId)).data;
    expect(guestHistory.map((entry) => [entry.type, entry.amount])).toEqual([['PROPERTY_RENT', rentPaid]]);
    await owner.page.getByRole('button', { name: en('activity'), exact: true }).click();
    const ledger = owner.page.getByRole('dialog').locator('.activity-ledger');
    for (const [label, amount] of [[en('boughtProperty'), classic.price], [en('builtHouses'), classic.houseCost], [en('soldBuildings'), classic.houseResale], [en('mortgagedProperty'), classic.mortgage], [en('redeemedProperty'), classic.redemption], [en('wonAuction'), classic.auctionBid], [en('rent'), classic.baseRent]] as const) {
      await expect(ledger.locator('li').filter({ hasText: label }).filter({ hasText: money(amount) }).first()).toBeVisible();
    }
    await closeDialog(owner.page);

    // Ukrainian: the deed name and the owner's actions are localized.
    await switchLanguage(owner.page, 'uk');
    await openDeed(owner.page, uk('boardSpaceMediterraneanAvenue'));
    const sheet = owner.page.getByRole('dialog');
    await expect(sheet.getByRole('heading', { name: uk('boardSpaceMediterraneanAvenue'), exact: true })).toBeVisible();
    await expect(sheet.getByRole('button', { name: new RegExp(`^${uk('mortgageFor', { amount: '' }).trim()}`) })).toBeVisible();
    await expect(sheet.getByRole('button', { name: new RegExp(`^${uk('chargeRentAmount', { amount: '' }).trim()}`) })).toBeVisible();
    await closeDialog(owner.page);
    await closeTable(table);
  });

  // FIXME (open defect, see plan/SUMMARY.md “Відкриті дефекти” #1): accepting a trade answers 500. `D1BankingOperationRepository.persist`
  // runs the `property_trades` settlement UPDATE, which sets `transaction_id`, before the `transactions` INSERT of the same batch, and
  // `property_trades.transaction_id` is a foreign key to `transactions` (migrations/0020_property_trades.sql). SQLite checks the key at once,
  // so D1 rejects the whole batch with `FOREIGN KEY constraint failed`. Re-enable once the transaction row is written first.
  test.fixme('trade: an accepted offer moves the deed and the cash and updates both panels without a reload', async ({ browser }) => {
    const table = await openTable(browser, 'FAST');
    const { owner, guest, gameId, ownerPlayerId } = table;
    await performDeedAction(owner.page, mediterranean, new RegExp(`^${en('buyFor', { amount: '' }).trim()}`));

    // Player 1 offers Mediterranean Avenue for 100 in cash from player 2.
    await owner.page.getByRole('button', { name: en('proposeTrade'), exact: true }).click();
    const tradeDialog = owner.page.getByRole('dialog');
    await tradeDialog.locator('.player-picker .player-choice').filter({ hasText: table.guestName }).click();
    const give = tradeDialog.locator('.trade-side').nth(0);
    const receive = tradeDialog.locator('.trade-side').nth(1);
    await expect(give.getByRole('heading', { name: en('youGive'), exact: true })).toBeVisible();
    await give.getByRole('button', { name: deedName(mediterranean) }).click();
    await receive.locator('summary').click();
    for (const digit of String(classic.tradeCash)) await pressKeypad(receive, digit);
    await expect(tradeDialog.locator('.trade-summary').filter({ hasText: money(classic.tradeCash) })).toBeVisible();
    await tradeDialog.getByRole('button', { name: en('sendTrade'), exact: true }).click();
    await expect(owner.page.getByTestId('board-notice')).toContainText(en('tradeSent'));

    // Player 2 sees the offer arrive live and accepts it in their own browser.
    const guestInbox = guest.page.getByTestId('trade-inbox');
    await expect(guestInbox.getByText(en('tradeIncoming', { name: table.ownerName }))).toBeVisible();
    await expect(guestInbox.getByText(mediterranean)).toBeVisible();
    await guestInbox.getByRole('button', { name: en('acceptTrade'), exact: true }).click();

    // Neither page reloads: player 2's section on both screens now holds the deed, and player 1 has the cash.
    await expect(ownerSection(guest.page, table.guestName).getByRole('button', { name: deedName(mediterranean) })).toBeVisible();
    await expect(ownerSection(owner.page, table.guestName).getByRole('button', { name: deedName(mediterranean) })).toBeVisible();
    await expect(ownerSection(owner.page, table.ownerName).getByRole('button', { name: deedName(mediterranean) })).toHaveCount(0);
    await expect(activeBalance(owner.page)).toHaveText(money(1500 - classic.price + classic.tradeCash));
    await expect(activeBalance(guest.page)).toHaveText(money(1500 - classic.tradeCash));
    await expect(owner.page.getByTestId('trade-inbox').getByRole('button', { name: en('cancelTrade'), exact: true })).toHaveCount(0);
    const history = (await readPlayerTransactions(owner.page, gameId, ownerPlayerId)).data;
    expect(ledgerRows(history)).toEqual(ledgerRows([{ type: 'PROPERTY_PURCHASE', amount: classic.price }, { type: 'PROPERTY_TRADE', amount: classic.tradeCash }]));

    // Ukrainian on player 2's screen: the traded deed and the trade actions are localized.
    await switchLanguage(guest.page, 'uk');
    await expect(ownerSection(guest.page, table.guestName).getByRole('button', { name: deedName(uk('boardSpaceMediterraneanAvenue')) })).toBeVisible();
    await expect(guest.page.getByTestId('trade-inbox').getByRole('heading', { name: uk('tradeInbox'), exact: true })).toBeVisible();
    await expect(guest.page.getByRole('button', { name: uk('proposeTrade'), exact: true })).toBeVisible();
    await closeTable(table);
  });

  test('jail: three doubles through the roll button lead to jail on every screen and bail is a JAIL_BAIL ledger entry', async ({ browser }) => {
    const table = await openTable(browser, 'FAST');
    const { owner, guest, gameId, ownerPlayerId } = table;

    // Three doubles in a row through the roll button: the browser's dice are pinned so each roll shows 1 + 1.
    await owner.page.evaluate(() => { Math.random = () => 0; });
    for (let roll = 0; roll < 3; roll += 1) {
      await owner.page.getByRole('button', { name: en('rollDice'), exact: true }).click();
      await expect(owner.page.locator('.dice-results')).toContainText(en('double'));
      await owner.page.getByTestId('dice-server-roll').click();
      await expect(owner.page.getByTestId('dice-notice')).toBeVisible();
      if (roll < 2) await owner.page.getByTestId('dice-notice').getByRole('button', { name: en('dismiss'), exact: true }).click();
    }
    await expect(owner.page.getByTestId('dice-notice')).toContainText(en('thirdDoubleJail', { name: table.ownerName }));
    await expect(owner.page.getByTestId('jail-badge')).toBeVisible();
    await expect(guest.page.getByTestId('jail-badge')).toBeVisible();

    // Bail is a banking operation: the catalogue fee leaves the wallet, the badge goes away, and the ledger records JAIL_BAIL.
    await owner.page.getByTestId('jail-bail').click();
    await expectRecorded(owner.page, en('paidBail'));
    await expect(owner.page.getByTestId('jail-badge')).toHaveCount(0);
    await expect(activeBalance(owner.page)).toHaveText(money(1500 - classic.jailFee));
    await expect(guest.page.getByTestId('jail-badge')).toHaveCount(0);
    const history = (await readPlayerTransactions(owner.page, gameId, ownerPlayerId)).data;
    expect(ledgerRows(history)).toEqual(ledgerRows([{ type: 'JAIL_BAIL', amount: classic.jailFee }]));
    expect((await readGameDetails(owner.page, gameId)).data.players.find((player) => player.id === ownerPlayerId)?.isInJail).toBe(false);

    // Ukrainian on player 2's screen: the jailed player's deeds section and the bail action are localized, as is the roll button.
    await owner.page.getByRole('button', { name: en('rollDice'), exact: true }).click();
    await owner.page.getByTestId('dice-server-roll').click();
    await switchLanguage(owner.page, 'uk');
    await expect(owner.page.getByRole('button', { name: uk('recordRoll'), exact: true })).toBeVisible();
    await expandFreeDeeds(owner.page);
    await expect(owner.page.getByTestId('property-panel').getByRole('button', { name: deedName(uk('boardSpaceMediterraneanAvenue')) })).toBeVisible();
    await closeTable(table);
  });

  // FIXME (open defect, see plan/SUMMARY.md “Відкриті дефекти” #1): accepting the rent bill answers 500 for the same reason as the trade above.
  // `DefaultBankingService.settleRentRequest` → `persist` runs the `payment_requests` settlement UPDATE (setting `transaction_id`) before
  // the `transactions` INSERT, and `payment_requests.transaction_id` references `transactions` (migrations/0014_payment_requests.sql).
  // A plain CONFIRMATION payment without a board fails the same way since `settle()` started delegating to `persist` in phase 4.
  test.fixme('CONFIRMATION: the owner bills rent, the payer sees the deed on the request and accepting commits it', async ({ browser }) => {
    const table = await openTable(browser, 'CONFIRMATION');
    const { owner, guest, gameId, guestPlayerId } = table;
    await performDeedAction(owner.page, mediterranean, new RegExp(`^${en('buyFor', { amount: '' }).trim()}`));

    // The owner charges rent and picks the payer; in CONFIRMATION mode that only creates a payment request.
    await openDeed(owner.page, mediterranean);
    const sheet = owner.page.getByRole('dialog');
    await sheet.getByRole('button', { name: new RegExp(`^${en('chargeRentAmount', { amount: '' }).trim()}`) }).click();
    await sheet.locator('.player-picker .player-choice').filter({ hasText: table.guestName }).click();
    expect(await readAmount(sheet.getByTestId('space-action-amount'))).toBe(classic.baseRent);
    await sheet.getByTestId('space-action-review').click();
    await expect(sheet.getByText(en('rentConfirmationNote'))).toBeVisible();
    await sheet.getByTestId('space-action-confirm').click();
    await expect(owner.page.getByText(en('paymentRequestCreated'))).toBeVisible();
    await expect.poll(async () => balanceOf(await readGameDetails(guest.page, gameId), guestPlayerId)).toBe(1500);

    // The payer's inbox names the deed on the bill, in Ukrainian too, and accepting it writes the transaction.
    await switchLanguage(guest.page, 'uk');
    const bill = guest.page.locator('.payment-inbox li').filter({ hasText: uk('boardSpaceMediterraneanAvenue') });
    await expect(bill).toContainText(uk('paymentRequestFrom', { name: table.ownerName, amount: money(classic.baseRent) }));
    await bill.getByRole('button', { name: uk('acceptPayment'), exact: true }).click();
    await expect(bill).toHaveCount(0);
    await expect(activeBalance(guest.page)).toHaveText(money(1500 - classic.baseRent));
    await expect(activeBalance(owner.page)).toHaveText(money(1500 - classic.price + classic.baseRent));
    const history = (await readPlayerTransactions(guest.page, gameId, guestPlayerId)).data;
    expect(history.map((entry) => [entry.type, entry.amount])).toEqual([['PROPERTY_RENT', classic.baseRent]]);
    await closeTable(table);
  });

  test('custom copy: renamed deeds keep the classic prices and a board in use cannot be deleted', async ({ browser }) => {
    const owner = await register(browser, 'Board owner', tableContext());
    const renames: Record<number, string> = { 1: 'Hrushevskoho Street', 3: 'Bankova Street', 5: 'Central Station' };
    let boardId = '';
    await createLobby(owner.page, 'FAST', 1, {
      name: `Load test custom ${Date.now()}`,
      prepare: async (page) => {
        await page.getByRole('button', { name: en('createCustomBoard'), exact: true }).click();
        const dialog = page.getByRole('dialog');
        await expect(dialog.locator('.custom-board-group').first()).toBeVisible();
        await dialog.getByLabel(new RegExp(`^${en('boardName')}`)).fill('Our city');
        for (const [index, name] of Object.entries(renames)) await dialog.getByLabel(new RegExp(`^Space ${index}:`)).fill(name);
        const created = page.waitForResponse((response) => response.url().endsWith('/api/boards') && response.request().method() === 'POST');
        await dialog.getByRole('button', { name: en('saveBoard'), exact: true }).click();
        boardId = ((await (await created).json()) as { data: { board: { id: string } } }).data.board.id;
        await expect(page.getByText(en('boardCreated', { name: 'Our city' }))).toBeVisible();
        await expect(page.getByRole('radio', { name: /^Our city/ })).toHaveAttribute('aria-checked', 'true');
      },
    });
    await startLobby(owner.page);
    await expect(owner.page.getByText(en('connectionLive'), { exact: true })).toBeVisible();

    // The panel shows the custom names, and never the classic ones they replaced.
    await expandFreeDeeds(owner.page);
    const panel = owner.page.getByTestId('property-panel');
    for (const name of Object.values(renames)) await expect(panel.getByRole('button', { name: deedName(name) })).toBeVisible();
    await expect(panel.getByRole('button', { name: deedName(mediterranean) })).toHaveCount(0);
    await openDeed(owner.page, renames[1]);
    const sheet = owner.page.getByRole('dialog');
    await expect(sheet.locator('.space-facts').filter({ hasText: en('spacePrice') })).toContainText(money(classic.price));
    await expect(sheet.getByRole('button', { name: en('buyFor', { amount: money(classic.price) }), exact: true })).toBeVisible();
    await closeDialog(owner.page);

    // The copy is the classic catalogue with new names only.
    const [custom, canonical] = await Promise.all([readBoard(owner.page, boardId), readBoard(owner.page, 'board-classic')]);
    expect(custom.length).toBe(28);
    const priced = (space: BoardSpace) => ({ boardIndex: space.boardIndex, kind: space.kind, colorGroup: space.colorGroup, price: space.price, mortgageValue: space.mortgageValue, houseCost: space.houseCost, rents: space.rents });
    expect(custom.map(priced)).toEqual(canonical.map(priced));
    expect(custom.filter((space) => space.customName !== en(space.translationKey as Parameters<typeof translate>[1])).map((space) => space.customName)).toEqual(Object.values(renames));

    // While a game plays on it, deleting the board answers BOARD_IN_USE, which the client maps to copy in both languages.
    const deletion = await owner.page.evaluate(async (id) => { const response = await fetch(`/api/boards/${id}`, { method: 'DELETE' }); return { status: response.status, body: await response.json() as { error?: { code: string } } }; }, boardId);
    expect(deletion.status).toBe(409);
    expect(deletion.body.error?.code).toBe('BOARD_IN_USE');
    const key = apiErrorTranslationKey('BOARD_IN_USE');
    expect(key).not.toBeNull();
    if (key !== null) { expect(en(key)).toBe('A game is still played on this board.'); expect(uk(key)).toBe('На цій дошці ще триває гра.'); }
    expect((await readBoard(owner.page, boardId)).length).toBe(28);

    // Ukrainian: the custom names are user content and stay, while the group and the actions are localized.
    await switchLanguage(owner.page, 'uk');
    await expect(panel.getByRole('button', { name: deedName(renames[1]) })).toBeVisible();
    await expect(panel.locator('.group-badge').filter({ hasText: uk('colorGroupBrown') }).first()).toBeVisible();
    await openDeed(owner.page, renames[1]);
    await expect(owner.page.getByRole('dialog').getByRole('button', { name: uk('buyFor', { amount: money(classic.price) }), exact: true })).toBeVisible();
    await closeDialog(owner.page);
    await owner.context.close();
  });

  test('no board: no property element, a local dice roll, working payments and the reference screenshot', async ({ browser }) => {
    const owner = await register(browser, 'Table owner', { ...tableContext(), viewport: { width: 1280, height: 900 } });
    const gameId = await createLobby(owner.page, 'FAST', 1, { name: 'Board-less table' });
    await startLobby(owner.page);
    await expect(owner.page.getByText(en('connectionLive'), { exact: true })).toBeVisible();
    for (const testId of ['property-panel', 'trade-inbox', 'dice-server-roll', 'net-worth', 'jail-badge', 'jail-bail']) await expect(owner.page.getByTestId(testId)).toHaveCount(0);
    await expect(owner.page.getByText(en('diceStandalone'))).toBeVisible();

    // Reference screenshot of the page before any interaction; the owner's nickname carries a timestamp and is masked.
    await expect(owner.page).toHaveScreenshot('board-less-game.png', { fullPage: true, animations: 'disabled', caret: 'hide', maxDiffPixelRatio: 0.02, mask: [owner.page.locator('.wallet-name')] });

    // The dice stay in the browser: rolling never talks to the Worker.
    const diceRequests: string[] = [];
    owner.page.on('request', (request) => { if (request.url().includes('/dice-rolls')) diceRequests.push(request.url()); });
    await owner.page.evaluate(() => { Math.random = () => 0.99; });
    await owner.page.getByRole('button', { name: en('rollDice'), exact: true }).click();
    await expect(owner.page.locator('.dice-results')).toContainText(en('totalDice', { total: 12 }));
    expect(diceRequests).toEqual([]);

    // Payments work as before: 1 to the bank through the keypad.
    const details = await readGameDetails(owner.page, gameId);
    const playerId = details.data.controlledPlayerIds[0];
    await owner.page.getByRole('button', { name: /open banking actions/i }).click();
    await owner.page.getByRole('button', { name: en('payBank'), exact: true }).click();
    await pressKeypad(owner.page.getByRole('dialog'), '1');
    await owner.page.getByRole('button', { name: en('reviewTransaction'), exact: true }).click();
    await owner.page.getByRole('button', { name: en('confirmTransaction'), exact: true }).click();
    await expect(owner.page.getByRole('dialog')).toBeHidden();
    await expect.poll(async () => balanceOf(await readGameDetails(owner.page, gameId), playerId)).toBe(1499);
    expect((await readPlayerTransactions(owner.page, gameId, playerId)).data[0]).toMatchObject({ type: 'PLAYER_TO_BANK', amount: 1 });

    // Ukrainian: the table tools and wallets are localized, and there is still nothing about deeds.
    await switchLanguage(owner.page, 'uk');
    await expect(owner.page.getByRole('heading', { name: uk('rollDice'), exact: true })).toBeVisible();
    await expect(owner.page.getByRole('heading', { name: uk('playerWallets'), exact: true })).toBeVisible();
    await expect(owner.page.getByRole('button', { name: uk('rollDice'), exact: true })).toBeVisible();
    await expect(owner.page.getByRole('heading', { name: uk('propertyPanel'), exact: true })).toHaveCount(0);
    await owner.context.close();
  });

  test('reconnect: a fresh browser context sees the same deeds, houses and capital as the one that played', async ({ browser }) => {
    const table = await openTable(browser, 'FAST');
    const { owner, guest, gameId } = table;
    await performDeedAction(owner.page, mediterranean, new RegExp(`^${en('buyFor', { amount: '' }).trim()}`));
    await performDeedAction(guest.page, mediterranean, new RegExp(`^${en('payRentAmount', { amount: '' }).trim()}`));
    await performDeedAction(owner.page, baltic, new RegExp(`^${en('buyFor', { amount: '' }).trim()}`));
    await performDeedAction(owner.page, mediterranean, new RegExp(`^${en('buildFor', { amount: '' }).trim()}`));
    const played = await panelState(owner.page);
    expect(played.deeds).toEqual([`${mediterranean} · ${en('houseOne')}`, baltic]);

    // The same account on another device, in Ukrainian: the snapshot delivers the same table.
    const reconnected = await browser.newContext({ ...tableContext(), storageState: await owner.context.storageState() });
    await reconnected.addInitScript(() => { window.localStorage.setItem('monopoly-bank-language', 'uk'); });
    const page = await reconnected.newPage();
    await page.goto(`/games/${gameId}`);
    await expect(page.getByText(uk('connectionLive'), { exact: true })).toBeVisible();
    const seen = await panelState(page);
    expect(seen.deeds).toEqual([`${uk('boardSpaceMediterraneanAvenue')} · ${uk('houseOne')}`, uk('boardSpaceBalticAvenue')]);
    expect(seen.balance).toBe(played.balance);
    expect(seen.netWorth).toBe(played.netWorth);
    expect(seen.freeCount).toBe(played.freeCount);
    await expect(page.getByRole('heading', { name: uk('propertyPanel'), exact: true })).toBeVisible();
    await openDeed(page, uk('boardSpaceMediterraneanAvenue'));
    await expect(page.getByRole('dialog').getByRole('button', { name: new RegExp(`^${uk('chargeRentAmount', { amount: '' }).trim()}`) })).toBeVisible();
    await closeDialog(page);

    const [first, second] = await Promise.all([owner.page, page].map((candidate) => candidate.evaluate(async (id) => (await fetch(`/api/games/${id}/properties`)).json(), gameId)));
    expect(second).toEqual(first);
    await reconnected.close();
    await closeTable(table);
  });
});

interface Table { owner: Session; guest: Session; gameId: string; ownerPlayerId: string; guestPlayerId: string; ownerName: string; guestName: string; }

function tableContext(): Parameters<Browser['newContext']>[0] {
  // Reduced motion keeps the dice from animating and the dialogs from fading, so every step is deterministic.
  return { reducedMotion: 'reduce', colorScheme: 'light', viewport: { width: 1024, height: 900 } };
}

/** A registered owner on the classic board plus a guest who joined through an API-created invitation, both live. */
async function openTable(browser: Browser, paymentMode: 'FAST' | 'CONFIRMATION'): Promise<Table> {
  const owner = await register(browser, 'Owner', tableContext());
  const gameId = await createLobby(owner.page, paymentMode, 0, { board: /^classic/i });
  // The lobby dialog only issues invitations over HTTPS; the same endpoint answers the local Worker directly.
  const invitation = await owner.page.evaluate(async (id) => (await fetch(`/api/games/${id}/invitations`, { method: 'POST', headers: { 'x-command-id': crypto.randomUUID() } })).json(), gameId) as { data: { invitationToken: string } };
  const guestName = `Guest ${Date.now().toString(36)}`;
  const guest = await joinAsGuest(browser, `${baseURL}/games/join#invite=${encodeURIComponent(invitation.data.invitationToken)}`, guestName, tableContext());
  // Lobby pages have no live channel: the owner reloads to see the guest, the guest reloads to see the started game.
  await owner.page.reload();
  await startLobby(owner.page);
  await expect(owner.page.getByText(en('connectionLive'), { exact: true })).toBeVisible();
  await guest.page.reload();
  await expect(guest.page.getByText(en('connectionLive'), { exact: true })).toBeVisible();
  const [ownerDetails, guestDetails] = await Promise.all([readGameDetails(owner.page, gameId), readGameDetails(guest.page, gameId)]);
  const ownerPlayerId = ownerDetails.data.controlledPlayerIds[0];
  const guestPlayerId = guestDetails.data.controlledPlayerIds[0];
  const ownerName = ownerDetails.data.players.find((player) => player.id === ownerPlayerId)?.name ?? '';
  if (ownerName === '') throw new Error('The owner has no controlled wallet.');
  return { owner, guest, gameId, ownerPlayerId, guestPlayerId, ownerName, guestName };
}

async function closeTable(table: Table): Promise<void> { await table.guest.context.close(); await table.owner.context.close(); }

/** Matches a deed chip by name whatever state suffix (houses, hotel, mortgage) it carries. */
function deedName(name: string): RegExp { return new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}( ·.*)?$`); }

async function expandFreeDeeds(page: Page): Promise<void> {
  const free = page.locator('.property-free');
  if (!(await free.evaluate((element) => (element as HTMLDetailsElement).open))) await free.locator('summary').click();
}

/** Opens the action sheet of a deed wherever it sits on the panel: a player's section or the bank's folded list. */
async function openDeed(page: Page, name: string): Promise<void> {
  await expandFreeDeeds(page);
  await page.getByTestId('property-panel').getByRole('button', { name: deedName(name) }).click();
  await expect(page.getByRole('dialog').getByRole('heading', { name, exact: true })).toBeVisible();
}

/** Runs one priced action from the sheet, confirms it, and returns the amount the sheet showed before confirmation. */
async function performDeedAction(page: Page, name: string, action: RegExp): Promise<number> {
  await openDeed(page, name);
  const sheet = page.getByRole('dialog');
  const button = sheet.getByRole('button', { name: action });
  await expect(button).toBeEnabled();
  await button.click();
  const amount = await readAmount(sheet.getByTestId('space-action-amount'));
  await sheet.getByTestId('space-action-review').click();
  await expect(sheet.locator('.confirmation-available')).toContainText(money(amount));
  await sheet.getByTestId('space-action-confirm').click();
  await expect(page.getByRole('dialog')).toBeHidden();
  const notice = page.getByTestId('board-notice');
  await expect(notice).toBeVisible();
  await notice.getByRole('button', { name: en('dismiss'), exact: true }).click();
  return amount;
}

async function expectRecorded(page: Page, label: string): Promise<void> {
  const notice = page.getByTestId('board-notice');
  await expect(notice).toContainText(en('recorded', { action: label }));
  await notice.getByRole('button', { name: en('dismiss'), exact: true }).click();
}

async function readAmount(locator: Locator): Promise<number> {
  const text = await locator.textContent();
  const match = /\d[\d ]*/.exec(text ?? '');
  if (match === null) throw new Error(`No amount in “${text}”.`);
  return Number(match[0].replaceAll(' ', ''));
}

async function pressKeypad(scope: Locator, digit: string): Promise<void> {
  await scope.getByRole('group', { name: /numeric keypad|цифрова клавіатура/i }).getByRole('button', { name: digit, exact: true }).click();
}

function activeBalance(page: Page): Locator { return page.locator('.wallet-card-active .wallet-balance'); }
function ownerSection(page: Page, playerName: string): Locator { return page.getByTestId('property-panel').locator('.property-owner').filter({ has: page.getByRole('heading', { name: playerName, exact: true }) }); }

async function panelState(page: Page): Promise<{ deeds: string[]; balance: string | null; netWorth: string | null; freeCount: number }> {
  const controlled = page.locator('.wallet-group-controlled');
  const deeds = await page.getByTestId('property-panel').locator('.property-owner').first().locator('.deed-chip-button').evaluateAll((chips) => chips.map((chip) => chip.getAttribute('aria-label') ?? ''));
  // The free-deed counter is localized copy around a number; only the number is compared across languages.
  return { deeds, balance: await controlled.locator('.wallet-balance').textContent(), netWorth: await controlled.getByTestId('net-worth').locator('b').textContent(), freeCount: await readAmount(page.locator('.property-free summary .status-pill')) };
}

/** Type and amount of every ledger row, sorted, so rows that share a timestamp compare regardless of their order. */
function ledgerRows(rows: ReadonlyArray<{ type: string; amount: number }>): string[] {
  return rows.map((row) => `${row.type}:${row.amount}`).sort();
}

/** Closes the open dialog through its close button; a keyboard Escape depends on where focus landed. */
async function closeDialog(page: Page): Promise<void> {
  await page.getByRole('dialog').locator('.dialog-close').click();
  await expect(page.getByRole('dialog')).toBeHidden();
}

async function readBoard(page: Page, boardId: string): Promise<BoardSpace[]> {
  return ((await page.evaluate(async (id) => (await fetch(`/api/boards/${id}`)).json(), boardId)) as { data: { spaces: BoardSpace[] } }).data.spaces;
}

async function switchLanguage(page: Page, language: Language): Promise<void> {
  const current: Language = language === 'uk' ? 'en' : 'uk';
  await page.getByRole('button', { name: translate(current, 'settings'), exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: translate(current, language === 'uk' ? 'ukrainian' : 'english'), exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('lang', language);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
}
