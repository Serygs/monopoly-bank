import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Loan, Player } from '../../../shared/types/monopoly';
import { LanguageProvider } from '../../i18n/LanguageProvider';
import { WalletCard } from './WalletCard';

const olena: Player = {
  id: 'p1',
  gameId: 'g',
  name: 'Olena',
  color: '#111',
  balance: 1000,
  createdAt: '',
};
const loan: Loan = {
  id: 'l1',
  gameId: 'g',
  lenderKind: 'PLAYER',
  lenderPlayerId: 'p1',
  borrowerPlayerId: 'p2',
  principal: 500,
  repaidAmount: 200,
  state: 'ACTIVE',
  createdAt: '',
  closedAt: null,
};

function renderCard(loans: Loan[]) {
  render(
    <LanguageProvider>
      <WalletCard
        player={olena}
        players={[olena]}
        currency="USD"
        active={false}
        gameActive
        loans={loans}
        onOpen={() => undefined}
      />
    </LanguageProvider>,
  );
}

describe('WalletCard loans', () => {
  it('shows what the player is owed, and nothing without loans', () => {
    renderCard([loan]);
    expect(screen.getByText('Is owed $300')).toBeInTheDocument();
    expect(screen.queryByText(/^Owes/)).toBeNull();
  });
  it('shows no debt line without loans', () => {
    renderCard([]);
    expect(screen.queryByText(/Is owed|Owes/)).toBeNull();
  });
});
