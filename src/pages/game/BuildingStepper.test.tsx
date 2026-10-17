import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { buildBoardSnapshot, getBoardPreset } from '../../../shared/board';
import type { GameProperty } from '../../../shared/types/monopoly';
import { LanguageProvider } from '../../i18n/LanguageProvider';
import { tileViews } from '../../utils/property-view';
import { BuildingStepper } from './BuildingStepper';

const board = buildBoardSnapshot(getBoardPreset('monopoly-ru-2012'), 100_000);
const row = (tileId: string, over: Partial<GameProperty> = {}): GameProperty => ({
  gameId: 'g',
  tileId,
  ownerPlayerId: 'a',
  mortgaged: false,
  houses: 0,
  ...over,
});
const houseCost = board.tiles.find((tile) => tile.id === 'zhitna')!.houseCost!;

function Harness({ properties, balance }: { properties: GameProperty[]; balance: number }) {
  const [levels, setLevels] = useState<Record<string, number>>({});
  return (
    <LanguageProvider>
      <BuildingStepper
        board={board}
        views={tileViews(board, properties)}
        playerId="a"
        mode="BUILD"
        groups={['brown']}
        group="brown"
        onGroupChange={() => {}}
        levels={levels}
        onLevelsChange={setLevels}
        balance={balance}
        currency="USD"
      />
    </LanguageProvider>
  );
}

const rowOf = (id: string) => document.querySelector(`[data-tile="${id}"]`) as HTMLElement;

describe('BuildingStepper', () => {
  it('shows current to target per street with its cost, the total and the balance after', async () => {
    const user = userEvent.setup();
    render(<Harness properties={[row('zhitna'), row('nagatinska')]} balance={100_000} />);
    const zhitna = rowOf('zhitna');
    await user.click(within(zhitna).getByRole('button', { name: /^Add a building/ }));
    expect(zhitna).toHaveTextContent('No buildings → 1 house');
    expect(zhitna).toHaveTextContent(/Cost:/);
    expect(rowOf('nagatinska')).toHaveTextContent('No buildings');
    expect(rowOf('nagatinska')).not.toHaveTextContent('→');
    expect(screen.getByText('Total cost').nextSibling).toHaveTextContent(String(houseCost / 1000));
  });

  it('highlights the street that breaks even building with its own reason, keeping the totals', async () => {
    const user = userEvent.setup();
    render(<Harness properties={[row('zhitna'), row('nagatinska')]} balance={100_000} />);
    const add = within(rowOf('zhitna')).getByRole('button', { name: /^Add a building/ });
    await user.click(add);
    await user.click(add);
    expect(rowOf('zhitna').querySelector('[aria-invalid="true"]')).not.toBeNull();
    expect(rowOf('zhitna')).toHaveTextContent(/Too many buildings compared/);
    expect(rowOf('nagatinska').querySelector('[aria-invalid]')).toBeNull();
    expect(document.getElementById('building-reason')).toHaveTextContent(
      /differ by at most one building/,
    );
    // Two buildings are still priced while the plan is invalid.
    expect(screen.getByText('Buildings').nextSibling).toHaveTextContent('2');
  });

  it('names the mortgaged street when the group has one', async () => {
    const user = userEvent.setup();
    render(
      <Harness
        properties={[row('zhitna'), row('nagatinska', { mortgaged: true })]}
        balance={100_000}
      />,
    );
    await user.click(within(rowOf('zhitna')).getByRole('button', { name: /^Add a building/ }));
    expect(rowOf('nagatinska')).toHaveTextContent('This street is mortgaged');
  });
});
