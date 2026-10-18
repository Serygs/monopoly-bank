import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

describe('PaymentInbox outgoing loan requests', () => {
  it('shows who the borrower is waiting for and cancels the request', async () => {
    const onAction = vi.fn().mockResolvedValue(undefined);
    const outgoing = { ...request('LOAN'), creatorPlayerId: 'p2', approverPlayerId: 'p1' };
    render(
      <LanguageProvider>
        <PaymentInbox
          requests={[]}
          outgoing={[outgoing]}
          players={players}
          currency="USD"
          onAction={onAction}
        />
      </LanguageProvider>,
    );
    expect(screen.getByText('Waiting for Olena to lend $300.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Lend' })).toBeNull();
    await userEvent.setup().click(screen.getByRole('button', { name: 'Cancel request' }));
    expect(onAction).toHaveBeenCalledWith(outgoing, 'cancel');
  });
});

describe('PaymentInbox empty state', () => {
  const empty = (requests: PaymentRequest[], outgoing: PaymentRequest[] = []) =>
    render(
      <LanguageProvider>
        <PaymentInbox
          requests={requests}
          outgoing={outgoing}
          players={players}
          currency="USD"
          onAction={vi.fn()}
        />
      </LanguageProvider>,
    );

  it('says there are no payment requests and shows a zero count', () => {
    empty([]);
    expect(screen.getByText('No payment requests waiting for you.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Payment inbox' }).nextSibling).toHaveTextContent(
      '0',
    );
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
  });

  it('does not say it when there is a request to answer', () => {
    empty([request('PAYMENT')]);
    expect(screen.queryByText('No payment requests waiting for you.')).not.toBeInTheDocument();
    expect(screen.getByRole('list')).toBeInTheDocument();
  });

  it('does not say it when only the viewer’s own loan request is waiting', () => {
    empty([], [{ ...request('LOAN'), creatorPlayerId: 'p2', approverPlayerId: 'p1' }]);
    expect(screen.queryByText('No payment requests waiting for you.')).not.toBeInTheDocument();
  });
});
