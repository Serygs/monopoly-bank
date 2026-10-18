import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildBoardSnapshot, getBoardPreset } from '../../../shared/board';
import { declareBankruptcy } from '../../../shared/domain/banking';
import { buildGameSettings } from '../../../shared/domain/game-rules';
import { defaultGameRules, type GameProperty, type Player } from '../../../shared/types/monopoly';
import { MonopolyBankApiError, monopolyBankApi } from '../../api/monopoly-bank-api';
import { LanguageProvider } from '../../i18n/LanguageProvider';
import { formatMoney } from '../../utils/money';
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

describe('BankruptcyDialog preview matches what the domain writes', () => {
  const players = [
    { ...ada, balance: 100_000 },
    { ...bo, balance: 10_000_000_000 },
  ];
  const scenarios: Array<[string, GameProperty[]]> = [
    ['no property at all', []],
    ['one mortgaged tile', [row('nagatinska', { mortgaged: true })]],
    ['two houses on one street and a mortgaged tile', properties],
    ['a hotel', [row('zhitna', { houses: 5 }), row('nagatinska', { houses: 5 })]],
    [
      'several mortgaged tiles of different values',
      [
        row('zhitna', { mortgaged: true }),
        row('varshavske', { mortgaged: true }),
        row('arbat', { mortgaged: true }),
        row('ogarova'),
      ],
    ],
    [
      'buildings on three streets',
      [
        row('varshavske', { houses: 1 }),
        row('ogarova', { houses: 3 }),
        row('persha_parkova', { houses: 2 }),
      ],
    ],
    [
      'a tile of another player',
      [row('zhitna', { ownerPlayerId: 'p2', houses: 3 }), row('arbat', { mortgaged: true })],
    ],
  ];
  const money = (value: number) => formatMoney(value, 'USD');

  const domain = (registry: GameProperty[], creditorPlayerId?: string) =>
    declareBankruptcy({
      game: {
        id: 'g1',
        name: 'G',
        startingBalance: 15_000_000,
        passGoReward: 2_000_000,
        currency: 'USD',
        paymentMode: 'FAST',
        rules: defaultGameRules,
        settings: buildGameSettings(15_000_000, 'monopoly-ru-2012'),
        status: 'ACTIVE',
        createdAt: '',
        updatedAt: '',
      },
      players,
      playerId: 'p1',
      ...(creditorPlayerId === undefined ? {} : { creditorPlayerId }),
      property: { board, registry },
    });

  const open = (registry: GameProperty[]) => {
    render(
      <LanguageProvider>
        <BankruptcyDialog
          gameId="g1"
          player={players[0] as Player}
          players={players}
          board={board}
          properties={registry}
          currency="USD"
          onClose={vi.fn()}
          onCompleted={vi.fn()}
        />
      </LanguageProvider>,
    );
    return userEvent.setup();
  };

  it.each(scenarios)(
    'shows the proceeds and the creditor fee the domain computes for %s',
    async (_label, registry) => {
      const written = domain(registry, 'p2');
      const mine = registry.filter((item) => item.ownerPlayerId === 'p1');
      const wallet = written.transaction.totalAmount;
      const proceeds = mine.length === 0 && wallet === 100_000 ? 0 : wallet - 100_000;
      const creditorDelta =
        written.affectedPlayers.find((change) => change.player.id === 'p2')?.balanceDelta ?? 0;
      const fee = wallet - creditorDelta;

      const user = open(registry);
      await user.click(screen.getByRole('button', { name: /Bo/ }));
      await user.click(screen.getByRole('button', { name: /review/i }));

      const buildings = mine.reduce((sum, item) => sum + item.houses, 0);
      if (mine.length === 0) {
        expect(screen.queryByText(/properties pass to/)).not.toBeInTheDocument();
        return;
      }
      if (buildings > 0)
        expect(
          screen.getByText(
            `Buildings sold to the bank first: ${buildings} for ${money(proceeds)}, added to the wallet.`,
          ),
        ).toBeInTheDocument();
      else expect(screen.queryByText(/Buildings sold to the bank first/)).not.toBeInTheDocument();
      if (fee > 0)
        expect(
          screen.getByText(`Bo pays the bank ${money(fee)} for the mortgaged properties.`),
        ).toBeInTheDocument();
      else expect(screen.queryByText(/pays the bank/)).not.toBeInTheDocument();
    },
  );

  it.each(scenarios)(
    'shows the same proceeds and no fee when the bank is the creditor for %s',
    async (_label, registry) => {
      const written = domain(registry);
      const mine = registry.filter((item) => item.ownerPlayerId === 'p1');
      const proceeds = written.transaction.totalAmount - 100_000;
      const user = open(registry);
      await user.click(screen.getByRole('button', { name: /review/i }));
      const buildings = mine.reduce((sum, item) => sum + item.houses, 0);
      if (buildings > 0)
        expect(
          screen.getByText(
            `Buildings sold to the bank first: ${buildings} for ${money(proceeds)}, added to the wallet.`,
          ),
        ).toBeInTheDocument();
      expect(screen.queryByText(/pays the bank/)).not.toBeInTheDocument();
    },
  );

  it('counts a hotel as five buildings sold at the refund of each', async () => {
    const written = domain([row('zhitna', { houses: 5 }), row('nagatinska', { houses: 5 })], 'p2');
    expect(written.transaction.totalAmount).toBe(100_000 + 10 * 37_500_000);
  });
});
