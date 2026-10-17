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

describe('WalletCard bank loan', () => {
  const bankLoan: Loan = {
    ...loan,
    id: 'b1',
    lenderKind: 'BANK',
    lenderPlayerId: null,
    borrowerPlayerId: 'p1',
    principal: 400,
    repaidAmount: 0,
    rounds: { round: 3, suggestedRatePercent: 20, overdue: false },
  };

  it('shows the bank loan with its round, without an overdue badge', () => {
    renderCard([bankLoan]);
    expect(screen.getByText('Bank loan $400 · round 3')).toBeInTheDocument();
    expect(screen.queryByText('Overdue')).toBeNull();
    expect(screen.queryByText(/^Owes/)).toBeNull();
  });

  it('flags an overdue bank loan', () => {
    renderCard([{ ...bankLoan, rounds: { round: 4, suggestedRatePercent: 20, overdue: true } }]);
    expect(screen.getByText('Overdue')).toBeInTheDocument();
  });
});

describe('WalletCard own card', () => {
  it('tags the own card with a visible "You"', () => {
    render(
      <LanguageProvider>
        <WalletCard
          player={olena}
          players={[olena]}
          currency="USD"
          active
          gameActive
          onOpen={() => undefined}
        />
      </LanguageProvider>,
    );
    expect(screen.getByText('You')).toBeInTheDocument();
  });
});
