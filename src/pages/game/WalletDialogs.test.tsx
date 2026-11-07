import { render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { GameDetails } from '../../../shared/contracts/api';
import type { Player } from '../../../shared/types/monopoly';
import { FeedbackContext } from '../../components/ui/useFeedback';
import { LanguageProvider } from '../../i18n/LanguageProvider';
import type { BankingDialogProps } from './BankingDialog';
import type { GameContext } from './game-context';
import { WalletDialogs } from './WalletDialogs';

const dialog = vi.hoisted(() => ({ props: null as BankingDialogProps | null }));
vi.mock('./BankingDialog', () => ({
  BankingDialog: (props: BankingDialogProps) => {
    dialog.props = props;
    return null;
  },
}));

const player = (balance: number): Player => ({
  id: 'p1',
  gameId: 'g1',
  name: 'Olena',
  color: '#000000',
  balance,
  createdAt: '',
});

function setup(selected: Player, players: Player[]) {
  const setDetails = vi.fn();
  const setSelectedPlayer = vi.fn();
  const notify = vi.fn();
  const details = {
    game: { rules: {}, passGoReward: 200, currency: 'USD', startingBalance: 1500, settings: null },
    players,
  } as unknown as GameDetails;
  const ctx = {
    gameId: 'g1',
    details,
    view: { properties: [], board: null },
    preferences: { sound: false, vibration: false },
    setDetails,
    loadPaymentRequests: vi.fn(),
    dialogs: {
      wallet: {
        selectedPlayer: selected,
        setSelectedPlayer,
        bankruptPlayer: null,
        setBankruptPlayer: vi.fn(),
        walletIntent: null,
        settleLoanOnOpen: false,
      },
      prompts: { setAuctionPrompt: vi.fn(), setTradePrompt: vi.fn() },
      activity: { setScope: vi.fn(), setPlayerId: vi.fn(), setOpen: vi.fn() },
    },
  } as unknown as GameContext;
  render(
    <LanguageProvider>
      <FeedbackContext.Provider value={notify}>
        <WalletDialogs ctx={ctx} />
      </FeedbackContext.Provider>
    </LanguageProvider>,
  );
  return { setDetails, setSelectedPlayer, notify };
}

describe('WalletDialogs', () => {
  beforeEach(() => {
    dialog.props = null;
  });

  it('gives the dialog the current wallet, not the copy from when it opened', () => {
    setup(player(100), [player(900)]);
    expect(dialog.props?.player.balance).toBe(900);
  });

  it('falls back to the opened wallet if the game no longer lists it', () => {
    setup(player(100), []);
    expect(dialog.props?.player.balance).toBe(100);
  });

  it('applies raised funds and keeps the dialog open, with feedback only once at the end', () => {
    const { setDetails, setSelectedPlayer, notify } = setup(player(100), [player(100)]);
    dialog.props?.onFundsRaised({ players: [player(400)] });
    dialog.props?.onFundsRaised({ players: [player(700)] });
    expect(setDetails).toHaveBeenCalledTimes(2);
    const apply = setDetails.mock.calls[1]?.[0] as (current: GameDetails) => GameDetails;
    expect(apply({ players: [player(400)] } as GameDetails).players[0]?.balance).toBe(700);
    expect(notify).not.toHaveBeenCalled();

    dialog.props?.onFundsRaiseFinished(null);
    expect(notify).toHaveBeenCalledOnce();
    expect(notify).toHaveBeenCalledWith({ tone: 'success', message: 'Funds added.' });
    dialog.props?.onFundsRaiseFinished('MORTGAGE');
    expect(notify).toHaveBeenLastCalledWith({ tone: 'success', message: 'Property mortgaged.' });
    expect(setSelectedPlayer).not.toHaveBeenCalled();
  });
});
