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

  it('lists every tile in All and filters from one popover', async () => {
    const { user } = renderScreen();
    await user.click(screen.getByRole('radio', { name: 'All' }));
    const tileButtons = () => [...document.querySelectorAll('[data-group] li')];
    expect(tileButtons()).toHaveLength(board.tiles.length);
    // Nothing is selected, so there are no chips and the button carries no count.
    expect(screen.queryByRole('button', { name: /^Remove filter/ })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Filters' }));
    const popover = screen.getByRole('group', { name: 'Filters' });
    await user.click(within(popover).getByRole('button', { name: 'Free' }));
    expect(tileButtons()).toHaveLength(board.tiles.length - 3);
    expect(screen.getByRole('button', { name: 'Filters (1)' })).toBeInTheDocument();

    await user.click(within(popover).getByRole('button', { name: 'Bo' }));
    expect(tileButtons()).toHaveLength(1);
    await user.click(within(popover).getByRole('button', { name: 'All' }));
    await user.click(within(popover).getByRole('button', { name: 'Brown' }));
    expect(tileButtons()).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Filters (1)' })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Remove filter Brown' }));
    expect(tileButtons()).toHaveLength(board.tiles.length);
    expect(screen.getByRole('button', { name: 'Filters' })).toBeInTheDocument();
  });

  it('lists free cards first, then owned ones, each by colour group from the cheapest', async () => {
    const { user } = renderScreen();
    await user.click(screen.getByRole('radio', { name: 'All' }));
    const headings = screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
    expect(headings).toEqual([`Free (${board.tiles.length - 3})`, 'Owned (3)']);
    const free = document.querySelector('[data-section="free"]')!;
    const groups = [...free.querySelectorAll('[data-group]')].map((el) =>
      el.getAttribute('data-group'),
    );
    // Brown has no free card here (both are owned), so the free section starts at light blue.
    expect(groups.slice(0, 3)).toEqual(['lightblue', 'pink', 'utility']);
    expect(groups.at(-1)).toBe('blue');
    // A free card shows its price and no Owned/Free badge.
    const firstFree = within(free as HTMLElement).getAllByRole('button')[0]!;
    expect(firstFree).toHaveTextContent(/\d/);
    expect(within(firstFree).queryByText('Free')).toBeNull();
  });

  it('pins each group header with an opaque fill and shows the Mine totals', () => {
    renderScreen();
    const header = screen.getByRole('heading', { name: /Brown/ });
    expect(header).toHaveClass('sticky', 'glass-popover', 'bg-surface-elevated');
    const stats = document.querySelector('[data-section="mine-stats"]')!;
    const cards = [name('zhitna'), name('riga_rail')].length;
    expect(within(stats as HTMLElement).getByText('Cards').nextSibling).toHaveTextContent(
      String(cards),
    );
    expect(within(stats as HTMLElement).getByText('Total value')).toBeInTheDocument();
  });

  it('shows the price range in each group header of the All view', async () => {
    const { user } = renderScreen();
    await user.click(screen.getByRole('radio', { name: 'All' }));
    const group = document.querySelector('[data-section="free"] [data-group="lightblue"]')!;
    expect(within(group as HTMLElement).getByRole('heading')).toHaveTextContent(/–/);
  });

  it('shows rent and owner inside an owned card', () => {
    renderScreen([row('zhitna')]);
    const card = screen.getByRole('button', { name: new RegExp(name('zhitna')) });
    expect(within(card).getByText('Ada')).toBeInTheDocument();
    expect(within(card).getByText(/^Rent:/)).toBeInTheDocument();
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

describe('PropertyScreen empty states', () => {
  it('says no cards match when the filters rule out every tile, and lists them again once cleared', async () => {
    const { user } = renderScreen();
    await user.click(screen.getByRole('radio', { name: 'All' }));
    expect(screen.queryByText('No cards match the filters.')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Filters' }));
    const popover = screen.getByRole('group', { name: 'Filters' });
    await user.click(within(popover).getByRole('button', { name: 'Free' }));
    await user.click(within(popover).getByRole('button', { name: 'Brown' }));
    expect(screen.getByText('No cards match the filters.')).toBeInTheDocument();
    expect(document.querySelectorAll('[data-group] li')).toHaveLength(0);
    await user.click(screen.getByRole('button', { name: 'Remove filter Brown' }));
    expect(screen.queryByText('No cards match the filters.')).toBeNull();
    expect(document.querySelectorAll('[data-group] li').length).toBeGreaterThan(0);
  });

  it('shows no empty message in the My cards view when the viewer owns something', () => {
    renderScreen();
    expect(screen.queryByText('You do not own any cards yet.')).toBeNull();
    expect(screen.queryByText('No cards match the filters.')).toBeNull();
  });

  it('keeps the empty My cards message out of the All view', async () => {
    const { user } = renderScreen([]);
    expect(screen.getByText('You do not own any cards yet.')).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: 'All' }));
    expect(screen.queryByText('You do not own any cards yet.')).toBeNull();
  });
});
