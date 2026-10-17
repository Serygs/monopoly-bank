import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { buildBoardSnapshot, getBoardPreset } from '../../../shared/board';
import type { GameProperty } from '../../../shared/types/monopoly';
import { LanguageProvider } from '../../i18n/LanguageProvider';
import { tileViews, type TileView } from '../../utils/property-view';
import { PropertyPicker } from './PropertyPicker';

const board = buildBoardSnapshot(getBoardPreset('monopoly-ru-2012'), 100_000);
const owned: GameProperty = {
  gameId: 'g',
  tileId: 'zhitna',
  ownerPlayerId: 'a',
  mortgaged: false,
  houses: 0,
};
const views = tileViews(board, [owned]).filter((view) =>
  ['zhitna', 'nagatinska', 'arbat', 'riga_rail'].includes(view.tile.id),
);
const items = [...views].reverse().map((view) => ({ view, caption: 'caption' }));

function renderPicker(props: Partial<Parameters<typeof PropertyPicker>[0]> = {}) {
  const onChange = vi.fn();
  render(
    <LanguageProvider>
      <PropertyPicker
        mode="single"
        legend="Choose"
        items={items}
        value=""
        onChange={onChange}
        currency="USD"
        {...(props as object)}
      />
    </LanguageProvider>,
  );
  return { onChange, user: userEvent.setup() };
}

describe('PropertyPicker', () => {
  it('lists free tiles first, owned last, with a header per colour group', () => {
    renderPicker();
    const sections = [...document.querySelectorAll('[data-section]')].map((el) =>
      el.getAttribute('data-section'),
    );
    expect(sections).toEqual(['free', 'owned']);
    const freeGroups = [...document.querySelectorAll('[data-section="free"] [data-group]')].map(
      (el) => el.getAttribute('data-group'),
    );
    expect(new Set(freeGroups).size).toBe(freeGroups.length);
    const owned = document.querySelector('[data-section="owned"]') as HTMLElement;
    expect(within(owned).getByRole('button', { name: /Zhitna|Житна/i })).toBeInTheDocument();
    expect(within(owned).getByRole('heading', { name: /Brown/ })).toHaveTextContent('$');
  });

  it('marks the chosen tile in single mode and reports a pick', async () => {
    const first = views[0]!.tile;
    const { onChange, user } = renderPicker({ value: first.id });
    const chosen = screen.getByRole('button', { name: new RegExp(first.name) });
    expect(chosen).toHaveAttribute('aria-pressed', 'true');
    const other = views[1]!.tile;
    await user.click(screen.getByRole('button', { name: new RegExp(other.name) }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ tile: other }));
  });

  it('toggles several tiles in multi mode and hides ineligible ones', async () => {
    const onToggle = vi.fn();
    const hidden = views[0]!.tile;
    const { user } = renderPicker({
      mode: 'multi',
      values: [views[1]!.tile.id],
      onToggle,
      eligible: (view: TileView) => view.tile.id !== hidden.id,
    } as never);
    expect(screen.queryByRole('button', { name: new RegExp(hidden.name) })).toBeNull();
    const picked = screen.getByRole('button', { name: new RegExp(views[1]!.tile.name) });
    expect(picked).toHaveAttribute('aria-pressed', 'true');
    await user.click(picked);
    expect(onToggle).toHaveBeenCalledOnce();
  });

  it('says so when nothing can be chosen', () => {
    renderPicker({ items: [] });
    expect(screen.getByText(/no properties|nothing/i)).toBeInTheDocument();
  });
});
