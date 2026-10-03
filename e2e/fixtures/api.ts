/**
 * Deterministic API responses for the visual-regression harness (e2e/visual).
 *
 * Every constant is typed from the shared contracts, so a contract change breaks these fixtures
 * at compile time instead of silently drifting from what the Worker returns. Amounts are
 * positive safe integers in whole currency units; timestamps are fixed so screenshots never
 * depend on the clock.
 */
import type {
  ActivityPage,
  GameDetails,
  GameSummary,
  LedgerStatistics,
  PaymentRequest,
  UserProfile,
} from '../../shared/contracts/api.js';
import type { Game, Player, Transaction } from '../../shared/types/monopoly.js';

const createdAt = '2026-09-20T08:00:00.000Z';

export const fixtureProfile: UserProfile = {
  id: 'visual-user',
  nickname: 'Olena Banker',
  avatar: '🎩',
  accountType: 'REGISTERED',
  email: null,
  emailVerified: false,
  gamesPlayed: 24,
  gamesWon: 11,
  gamesLost: 13,
  winRate: 0.46,
  createdAt,
  updatedAt: '2026-09-21T09:30:00.000Z',
};

export const fixtureActiveGame: Game = {
  id: 'visual-active-game',
  name: 'Friday Night Monopoly',
  startingBalance: 15_000_000,
  passGoReward: 2_000_000,
  currency: 'USD',
  paymentMode: 'FAST',
  status: 'ACTIVE',
  createdAt,
  updatedAt: '2026-09-21T10:15:00.000Z',
  startedAt: '2026-09-20T08:05:00.000Z',
  finishedAt: null,
};

const fixtureLobbyGame: Game = {
  id: 'visual-lobby-game',
  name: 'Weekend Rematch',
  startingBalance: 15_000_000,
  passGoReward: 2_000_000,
  currency: 'EUR',
  paymentMode: 'CONFIRMATION',
  status: 'LOBBY',
  createdAt: '2026-09-19T18:00:00.000Z',
  updatedAt: '2026-09-19T18:00:00.000Z',
  startedAt: null,
  finishedAt: null,
};

const fixtureFinishedGame: Game = {
  id: 'visual-finished-game',
  name: 'Summer Championship',
  startingBalance: 1_500,
  passGoReward: 200,
  currency: 'UAH',
  paymentMode: 'FAST',
  status: 'FINISHED',
  createdAt: '2026-08-02T12:00:00.000Z',
  updatedAt: '2026-08-02T15:40:00.000Z',
  startedAt: '2026-08-02T12:05:00.000Z',
  finishedAt: '2026-08-02T15:40:00.000Z',
};

export const fixturePlayers: Player[] = [
  {
    id: 'player-olena',
    gameId: fixtureActiveGame.id,
    name: 'Olena',
    color: '#d83f55',
    balance: 18_750_000,
    status: 'ACTIVE',
    userId: fixtureProfile.id,
    createdAt,
  },
  {
    id: 'player-taras',
    gameId: fixtureActiveGame.id,
    name: 'Taras',
    color: '#2878d0',
    balance: 12_400_000,
    status: 'ACTIVE',
    createdAt,
  },
  {
    id: 'player-iryna',
    gameId: fixtureActiveGame.id,
    name: 'Iryna',
    color: '#238b57',
    balance: 9_050_000,
    status: 'ACTIVE',
    createdAt,
  },
  {
    id: 'player-maksym',
    gameId: fixtureActiveGame.id,
    name: 'Maksym',
    color: '#c98a1b',
    balance: 4_300_000,
    status: 'ACTIVE',
    createdAt,
  },
];

export const fixtureSavedGames: GameSummary[] = [
  { game: fixtureActiveGame, playerCount: fixturePlayers.length },
  { game: fixtureLobbyGame, playerCount: 2 },
  { game: fixtureFinishedGame, playerCount: 5 },
];

export const fixtureGameDetails: GameDetails = {
  game: fixtureActiveGame,
  players: fixturePlayers,
  favoriteAmounts: [500_000, 1_000_000],
  recentAmounts: [2_000_000, 250_000],
  controlledPlayerIds: [fixturePlayers[0].id],
  controlledWallets: [{ playerId: fixturePlayers[0].id, kind: 'PRIMARY' }],
  canManage: true,
};

function transfer(
  index: number,
  type: Transaction['type'],
  amount: number,
  payerId: string | null,
  recipientId: string | null,
  comment: string | null = null,
): Transaction {
  const participants: Transaction['participants'] = [];
  if (payerId !== null) participants.push({ playerId: payerId, balanceDelta: -amount });
  if (recipientId !== null) participants.push({ playerId: recipientId, balanceDelta: amount });
  return {
    id: `visual-transaction-${index}`,
    gameId: fixtureActiveGame.id,
    type,
    amount,
    totalAmount: amount,
    comment,
    createdAt: new Date(Date.parse('2026-09-21T10:15:00.000Z') - index * 4 * 60_000).toISOString(),
    participants,
  };
}

export const fixtureTransactions: Transaction[] = [
  transfer(0, 'PLAYER_TO_PLAYER', 1_200_000, 'player-taras', 'player-olena', 'Rent on Boardwalk'),
  transfer(1, 'PASS_GO', 2_000_000, null, 'player-iryna'),
  transfer(2, 'PLAYER_TO_BANK', 750_000, 'player-maksym', null, 'Income tax'),
  transfer(3, 'BANK_TO_PLAYER', 500_000, null, 'player-olena'),
  transfer(4, 'PLAYER_TO_PLAYER', 3_500_000, 'player-olena', 'player-iryna', 'Park Place'),
];

export const fixtureActivity: ActivityPage = {
  transactions: fixtureTransactions,
  paymentRequests: [],
  nextCursor: null,
};

export const fixturePendingActivity: ActivityPage = {
  transactions: [],
  paymentRequests: [],
  nextCursor: null,
};

export const fixturePaymentRequests: PaymentRequest[] = [];

export const fixtureStatistics: { game: Game; winners: Player[] } & LedgerStatistics = {
  game: fixtureActiveGame,
  winners: [],
  durationMs: 7_800_000,
  totalTransactions: fixtureTransactions.length,
  totalMoneyTransferred: 7_950_000,
  largestSinglePayment: 3_500_000,
  richestActivePlayer: fixturePlayers[0],
  lowestActiveBalance: fixturePlayers[3].balance,
  players: fixturePlayers.map((player, index) => ({
    player,
    totalReceived: 1_000_000 * (index + 1),
    totalPaid: 500_000 * (index + 1),
    passGoCount: index + 1,
    transactionCount: 2 + index,
  })),
  playerToPlayerTotal: 4_700_000,
  paidToBank: 750_000,
  receivedFromBank: 2_500_000,
  largestTransaction: 3_500_000,
  biggestSenderId: 'player-olena',
  leastSenderId: 'player-maksym',
  biggestPayerRecipient: {
    payerId: 'player-olena',
    recipientId: 'player-iryna',
    amount: 3_500_000,
    transactionCount: 1,
  },
  cashLeaderboard: fixturePlayers.map((player, index) => ({
    player,
    sent: 3_500_000 - index * 500_000,
    received: 2_000_000 - index * 250_000,
    passGoCount: 4 - index,
    transactionCount: 6 - index,
  })),
};
