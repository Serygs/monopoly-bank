import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import type { DiceRoll as StoredDiceRoll } from '../../shared/contracts/api';
import type { Player } from '../../shared/types/monopoly';
import { monopolyBankApi } from '../api/monopoly-bank-api';
import { LanguageProvider } from '../i18n/LanguageProvider';
import { DiceRoller } from './DiceRoller';

function player(id: string, name: string): Player {
  return { id, gameId: 'g1', name, color: '#2563eb', balance: 1500, createdAt: '' };
}

const olena = player('p1', 'Olena');
const taras = player('p2', 'Taras');
const players = [olena, taras];

function stored(id: string, playerId: string, dieOne: number, dieTwo: number): StoredDiceRoll {
  return { id, playerId, dieOne, dieTwo, createdAt: '2026-10-15T10:00:00.000Z' };
}

function setup(rollerPlayerId: string | null = 'p1') {
  render(
    <LanguageProvider>
      <DiceRoller gameId="g1" players={players} rollerPlayerId={rollerPlayerId} />
    </LanguageProvider>,
  );
  return userEvent.setup();
}

describe('DiceRoller history', () => {
  let list: MockInstance<typeof monopolyBankApi.listDiceRolls>;
  let record: MockInstance<typeof monopolyBankApi.recordDiceRoll>;

  beforeEach(() => {
    // Reduced motion keeps the roll instant, without timers.
    window.matchMedia = ((query: string) => ({ matches: true, media: query })) as never;
    list = vi
      .spyOn(monopolyBankApi, 'listDiceRolls')
      .mockImplementation(async (_game, playerId) =>
        playerId === 'p1'
          ? [stored('a', 'p1', 6, 6), stored('b', 'p1', 2, 5)]
          : [stored('c', 'p2', 1, 3)],
      );
    record = vi
      .spyOn(monopolyBankApi, 'recordDiceRoll')
      .mockImplementation(async (_game, playerId, roll) =>
        stored(roll.id, playerId, roll.dieOne, roll.dieTwo),
      );
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("shows the roller's recent rolls with totals and doubles", async () => {
    setup();
    await screen.findByRole('img', { name: 'Rolled 6 and 6, total 12' });
    expect(screen.getByRole('img', { name: 'Rolled 2 and 5, total 7' })).toBeInTheDocument();
    expect(list).toHaveBeenCalledWith('g1', 'p1', 10);
    expect(screen.getByRole('button', { name: 'Olena' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Taras' })).toHaveAttribute('aria-pressed', 'false');
    const history = screen.getByRole('region', { name: 'Roll history' });
    expect(within(history).getAllByText('DOUBLE!')).toHaveLength(1);
  });

  it("switches to another player's history", async () => {
    const user = setup();
    await screen.findByRole('img', { name: 'Rolled 6 and 6, total 12' });
    await user.click(screen.getByRole('button', { name: 'Taras' }));
    await screen.findByRole('img', { name: 'Rolled 1 and 3, total 4' });
    expect(list).toHaveBeenCalledWith('g1', 'p2', 10);
    expect(screen.queryByRole('img', { name: 'Rolled 6 and 6, total 12' })).not.toBeInTheDocument();
  });

  it("records a roll for the controlled wallet and puts it first in that player's history", async () => {
    vi.spyOn(Math, 'random').mockReturnValueOnce(0.5).mockReturnValueOnce(0.9);
    const user = setup();
    await screen.findByRole('img', { name: 'Rolled 6 and 6, total 12' });

    await user.click(screen.getByRole('button', { name: 'Roll dice' }));

    expect(record).toHaveBeenCalledTimes(1);
    expect(record).toHaveBeenCalledWith(
      'g1',
      'p1',
      expect.objectContaining({
        dieOne: 4,
        dieTwo: 6,
        id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      }),
    );
    const first = (await screen.findAllByRole('img', { name: /^Rolled/ }))[0];
    expect(first).toHaveAccessibleName('Rolled 4 and 6, total 10');
  });

  it("returns to the roller's own history when rolling while viewing someone else", async () => {
    const user = setup();
    await screen.findByRole('img', { name: 'Rolled 6 and 6, total 12' });
    await user.click(screen.getByRole('button', { name: 'Taras' }));
    await screen.findByRole('img', { name: 'Rolled 1 and 3, total 4' });

    await user.click(screen.getByRole('button', { name: 'Roll dice' }));

    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Olena' })).toHaveAttribute('aria-pressed', 'true'),
    );
    expect(record).toHaveBeenCalledWith('g1', 'p1', expect.anything());
  });

  it('keeps rolls local when the viewer controls no wallet', async () => {
    const user = setup(null);
    await screen.findByRole('img', { name: 'Rolled 6 and 6, total 12' });
    await user.click(screen.getByRole('button', { name: 'Roll dice' }));
    expect(record).not.toHaveBeenCalled();
    expect(screen.getByText(/^Total \d+$/)).toBeInTheDocument();
  });

  it('says so when a roll could not be saved, without losing the roll', async () => {
    record.mockRejectedValueOnce(new Error('offline'));
    const user = setup();
    await screen.findByRole('img', { name: 'Rolled 6 and 6, total 12' });
    await user.click(screen.getByRole('button', { name: 'Roll dice' }));
    expect(
      await screen.findByText('This roll could not be saved to the history.'),
    ).toBeInTheDocument();
    expect(screen.getByText(/^Total \d+$/)).toBeInTheDocument();
  });

  it('says so when the history cannot be loaded', async () => {
    list.mockRejectedValue(new Error('offline'));
    setup();
    expect(await screen.findByText('Could not load the roll history.')).toBeInTheDocument();
  });

  it('shows an empty state for a player without rolls', async () => {
    list.mockResolvedValue([]);
    setup();
    expect(await screen.findByText('No rolls yet.')).toBeInTheDocument();
  });

  describe('paging', () => {
    const many = (count: number) =>
      Array.from({ length: count }, (_, index) => stored(`r${index}`, 'p1', 1 + (index % 6), 2));
    const rows = () =>
      within(screen.getByRole('region', { name: 'Roll history' })).getAllByRole('listitem');

    it('shows the latest 3 rolls with a date and time, then 10 more per click', async () => {
      list.mockImplementation(async (_game, _player, limit) => many(30).slice(0, limit));
      const user = setup();
      await screen.findAllByRole('listitem');
      expect(rows()).toHaveLength(3);
      expect(rows()[0].querySelector('time')?.textContent).toMatch(/\d.*\d/);
      await user.click(screen.getByRole('button', { name: 'Show more' }));
      await waitFor(() => expect(rows()).toHaveLength(13));
      expect(list).toHaveBeenLastCalledWith('g1', 'p1', 13);
    });

    it('hides Show more when the player has nothing beyond what is shown', async () => {
      list.mockImplementation(async () => many(2));
      setup();
      await screen.findAllByRole('listitem');
      expect(screen.queryByRole('button', { name: 'Show more' })).toBeNull();
    });

    it('stops at 100 rolls', async () => {
      list.mockImplementation(async (_game, _player, limit) => many(150).slice(0, limit));
      const user = setup();
      await screen.findAllByRole('listitem');
      for (let click = 0; click < 10; click += 1) {
        await user.click(await screen.findByRole('button', { name: 'Show more' }));
        await waitFor(() => expect(rows().length).toBeGreaterThan(3));
      }
      await waitFor(() => expect(rows()).toHaveLength(100));
      expect(screen.queryByRole('button', { name: 'Show more' })).toBeNull();
      expect(list).toHaveBeenLastCalledWith('g1', 'p1', 100);
    });
  });
});
