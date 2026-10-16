import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { MonopolyBankApiError, monopolyBankApi } from '../../api/monopoly-bank-api';
import { LanguageProvider } from '../../i18n/LanguageProvider';
import { StartAuctionDialog } from './StartAuctionDialog';

const olena = { id: 'p1', gameId: 'g1', name: 'Olena', color: '#000', balance: 1, createdAt: '' };

function renderDialog(initialLotName?: string) {
  const onStarted = vi.fn();
  render(
    <LanguageProvider>
      <StartAuctionDialog
        gameId="g1"
        initiator={olena}
        {...(initialLotName === undefined ? {} : { initialLotName })}
        onClose={vi.fn()}
        onStarted={onStarted}
      />
    </LanguageProvider>,
  );
  return { onStarted, user: userEvent.setup() };
}

describe('StartAuctionDialog', () => {
  it('needs a lot name, then starts the auction for the wallet', async () => {
    const startAuction = vi
      .spyOn(monopolyBankApi, 'startAuction')
      .mockResolvedValue({ auction: null });
    const { user, onStarted } = renderDialog();
    const start = screen.getByRole('button', { name: 'Start auction' });
    expect(start).toBeDisabled();
    await user.type(screen.getByRole('textbox', { name: 'Property or lot' }), '  Park   Place ');
    await user.click(start);
    expect(startAuction).toHaveBeenCalledWith(
      'g1',
      { initiatorPlayerId: 'p1', lotName: 'Park Place' },
      expect.any(String),
    );
    expect(onStarted).toHaveBeenCalledWith({ auction: null });
    startAuction.mockRestore();
  });

  it('prefills the suggested name and explains a refusal', async () => {
    const startAuction = vi
      .spyOn(monopolyBankApi, 'startAuction')
      .mockRejectedValue(
        new MonopolyBankApiError({ code: 'AUCTION_ALREADY_ACTIVE', message: 'x' }),
      );
    const { user } = renderDialog('Boardwalk');
    expect(screen.getByRole('textbox', { name: 'Property or lot' })).toHaveValue('Boardwalk');
    await user.click(screen.getByRole('button', { name: 'Start auction' }));
    expect(await screen.findByText('An auction is already running.')).toBeInTheDocument();
    startAuction.mockRestore();
  });
});
