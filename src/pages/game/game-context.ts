import type { Dispatch, SetStateAction } from 'react';
import type {
  AuctionResponse,
  GameDetails,
  PaymentRequest,
  TradeRequest,
} from '../../../shared/contracts/api';
import type { Transaction } from '../../../shared/types/monopoly';
import type { DevicePreferences } from '../../utils/preferences';
import type { GameView } from './game-view';
import type { GameDialogs } from './useGameDialogs';

export type SetGameDetails = Dispatch<SetStateAction<GameDetails | null>>;

export interface GameContext {
  gameId: string;
  details: GameDetails;
  setDetails: SetGameDetails;
  view: GameView;
  dialogs: GameDialogs;
  preferences: DevicePreferences;
  offline: boolean;
  liveTransactions: Transaction[];
  setPaymentRequests: Dispatch<SetStateAction<PaymentRequest[]>>;
  loadPaymentRequests: () => void;
  applyAuctionResponse: (response: AuctionResponse) => void;
  refreshAuction: () => void;
  putTradeRequest: (tradeRequest: TradeRequest) => void;
}

export function putTradeRequestInto(setDetails: SetGameDetails, tradeRequest: TradeRequest): void {
  setDetails((current) =>
    current === null
      ? current
      : {
          ...current,
          tradeRequests: [
            ...(current.tradeRequests ?? []).filter((item) => item.id !== tradeRequest.id),
            tradeRequest,
          ],
        },
  );
}
