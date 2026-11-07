import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildBoardSnapshot, getBoardPreset } from '../../../shared/board';
import { buildGameSettings } from '../../../shared/domain/game-rules';
import { sellRefund } from '../../../shared/domain/property';
import {
  defaultGameRules,
  type Auction,
  type GameProperty,
  type Loan,
  type Player,
} from '../../../shared/types/monopoly';
import { MonopolyBankApiError, monopolyBankApi } from '../../api/monopoly-bank-api';
import { LanguageProvider } from '../../i18n/LanguageProvider';
import { formatMoney } from '../../utils/money';
import { BankingDialog, type BankingDialogProps } from './BankingDialog';

const board = buildBoardSnapshot(getBoardPreset('monopoly-ru-2012'), 100_000);
const tile = (id: string) => board.tiles.find((candidate) => candidate.id === id)!;
const refund = sellRefund(board, 'zhitna');
const usd = (value: number) => formatMoney(value, 'USD');
const settings = { ...buildGameSettings(15_000_000), board };

const player = (id: string, name: string, balance: number): Player => ({
  id,
  gameId: 'g1',
  name,
  color: '#2563eb',
  balance,
  createdAt: '',
});
const row = (tileId: string, houses = 0): GameProperty => ({
  gameId: 'g1',
  tileId,
  ownerPlayerId: 'p1',
  mortgaged: false,
  houses,
});
const taras = player('p2', 'Taras', 1_000_000);

/**
 * A stand-in for the Worker and the game page together: it applies sales and mortgages to its own
 * state and answers like the API, and the dialog gets the new state through `onFundsRaised`.
 */
function setup(
  balance: number,
  properties: GameProperty[],
  extra: Partial<BankingDialogProps> = {},
) {
  const server = { balance, rows: properties };
  const send = vi
    .spyOn(monopolyBankApi, 'createTransaction')
    .mockImplementation(async (_game, request) => {
      if (request.type === 'PROPERTY_SELL_BUILDING' && 'targets' in request)
        for (const [id, level] of Object.entries(request.targets ?? {})) {
          const current = server.rows.find((item) => item.tileId === id)!;
          server.balance += (current.houses - level) * refund;
          server.rows = server.rows.map((item) =>
            item.tileId === id ? { ...item, houses: level } : item,
          );
        }
      if (request.type === 'MORTGAGE' && 'tileId' in request) {
        server.balance += tile(request.tileId).mortgage;
        server.rows = server.rows.map((item) =>
          item.tileId === request.tileId ? { ...item, mortgaged: true } : item,
        );
      }
      if (request.type === 'LOAN_ISSUE') server.balance += request.amount;
      return {
        transaction: { amount: 1 },
        players: [player('p1', 'Olena', server.balance), taras],
        properties: server.rows,
      } as never;
    });
  const onFinished = vi.fn();
  const onCompleted = vi.fn();
  function Live() {
    const [state, setState] = useState({ balance, properties });
    const olena = player('p1', 'Olena', state.balance);
    return (
      <BankingDialog
        gameId="g1"
        player={olena}
        players={[olena, taras]}
        passGoReward={200_000}
        currency="USD"
        settings={settings}
        properties={state.properties}
        favoriteAmounts={[]}
        recentAmounts={[]}
        onToggleFavorite={vi.fn()}
        onClose={vi.fn()}
        onBankrupt={vi.fn()}
        onViewHistory={vi.fn()}
        onCompleted={onCompleted}
        onFundsRaised={(response) =>
          setState({
            balance: response.players[0]!.balance,
            properties: response.properties ?? state.properties,
          })
        }
        onFundsRaiseFinished={onFinished}
        onPaymentRequested={vi.fn()}
        {...extra}
      />
    );
  }
  render(
    <LanguageProvider>
      <Live />
    </LanguageProvider>,
  );
  return { user: userEvent.setup(), send, onFinished, onCompleted };
}

type User = ReturnType<typeof userEvent.setup>;

async function startPayment(user: User, amount: number) {
  await user.click(screen.getByRole('button', { name: 'Pay Bank' }));
  await user.click(screen.getByRole('button', { name: 'Whole units' }));
  await user.type(screen.getByRole('textbox', { name: 'Amount' }), String(amount));
}
async function openMenu(user: User, amount: number) {
  await startPayment(user, amount);
  await user.click(screen.getByRole('button', { name: 'Find funds' }));
}
const shown = (label: string) => screen.getByText(label).nextElementSibling;
const sellOne = (name: string) =>
  screen.getByRole('button', { name: `Remove a building from ${name}` });
const pick = (id: string) =>
  screen.getByRole('button', { name: new RegExp(`^${tile(id).name}`, 'u') });
const button = (name: string) => screen.getByRole('button', { name });
const amountShown = () =>
  (screen.getByRole('textbox', { name: 'Amount' }) as HTMLInputElement).value.replace(/\D/gu, '');

afterEach(() => vi.restoreAllMocks());

describe('Finding funds for a payment', () => {
  it('replaces the disabled review with a way to find the money, only while short', async () => {
    const { user } = setup(100_000, [row('riga_rail')]);
    await user.click(button('Pay Bank'));
    await user.click(button('Whole units'));
    const amount = screen.getByRole('textbox', { name: 'Amount' });
    await user.type(amount, '100000');
    expect(button('Review transaction')).toBeEnabled();
    await user.type(amount, '0');
    expect(screen.queryByRole('button', { name: 'Review transaction' })).toBeNull();
    expect(button('Find funds')).toBeEnabled();
    // Typing never opens the menu by itself.
    expect(screen.queryByText('Available now')).toBeNull();
  });

  it('shows the totals, updates them on every choice, and records everything in order', async () => {
    const { user, send, onFinished, onCompleted } = setup(100_000, [
      row('zhitna', 1),
      row('nagatinska', 1),
      row('riga_rail'),
    ]);
    const railway = tile('riga_rail').mortgage;
    const street = tile('zhitna').mortgage;
    const maximum = 2 * refund + 2 * street + railway;
    const payment = 100_000 + 2 * refund + railway;

    await startPayment(user, payment);
    await user.click(screen.getByRole('button', { name: /Add a comment/ }));
    await user.type(screen.getByRole('textbox', { name: 'Comment' }), 'Rent');
    await user.click(button('Find funds'));

    expect(shown('Available now')).toHaveTextContent(usd(100_000));
    expect(shown('Payment')).toHaveTextContent(usd(payment));
    expect(shown('Selected')).toHaveTextContent(usd(0));
    expect(shown('Balance after this')).toHaveTextContent(usd(100_000));
    expect(shown('Still short by')).toHaveTextContent(usd(payment - 100_000));
    expect(shown('If you sell and mortgage everything')).toHaveTextContent(usd(100_000 + maximum));
    expect(shown('Left after the payment then')).toHaveTextContent(
      usd(100_000 + maximum - payment),
    );
    expect(button('Review transaction')).toBeDisabled();
    // The streets cannot be mortgaged while their group has buildings.
    expect(screen.queryByRole('button', { name: new RegExp(`^${tile('zhitna').name}`, 'u') })).toBe(
      null,
    );

    await user.click(sellOne(tile('zhitna').name));
    expect(shown('Selected')).toHaveTextContent(usd(refund));
    await user.click(sellOne(tile('nagatinska').name));
    expect(shown('Selected')).toHaveTextContent(usd(2 * refund));
    expect(pick('zhitna')).toBeInTheDocument();

    await user.click(pick('riga_rail'));
    expect(shown('Selected')).toHaveTextContent(usd(2 * refund + railway));
    expect(shown('Balance after this')).toHaveTextContent(usd(payment));
    expect(shown('Left after the payment')).toHaveTextContent(usd(0));

    await user.click(button('Review transaction'));
    expect(shown('Source')).toHaveTextContent('Bank');
    expect(shown('Destination')).toHaveTextContent('Olena');
    expect(shown('Total')).toHaveTextContent(usd(2 * refund + railway));
    expect(screen.getByText(`Mortgage: ${tile('riga_rail').name}`)).toBeInTheDocument();
    expect(send).not.toHaveBeenCalled();

    await user.click(button('Confirm transaction'));
    expect(send.mock.calls.map((call) => call[1])).toEqual([
      {
        type: 'PROPERTY_SELL_BUILDING',
        playerId: 'p1',
        targets: { zhitna: 0, nagatinska: 0 },
      },
      { type: 'MORTGAGE', playerId: 'p1', tileId: 'riga_rail' },
    ]);
    expect(onFinished).toHaveBeenCalledOnce();
    expect(onFinished).toHaveBeenCalledWith(null);

    // Covered: back on the payment, with everything still filled in. It is not sent by itself.
    expect(amountShown()).toBe(String(payment));
    expect(screen.getByRole('textbox', { name: 'Comment' })).toHaveValue('Rent');
    expect(send).toHaveBeenCalledTimes(2);
    expect(onCompleted).not.toHaveBeenCalled();

    await user.click(button('Review transaction'));
    await user.click(button('Confirm transaction'));
    expect(send.mock.calls[2]?.[1]).toEqual({
      type: 'PLAYER_TO_BANK',
      playerId: 'p1',
      amount: payment,
      comment: 'Rent',
    });
    expect(onCompleted).toHaveBeenCalledOnce();
  });

  it('stays in the menu with the new totals while the payment is still not covered', async () => {
    const { user } = setup(100_000, [row('riga_rail'), row('zhitna'), row('nagatinska')]);
    const railway = tile('riga_rail').mortgage;
    const payment = 100_000 + railway + 1000;
    await openMenu(user, payment);
    await user.click(pick('riga_rail'));
    await user.click(button('Review transaction'));
    await user.click(button('Confirm transaction'));
    expect(shown('Available now')).toHaveTextContent(usd(100_000 + railway));
    expect(shown('Still short by')).toHaveTextContent(usd(1000));
    expect(shown('Selected')).toHaveTextContent(usd(0));
    expect(screen.queryByRole('button', { name: new RegExp(tile('riga_rail').name, 'u') })).toBe(
      null,
    );
  });

  it('keeps what was recorded when one operation fails, and retries only the rest', async () => {
    const { user, send } = setup(0, [row('riga_rail'), row('zhitna'), row('nagatinska')]);
    const real = send.getMockImplementation()!;
    let failed = false;
    send.mockImplementation(async (game, request, id) => {
      if (!failed && request.type === 'MORTGAGE' && 'tileId' in request) {
        if (request.tileId === 'riga_rail') {
          failed = true;
          throw new MonopolyBankApiError({ code: 'NETWORK_ERROR', message: 'x' });
        }
      }
      return real(game, request, id);
    });
    await openMenu(user, tile('riga_rail').mortgage + tile('zhitna').mortgage + 100);
    await user.click(pick('zhitna'));
    await user.click(pick('riga_rail'));
    await user.click(button('Review transaction'));
    await user.click(button('Confirm transaction'));

    // Back in the menu with the error; the street went through and the railway is still chosen.
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(shown('Available now')).toHaveTextContent(usd(tile('zhitna').mortgage));
    expect(shown('Selected')).toHaveTextContent(usd(tile('riga_rail').mortgage));
    const firstRailwayId = send.mock.calls[1]?.[2];

    await user.click(button('Review transaction'));
    await user.click(button('Confirm transaction'));
    expect(send).toHaveBeenCalledTimes(3);
    expect(send.mock.calls[2]?.[1]).toEqual({
      type: 'MORTGAGE',
      playerId: 'p1',
      tileId: 'riga_rail',
    });
    // The same operation keeps its id, so a lost response is not recorded twice.
    expect(send.mock.calls[2]?.[2]).toBe(firstRailwayId);
  });

  it('uses a new command id for the same sale made again', async () => {
    const properties = [row('zhitna', 2), row('nagatinska', 2)];
    const { user, send } = setup(0, properties);
    await openMenu(user, 100 * refund);
    for (const level of [1, 0]) {
      await user.click(button('−1 for the whole group'));
      await user.click(button('Review transaction'));
      await user.click(button('Confirm transaction'));
      expect(send.mock.lastCall?.[1]).toEqual({
        type: 'PROPERTY_SELL_BUILDING',
        playerId: 'p1',
        targets: { zhitna: level, nagatinska: level },
      });
    }
    expect(new Set(send.mock.calls.map((call) => call[2])).size).toBe(2);
  });

  it('blocks the review while selling is uneven, and says why', async () => {
    const { user } = setup(0, [row('zhitna', 2), row('nagatinska', 2)]);
    await openMenu(user, 100 * refund);
    await user.click(sellOne(tile('zhitna').name));
    await user.click(sellOne(tile('zhitna').name));
    expect(button('Review transaction')).toBeDisabled();
    expect(
      screen.getByText('Streets of a group may differ by at most one building.'),
    ).toBeInTheDocument();
  });

  it('goes back to the filled-in payment', async () => {
    const { user } = setup(0, [row('riga_rail')]);
    await openMenu(user, 500);
    await user.click(button('Back'));
    expect(amountShown()).toBe('500');
    expect(button('Find funds')).toBeEnabled();
  });

  it('counts a leading auction bid as money the player does not have', async () => {
    const auction: Auction = {
      id: 'a1',
      gameId: 'g1',
      lotName: 'Park Place',
      initiatorPlayerId: 'p2',
      state: 'ACTIVE',
      currentBid: 400,
      currentBidderId: 'p1',
      version: 3,
      startedAt: '2026-10-16T12:00:00.000Z',
      endsAt: '2026-10-16T12:00:30.000Z',
      serverTime: '2026-10-16T12:00:10.000Z',
      settledTransactionId: null,
    };
    const { user } = setup(1000, [row('riga_rail')], {
      auction,
      rules: { ...defaultGameRules, auctions: true },
    });
    await openMenu(user, 700);
    expect(shown('Available now')).toHaveTextContent(usd(600));
    expect(shown('Still short by')).toHaveTextContent(usd(100));
  });

  it('says so when a board game has nothing to sell or mortgage', async () => {
    const { user } = setup(0, []);
    await openMenu(user, 500);
    expect(screen.getByText(/no buildings to sell or properties to mortgage/)).toBeInTheDocument();
    expect(button('Review transaction')).toBeDisabled();
  });

  it('does not offer the menu for building, which is a choice rather than a payment', async () => {
    const { user } = setup(0, [row('zhitna'), row('nagatinska')]);
    await user.click(button('Build a house'));
    await user.click(button('+1 for the whole group'));
    expect(screen.getByText(/Short by/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Find funds' })).toBeNull();
    expect(button('Review transaction')).toBeDisabled();
  });
});

describe('Borrowing from the bank while finding funds', () => {
  const rules = { ...defaultGameRules, bankLoans: true };
  const limited = { ...settings, bankLoanMax: 1000 };
  const borrowName = /Borrow from the bank · up to/;

  it('is hidden without the rule', async () => {
    const { user } = setup(0, [row('riga_rail')]);
    await openMenu(user, 500);
    expect(screen.queryByRole('button', { name: borrowName })).toBeNull();
  });

  it('is hidden while a bank loan is active', async () => {
    const active = {
      id: 'l1',
      gameId: 'g1',
      lenderKind: 'BANK',
      lenderPlayerId: null,
      borrowerPlayerId: 'p1',
      principal: 400,
      repaidAmount: 0,
      state: 'ACTIVE',
      createdAt: '',
      closedAt: null,
      rounds: { round: 1, suggestedRatePercent: 0, overdue: false },
    } as Loan;
    const { user } = setup(0, [row('riga_rail')], { rules, settings: limited, loans: [active] });
    await openMenu(user, 500);
    expect(screen.queryByRole('button', { name: borrowName })).toBeNull();
  });

  it('fills in the shortfall, keeps the selection, and returns to the payment', async () => {
    const { user, send, onFinished } = setup(100, [row('riga_rail')], {
      rules,
      settings: limited,
    });
    await openMenu(user, 600);
    await user.click(pick('riga_rail'));
    await user.click(screen.getByRole('button', { name: borrowName }));

    expect(screen.getByText(/Your payment is short by/)).toBeInTheDocument();
    expect(amountShown()).toBe('500');
    await user.click(button('Back'));
    expect(pick('riga_rail')).toHaveAttribute('aria-pressed', 'true');

    await user.click(screen.getByRole('button', { name: borrowName }));
    await user.click(button('Review transaction'));
    await user.click(button('Confirm transaction'));
    expect(send.mock.calls[0]?.[1]).toEqual({
      type: 'LOAN_ISSUE',
      lenderKind: 'BANK',
      playerId: 'p1',
      amount: 500,
    });
    expect(onFinished).toHaveBeenCalledWith('BANK_LOAN');
    expect(amountShown()).toBe('600');
    expect(button('Review transaction')).toBeEnabled();
  });

  it('limits the filled-in amount to what the bank lends', async () => {
    const { user } = setup(0, [row('riga_rail')], { rules, settings: limited });
    await openMenu(user, 5000);
    await user.click(screen.getByRole('button', { name: borrowName }));
    expect(amountShown()).toBe('1000');
  });

  it('keeps the waiting payment through the cooldown warning', async () => {
    const { user } = setup(100, [row('riga_rail')], {
      rules,
      settings: limited,
      bankLoanCooldowns: [{ playerId: 'p1', roundsLeft: 2 }],
    });
    await openMenu(user, 600);
    await user.click(screen.getByRole('button', { name: borrowName }));
    await user.click(button('Review transaction'));
    await user.click(button('Borrow anyway'));
    await user.click(button('Confirm transaction'));
    expect(amountShown()).toBe('600');
  });
});

describe('Finding funds without a board', () => {
  it('shows the short totals and returns from the existing forms to the menu', async () => {
    const { user, send, onFinished } = setup(0, [], { settings: null, properties: [] });
    await openMenu(user, 500);
    expect(shown('Available now')).toHaveTextContent(usd(0));
    expect(shown('Still short by')).toHaveTextContent(usd(500));
    expect(screen.queryByText('If you sell and mortgage everything')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Review transaction' })).toBeNull();

    await user.click(button('Sell buildings to the bank'));
    expect(screen.getByText(/Your payment is short by/)).toBeInTheDocument();
    await user.click(button('Back'));
    expect(shown('Still short by')).toHaveTextContent(usd(500));

    await user.click(button('Mortgage property'));
    await user.click(screen.getByRole('textbox', { name: 'Property name' }));
    await user.paste('Boardwalk');
    await user.click(button('Whole units'));
    await user.type(screen.getByRole('textbox', { name: 'Amount' }), '200');
    await user.click(screen.getByRole('checkbox', { name: /no houses or hotels/i }));
    await user.click(button('Review transaction'));
    await user.click(button('Confirm transaction'));
    expect(send).toHaveBeenCalledOnce();
    expect(onFinished).toHaveBeenCalledWith('MORTGAGE');
    expect(screen.getByText('Available now')).toBeInTheDocument();
  });
});
