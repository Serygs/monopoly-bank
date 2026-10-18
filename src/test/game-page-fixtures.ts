import { buildGame, buildPlayer, buildTransaction } from '../../shared/test-support/fixtures';
import type { Game, Player, Transaction, TransactionType } from '../../shared/types/monopoly';
import { translate, type Translate } from '../i18n/translations';
import type { ActionType } from '../pages/game/game-page-helpers';

export const t: Translate = (key, values) => translate('en', key, values);

export const game: Game = buildGame({ id: 'g1' });

export const player = (id: string, name: string, balance: number): Player =>
  buildPlayer({ id, gameId: 'g1', name, balance });

export const alice = player('p1', 'Alice', 1_000);
export const bob = player('p2', 'Bob', 500);
export const carol = player('p3', 'Carol', 100);
export const players = [alice, bob, carol];

export const stored = (
  id: string,
  type: TransactionType,
  participants: Transaction['participants'],
): Transaction =>
  buildTransaction({ id, gameId: 'g1', type, amount: 10, totalAmount: 10, participants });

export const allActions: ActionType[] = [
  'PLAYER_TO_PLAYER',
  'PLAYER_TO_BANK',
  'BANK_TO_PLAYER',
  'PLAYER_TO_ALL',
  'ALL_TO_PLAYER',
  'PASS_GO',
  'MORTGAGE',
  'MORTGAGE_REDEMPTION',
  'PROPERTY_PURCHASE',
  'PROPERTY_TRANSFER',
  'PROPERTY_BUILD',
  'PROPERTY_SELL_BUILDING',
  'PAY_RENT',
  'LOAN_ISSUE',
  'LOAN_REPAYMENT',
  'BANK_LOAN',
  'TO_JACKPOT',
  'JACKPOT_PAYOUT',
];
