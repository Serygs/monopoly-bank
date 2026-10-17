import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildBoardSnapshot, getBoardPreset } from '../../../shared/board';
import type { GameProperty, Player } from '../../../shared/types/monopoly';
import { MonopolyBankApiError, monopolyBankApi } from '../../api/monopoly-bank-api';
import { LanguageProvider } from '../../i18n/LanguageProvider';
import { BankruptcyDialog } from './BankruptcyDialog';

const board = buildBoardSnapshot(getBoardPreset('monopoly-ru-2012'), 15_000_000);
const player = (id: string, name: string, balance: number): Player => ({
  id,
  gameId: 'g1',
  name,
  color: '#2563eb',
  balance,
  createdAt: '',
});
const ada = player('p1', 'Ada', 100_000);
const bo = player('p2', 'Bo', 1_000_000);
const row = (tileId: string, over: Partial<GameProperty> = {}): GameProperty => ({
  gameId: 'g1',
  tileId,
  ownerPlayerId: 'p1',
  mortgaged: false,
  houses: 0,
  ...over,
});
// Zhitna: two houses; Nagatinska: mortgaged. Houses cost 500_000 (250_000 back each).
const properties = [row('zhitna', { houses: 2 }), row('nagatinska', { mortgaged: true })];

afterEach(() => vi.restoreAllMocks());

function renderDialog(onOpenWallet = vi.fn()) {
  render(
    <LanguageProvider>
      <BankruptcyDialog
        gameId="g1"
        player={ada}
        players={[ada, bo]}
        board={board}
        properties={properties}
        currency="USD"
        onOpenWallet={onOpenWallet}
        onClose={vi.fn()}
        onCompleted={vi.fn()}
      />
    </LanguageProvider>,
  );
  return { user: userEvent.setup(), onOpenWallet };
}

async function reviewToBo(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: /Bo/ }));
  await user.click(screen.getByRole('button', { name: /review/i }));
}

describe('BankruptcyDialog with a board', () => {
  it('shows the properties that pass on, the buildings sold and the creditor fee', async () => {
    const { user } = renderDialog();
    await reviewToBo(user);
    expect(screen.getByText(/2 properties pass to Bo/)).toBeInTheDocument();
    expect(screen.getByText(/Buildings sold to the bank first: 2 for/)).toBeInTheDocument();
    expect(
      screen.getByText(/Bo pays the bank .* for the mortgaged properties/),
    ).toBeInTheDocument();
  });

  it('says the tiles return unmortgaged when the bank is the creditor', async () => {
    const { user } = renderDialog();
    await user.click(screen.getByRole('button', { name: /review/i }));
    expect(screen.getByText(/2 properties go back to the bank/)).toBeInTheDocument();
    expect(screen.queryByText(/pays the bank/)).not.toBeInTheDocument();
  });

  it('explains a creditor who cannot pay the fees and offers their wallet', async () => {
    vi.spyOn(monopolyBankApi, 'declareBankruptcy').mockRejectedValue(
      new MonopolyBankApiError({
        code: 'BANKRUPTCY_CREDITOR_SHORT',
        message: 'short',
        details: { creditorPlayerId: 'p2', required: 30_000, available: 10_000, shortfall: 20_000 },
      }),
    );
    const { user, onOpenWallet } = renderDialog();
    await reviewToBo(user);
    await user.click(screen.getByRole('button', { name: /confirm/i }));
    expect(await screen.findByText(/Bo cannot pay the mortgage fees/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Open Bo/ }));
    expect(onOpenWallet).toHaveBeenCalledWith(bo);
  });
});
