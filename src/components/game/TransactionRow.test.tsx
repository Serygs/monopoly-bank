import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Player, Transaction } from '../../../shared/types/monopoly';
import { formatMoney, formatMoneyDelta } from '../../utils/money';
import { transactionAmount, transactionDescription } from '../../utils/transaction-history';
import { TransactionRow } from './TransactionRow';

const players: Player[] = [
  { id: 'p1', gameId: 'g1', name: 'Alice', color: '#d83f55', balance: 0, createdAt: '' },
  { id: 'p2', gameId: 'g1', name: 'Bob', color: '#2878d0', balance: 0, createdAt: '' },
];

const payment: Transaction = {
  id: 't1',
  gameId: 'g1',
  type: 'PLAYER_TO_PLAYER',
  amount: 250_000,
  totalAmount: 250_000,
  comment: 'Rent on Boardwalk',
  createdAt: '2026-09-28T12:00:00.000Z',
  participants: [
    { playerId: 'p1', balanceDelta: -250_000 },
    { playerId: 'p2', balanceDelta: 250_000 },
  ],
};

function renderRow(props: Partial<Parameters<typeof TransactionRow>[0]> = {}) {
  return render(
    <ol>
      <TransactionRow
        transaction={payment}
        players={players}
        currency="USD"
        language="en"
        locale="en-US"
        {...props}
      />
    </ol>,
  );
}

describe('TransactionRow', () => {
  it('renders the ledger row with description, amount, time and comment', () => {
    const { container } = renderRow();
    expect(screen.getByText(transactionDescription(payment, players, 'en'))).toBeInTheDocument();
    expect(screen.getByText(transactionAmount(payment, 'USD', 'en'))).toBeInTheDocument();
    expect(screen.getByText('Rent on Boardwalk').tagName).toBe('EM');
    expect(container.querySelector('.activity-transaction time')).not.toBeNull();
  });

  it('shows a player-scoped signed balance change in the history variant', () => {
    const { container } = renderRow({ variant: 'history', playerId: 'p1' });
    const amount = screen.getByText(formatMoneyDelta(-250_000, 'USD'));
    expect(amount).toHaveClass('player-history-amount');
    expect(amount.textContent?.startsWith('\u2212')).toBe(true);
    expect(container.querySelector('.activity-transaction')).toBeNull();
  });

  it('shows a positive change for the receiving player', () => {
    renderRow({ variant: 'history', playerId: 'p2' });
    expect(screen.getByText(`+${formatMoney(250_000, 'USD')}`)).toBeInTheDocument();
  });

  it('shows the transaction amount in the unscoped history variant', () => {
    renderRow({ variant: 'history' });
    const amount = screen.getByText(transactionAmount(payment, 'USD', 'en'));
    expect(amount).not.toHaveClass('player-history-amount');
  });

  it.each(['income', 'expense'] as const)('exposes the %s tone on the row', (tone) => {
    renderRow({ tone });
    expect(screen.getByRole('listitem')).toHaveAttribute('data-tone', tone);
  });

  it('omits the tone attribute unless a tone is given', () => {
    renderRow();
    expect(screen.getByRole('listitem')).not.toHaveAttribute('data-tone');
  });

  it('never renders a tile id when the board has no such tile', () => {
    const purchase: Transaction = {
      ...payment,
      id: 't2',
      type: 'PROPERTY_PURCHASE',
      tileId: 'rostovska',
      comment: null,
      participants: [{ playerId: 'p1', balanceDelta: -250_000 }],
    };
    const { container } = renderRow({ transaction: purchase, board: null });
    expect(container.textContent).not.toContain('rostovska');
  });

  it('renders the compact row with a signed amount, the time only and the note', () => {
    const { container } = renderRow({ variant: 'compact', playerId: 'p1' });
    const amount = screen.getByText(formatMoneyDelta(-250_000, 'USD'));
    expect(amount).toHaveClass('text-danger', 'tabular-nums');
    expect(container.textContent).toContain('Rent on Boardwalk');
    expect(container.textContent).not.toMatch(/2026|Sep/);
    expect(screen.getByRole('listitem')).toHaveAttribute('data-tone', 'expense');
  });

  it('says there is no surcharge for a trade without cash', () => {
    const trade: Transaction = {
      ...payment,
      id: 't3',
      type: 'PROPERTY_TRANSFER',
      amount: 0,
      totalAmount: 0,
      comment: null,
      participants: [
        { playerId: 'p1', balanceDelta: 0 },
        { playerId: 'p2', balanceDelta: 0 },
      ],
    };
    renderRow({ variant: 'compact', transaction: trade, playerId: 'p1' });
    expect(screen.getByText('no surcharge')).toBeInTheDocument();
  });
});
