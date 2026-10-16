import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { PaymentRequest } from '../../../shared/contracts/api';
import type { Player } from '../../../shared/types/monopoly';
import { LanguageProvider } from '../../i18n/LanguageProvider';
import { PaymentInbox } from './PaymentInbox';

const players: Player[] = [
  { id: 'p1', gameId: 'g', name: 'Olena', color: '#111', balance: 0, createdAt: '' },
  { id: 'p2', gameId: 'g', name: 'Taras', color: '#222', balance: 0, createdAt: '' },
];
const request = (kind: PaymentRequest['kind']): PaymentRequest => ({
  id: 'r1',
  kind,
  gameId: 'g',
  payerPlayerId: 'p2',
  recipientPlayerId: 'p1',
  creatorPlayerId: 'p1',
  approverPlayerId: 'p2',
  amount: 300,
  comment: null,
  state: 'PENDING',
  expiresAt: '2026-01-01T00:00:00.000Z',
  createdAt: '2026-01-01T00:00:00.000Z',
  resolvedAt: null,
  transactionId: null,
});

function renderInbox(kind: PaymentRequest['kind']) {
  render(
    <LanguageProvider>
      <PaymentInbox
        requests={[request(kind)]}
        players={players}
        currency="USD"
        onAction={vi.fn()}
      />
    </LanguageProvider>,
  );
}

describe('PaymentInbox', () => {
  it('words a loan request as a request to borrow', () => {
    renderInbox('LOAN');
    expect(screen.getByText('Olena asks to borrow $300 from you.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Lend' })).toBeInTheDocument();
  });
  it('keeps the payment wording for an ordinary request', () => {
    renderInbox('PAYMENT');
    expect(screen.getByText('Olena requests $300.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Accept' })).toBeInTheDocument();
  });
});
