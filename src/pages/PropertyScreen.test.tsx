import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { buildBoardSnapshot, getBoardPreset } from '../../shared/board';
import type { GameProperty, Player } from '../../shared/types/monopoly';
import { LanguageProvider } from '../i18n/LanguageProvider';
import { translate } from '../i18n/translations';
import { PropertyScreen } from './PropertyScreen';

const board = buildBoardSnapshot(getBoardPreset('monopoly-ru-2012'), 100_000);
const player = (id: string, name: string): Player => ({
  id,
  gameId: 'g',
  name,
  color: id === 'a' ? '#d83f55' : '#2878d0',
  balance: 1000,
  status: 'ACTIVE',
  createdAt: '',
});
const players = [player('a', 'Ada'), player('b', 'Bo')];
const row = (tileId: string, over: Partial<GameProperty> = {}): GameProperty => ({
  gameId: 'g',
  tileId,
  ownerPlayerId: 'a',
  mortgaged: false,
  houses: 0,
  ...over,
});
const properties = [
  row('zhitna'),
  row('nagatinska', { ownerPlayerId: 'b' }),
  row('riga_rail', { mortgaged: true }),
];
const name = (id: string) => board.tiles.find((tile) => tile.id === id)!.name;

function renderScreen(rows: GameProperty[] = properties) {
  return {
    user: userEvent.setup(),
    ...render(
      <LanguageProvider>
        <PropertyScreen
          board={board}
          properties={rows}
          players={players}
          currency="USD"
          controlledPlayerIds={['a']}
          onClose={() => {}}
        />
      </LanguageProvider>,
    ),
  };
}

describe('PropertyScreen', () => {
  it('groups my cards by colour with progress and a mortgaged badge', () => {
    renderScreen();
    const brown = screen.getByRole('heading', { name: /Brown/ }).closest('section')!;
    expect(within(brown).getByText('1/2')).toBeInTheDocument();
    expect(within(brown).queryByText('Monopoly')).toBeNull();
    expect(within(brown).getByRole('button', { name: new RegExp(name('zhitna')) })).toBeVisible();
    const railways = screen.getByRole('heading', { name: /Railways/ }).closest('section')!;
    expect(within(railways).getAllByText('Mortgaged').length).toBeGreaterThan(0);
    expect(screen.queryByText(name('nagatinska'))).toBeNull();
  });

  it('marks a monopoly when the viewer holds the whole group', () => {
    renderScreen([row('zhitna'), row('nagatinska')]);
    expect(screen.getByText('Monopoly')).toBeInTheDocument();
    expect(screen.getByText('2/2')).toBeInTheDocument();
  });

  it('shows an empty state when the viewer owns nothing', () => {
    renderScreen([]);
    expect(screen.getByText('You do not own any cards yet.')).toBeInTheDocument();
  });

  it('lists every tile in All and filters by free, player and group', async () => {
    const { user } = renderScreen();
    await user.click(screen.getByRole('radio', { name: 'All' }));
    const tileButtons = () =>
      screen.getAllByRole('listitem').filter((item) => item.querySelector('button'));
    expect(tileButtons()).toHaveLength(board.tiles.length);

    await user.click(screen.getByRole('button', { name: 'Free', pressed: false }));
    expect(tileButtons()).toHaveLength(board.tiles.length - 3);
    await user.click(screen.getByRole('button', { name: 'Free', pressed: true }));

    await user.click(screen.getByRole('button', { name: 'Bo' }));
    expect(tileButtons()).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Bo', pressed: true }));

    await user.click(screen.getByRole('button', { name: 'Brown' }));
    expect(tileButtons()).toHaveLength(2);
  });

  it('opens a read-only card with the current rent level highlighted', async () => {
    const { user } = renderScreen([row('zhitna'), row('nagatinska')]);
    await user.click(screen.getByRole('button', { name: new RegExp(name('zhitna')) }));
    const sheet = screen.getAllByRole('dialog').at(-1)!;
    const current = within(sheet)
      .getAllByRole('listitem')
      .filter((item) => item.getAttribute('aria-current') === 'true');
    expect(current).toHaveLength(1);
    expect(current[0]).toHaveTextContent('Full group, no houses');
    expect(within(sheet).queryByRole('button', { name: /mortgage|build|buy/i })).toBeNull();
  });
});

describe('property translations', () => {
  it('has Ukrainian copy for every property string', () => {
    for (const key of [
      'navProperty',
      'propertyTitle',
      'propertyMine',
      'boardSection',
      'walletProperty',
    ] as const)
      expect(translate('uk', key, { count: 1, value: '1' })).not.toBe(
        translate('en', key, { count: 1, value: '1' }),
      );
  });
});
