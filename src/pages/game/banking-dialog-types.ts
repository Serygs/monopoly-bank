import type {
  Auction,
  BankLoanCooldown,
  Currency,
  GameProperty,
  GameRules,
  GameSettings,
  Loan,
  Mortgage,
  Player,
} from '../../../shared/types/monopoly';
import type { ActionType } from './game-page-helpers';

export interface BankingDialogProps {
  gameId: string;
  player: Player;
  players: Player[];
  passGoReward: number;
  currency: Currency;
  /** Scales the quick amounts; without it they fall back to fixed round amounts. */
  startingBalance?: number;
  /** The game's house rules; omitted rules are off. */
  rules?: GameRules;
  /** Amounts derived at creation (taxes, jail fine); older games have none, so no fixed payments. */
  settings?: GameSettings | null;
  /** Every property currently mortgaged in the game. */
  mortgages?: Mortgage[];
  /** The loans still being repaid. */
  loans?: Loan[];
  /** Players who repaid a bank loan recently (bank-loans rule). */
  bankLoanCooldowns?: BankLoanCooldown[];
  /** The Free Parking pot (jackpot rule); what a collection pays out in full. */
  jackpot?: number;
  /** Open straight on repaying the player's bank loan (the overdue "Settle loan" prompt). */
  settleOnOpen?: boolean;
  /** Board games: the property registry; the tile pickers list only valid choices from it. */
  properties?: GameProperty[];
  /** Open straight on this action (the tile sheet's quick entry). */
  initialAction?: ActionType;
  /** The tile the quick entry started from; preselected in the tile picker. */
  initialTileId?: string;
  /** The running or just-closed auction (auctions rule): its leading bid is reserved cash. */
  auction?: Auction | null;
  /** Opens the start-auction prompt for this wallet, with a suggested property name. */
  onStartAuction?: (lotName: string) => void;
  /** Board games: opens the trade dialog for this wallet. */
  onStartTrade?: () => void;
  favoriteAmounts: number[];
  recentAmounts: number[];
  onToggleFavorite: (amount: number) => void;
  onClose: () => void;
  onBankrupt: () => void;
  onViewHistory: (player: Player) => void;
  onCompleted: (
    players: Player[],
    action: ActionType,
    amount: number | null,
    mortgages?: Mortgage[],
    loans?: Loan[],
    bankLoanCooldowns?: BankLoanCooldown[],
    jackpot?: number,
    properties?: GameProperty[],
  ) => void;
  /** A payment or loan request was created; a loan request names the lender being asked. */
  onPaymentRequested: (action: ActionType, lenderName?: string) => void;
}
