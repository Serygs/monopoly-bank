import { useEffect, useState } from 'react';
import type { LedgerStatistics } from '../../../shared/contracts/api';
import type { Game, Player, Transaction } from '../../../shared/types/monopoly';
import { monopolyBankApi } from '../../api/monopoly-bank-api';
import type { TileIntent } from '../../utils/property-view';
import type { ActionType } from './game-page-helpers';

type Summary = ({ game: Game; winners: Player[] } & LedgerStatistics) | null;
interface TradePrompt {
  player: Player;
  tileId: string;
}
interface AuctionPrompt {
  player: Player;
  lotName: string;
  tileId?: string;
}
interface WalletIntent {
  action: ActionType;
  tileId: string;
}

function useActivityState() {
  const [open, setOpen] = useState(false);
  const [scope, setScope] = useState<'ALL' | 'MINE'>('ALL');
  const [version, setVersion] = useState(0);
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [reversing, setReversing] = useState<Transaction | null>(null);
  return {
    open,
    setOpen,
    scope,
    setScope,
    version,
    setVersion,
    playerId,
    setPlayerId,
    reversing,
    setReversing,
  };
}

function useWalletState() {
  const [selectedPlayer, setSelectedPlayer] = useState<Player | null>(null);
  const [bankruptPlayer, setBankruptPlayer] = useState<Player | null>(null);
  const [settleLoanOnOpen, setSettleLoanOnOpen] = useState(false);
  const [activeWalletId, setActiveWalletId] = useState<string | null>(null);
  const [walletIntent, setWalletIntent] = useState<WalletIntent | null>(null);
  if (selectedPlayer === null && walletIntent !== null) setWalletIntent(null);
  return {
    selectedPlayer,
    setSelectedPlayer,
    bankruptPlayer,
    setBankruptPlayer,
    settleLoanOnOpen,
    setSettleLoanOnOpen,
    activeWalletId,
    setActiveWalletId,
    walletIntent,
    setWalletIntent,
  };
}

function useSheetState() {
  const [summary, setSummary] = useState<Summary>(null);
  const [statisticsOpen, setStatisticsOpen] = useState(false);
  const [propertyOpen, setPropertyOpen] = useState(false);
  /** The player whose cards the Property screen opens filtered to; null opens "Mine". */
  const [propertyOwner, setPropertyOwner] = useState<string | null>(null);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const [inviteOpen, setInviteOpen] = useState(false);
  return {
    summary,
    setSummary,
    statisticsOpen,
    setStatisticsOpen,
    propertyOpen,
    setPropertyOpen,
    propertyOwner,
    setPropertyOwner,
    toolsOpen,
    setToolsOpen,
    rulesOpen,
    setRulesOpen,
    finishing,
    setFinishing,
    inviteOpen,
    setInviteOpen,
  };
}

function usePromptState() {
  const [tradePrompt, setTradePrompt] = useState<TradePrompt | null>(null);
  const [auctionPrompt, setAuctionPrompt] = useState<AuctionPrompt | null>(null);
  const [dismissedAuction, setDismissedAuction] = useState<string | null>(null);
  return {
    tradePrompt,
    setTradePrompt,
    auctionPrompt,
    setAuctionPrompt,
    dismissedAuction,
    setDismissedAuction,
  };
}

export function useGameDialogs(gameId: string, onPaymentFlowChange: (open: boolean) => void) {
  const activity = useActivityState();
  const wallet = useWalletState();
  const sheets = useSheetState();
  const prompts = usePromptState();
  const { selectedPlayer, bankruptPlayer } = wallet;
  useEffect(() => {
    onPaymentFlowChange(selectedPlayer !== null || bankruptPlayer !== null);
    return () => onPaymentFlowChange(false);
  }, [selectedPlayer, bankruptPlayer, onPaymentFlowChange]);

  const closeNavSheets = () => {
    activity.setOpen(false);
    activity.setPlayerId(null);
    sheets.setStatisticsOpen(false);
    sheets.setPropertyOpen(false);
    sheets.setPropertyOwner(null);
    sheets.setToolsOpen(false);
    wallet.setSelectedPlayer(null);
  };
  /** Opens the Property screen on the viewer's cards, or on one player's when `owner` is given. */
  const openProperty = (owner: string | null = null) => {
    closeNavSheets();
    sheets.setPropertyOwner(owner);
    sheets.setPropertyOpen(true);
  };
  const openStatistics = () =>
    void monopolyBankApi.getGameSummary(gameId).then((result) => {
      sheets.setSummary(result);
      closeNavSheets();
      sheets.setStatisticsOpen(true);
    });
  const startTileIntent = (players: Player[], intent: TileIntent) => {
    const target = players.find((candidate) => candidate.id === intent.playerId);
    if (target === undefined) return;
    sheets.setPropertyOpen(false);
    if (intent.kind === 'AUCTION')
      prompts.setAuctionPrompt({ player: target, lotName: '', tileId: intent.tileId });
    else if (intent.kind === 'PROPERTY_TRANSFER')
      prompts.setTradePrompt({ player: target, tileId: intent.tileId });
    else {
      wallet.setWalletIntent({ action: intent.kind, tileId: intent.tileId });
      wallet.setSelectedPlayer(target);
    }
  };
  return {
    activity,
    wallet,
    sheets,
    prompts,
    closeNavSheets,
    openProperty,
    openStatistics,
    startTileIntent,
  };
}

export type GameDialogs = ReturnType<typeof useGameDialogs>;
