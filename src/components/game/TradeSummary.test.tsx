import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { buildBoardSnapshot, getBoardPreset } from '../../../shared/board';
import type { GameProperty, Player } from '../../../shared/types/monopoly';
import { LanguageProvider } from '../../i18n/LanguageProvider';
import { tileViews } from '../../utils/property-view';
import { TradeSummary } from './TradeSummary';

const board = buildBoardSnapshot(getBoardPreset('monopoly-ru-2012'), 100_000);
const who = (id: string, name: string): Player => ({
  id,
  gameId: 'g',
  name,
  color: '#000',
  balance: 10_000,
  status: 'ACTIVE',
  createdAt: '',
});
const props: GameProperty[] = [
  { gameId: 'g', tileId: 'zhitna', ownerPlayerId: 'a', mortgaged: true, houses: 0 },
  { gameId: 'g', tileId: 'nagatinska', ownerPlayerId: 'b', mortgaged: false, houses: 0 },
];

function renderSummary(give: string[], take: string[], cashGive = 0, cashTake = 0) {
  const views = tileViews(board, props);
  render(
    <LanguageProvider>
      <TradeSummary
        board={board}
        currency="USD"
        proposer={who('a', 'Ada')}
        counterparty={who('b', 'Bo')}
        giveViews={views.filter((view) => give.includes(view.tile.id))}
        takeViews={views.filter((view) => take.includes(view.tile.id))}
        cashGive={cashGive}
        cashTake={cashTake}
      />
    </LanguageProvider>,
  );
}

describe('TradeSummary', () => {
  it('lists both sides, the mortgage fee of the receiver and the balances after', () => {
    renderSummary(['zhitna'], ['nagatinska']);
    expect(screen.getAllByRole('listitem').length).toBeGreaterThanOrEqual(4);
    expect(screen.getByText(/Bo pays the bank a 10% mortgage fee/)).toBeInTheDocument();
    expect(screen.queryByText(/gift/)).toBeNull();
  });

  it('names a gift when one side gives nothing', () => {
    renderSummary([], []);
    expect(screen.getAllByText('nothing').length).toBe(2);
  });

  it('says a gift is a gift when only one side gives', () => {
    renderSummary([], ['nagatinska']);
    expect(screen.getByText(/Ada receives this as a gift/)).toBeInTheDocument();
  });
});
