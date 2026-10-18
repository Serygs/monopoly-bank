import { describe, expect, it } from 'vitest';
import type { GameDetails, PaymentRequest } from '../../../shared/contracts/api';
import { defaultGameRules, type Player } from '../../../shared/types/monopoly';
import { deriveGameView } from './game-view';

const player = (id: string, status: Player['status'] = 'ACTIVE'): Player => ({
  id,
  gameId: 'g',
  name: id,
  color: '#126247',
  balance: 100,
  status,
  createdAt: '',
});
const request = (id: string, approver: string, kind: PaymentRequest['kind']): PaymentRequest => ({
  id,
  kind,
  gameId: 'g',
  payerPlayerId: approver,
  recipientPlayerId: 'a',
  creatorPlayerId: 'a',
  approverPlayerId: approver,
  amount: 5,
  comment: null,
  state: 'PENDING',
  expiresAt: '',
  createdAt: '',
  resolvedAt: null,
  transactionId: null,
});
const details = (overrides: Partial<GameDetails> = {}): GameDetails => ({
  game: {
    id: 'g',
    name: 'Game',
    startingBalance: 1500,
    passGoReward: 200,
    currency: 'USD',
    paymentMode: 'FAST',
    rules: defaultGameRules,
    settings: null,
    status: 'ACTIVE',
    createdAt: '',
    updatedAt: '',
  },
  players: [player('a'), player('b', 'BANKRUPT'), player('c')],
  controlledPlayerIds: ['a', 'c'],
  controlledWallets: [
    { playerId: 'a', kind: 'PRIMARY' },
    { playerId: 'c', kind: 'LOCAL' },
  ],
  ...overrides,
});
const input = (d: GameDetails, extra: Partial<Parameters<typeof deriveGameView>[0]> = {}) => ({
  details: d,
  paymentRequests: [],
  liveTransactions: [],
  seededTransactions: [],
  activeWalletId: null,
  offline: false,
  ...extra,
});

describe('deriveGameView', () => {
  it('falls back to the first controlled wallet when the chosen one is not controlled', () => {
    expect(deriveGameView(input(details())).activeWallet?.id).toBe('a');
    expect(deriveGameView(input(details(), { activeWalletId: 'c' })).activeWallet?.id).toBe('c');
    expect(deriveGameView(input(details(), { activeWalletId: 'b' })).activeWallet?.id).toBe('a');
  });

  it('lists the other players with bankrupt ones last', () => {
    const view = deriveGameView(
      input(details({ players: [player('b', 'BANKRUPT'), ...details().players] })),
    );
    expect(view.otherPlayers.map((other) => other.id)).toEqual(['c', 'b', 'b']);
  });

  it('only allows changes in an active, online game and hides the nav in the lobby', () => {
    expect(deriveGameView(input(details())).canMutate).toBe(true);
    expect(deriveGameView(input(details(), { offline: true })).canMutate).toBe(false);
    const lobby = details();
    lobby.game.status = 'LOBBY';
    const view = deriveGameView(input(lobby));
    expect(view).toMatchObject({ canMutate: false, showNav: false });
  });

  it('shows only loan requests in the inbox outside confirmation mode', () => {
    const requests = [request('r1', 'a', 'PAYMENT'), request('r2', 'a', 'LOAN')];
    const fast = deriveGameView(input(details(), { paymentRequests: requests }));
    expect(fast.inboxRequests.map((item) => item.id)).toEqual(['r2']);
    const confirmation = details();
    confirmation.game.paymentMode = 'CONFIRMATION';
    const all = deriveGameView(input(confirmation, { paymentRequests: requests }));
    expect(all.inboxRequests.map((item) => item.id)).toEqual(['r1', 'r2']);
  });

  it('keeps only the loans of a rule that is switched on', () => {
    const loan = (lenderKind: 'BANK' | 'PLAYER') =>
      ({ lenderKind, borrowerPlayerId: 'a' }) as unknown as NonNullable<
        GameDetails['loans']
      >[number];
    const d = details({ loans: [loan('BANK'), loan('PLAYER')] });
    d.game.rules = { ...defaultGameRules, bankLoans: true };
    expect(deriveGameView(input(d)).visibleLoans.map((item) => item.lenderKind)).toEqual(['BANK']);
  });
});
