import { DialogNavContext } from '../components/dialog-nav-context';
import { Button, Notice, PageShell, StatPill } from '../components/ui';
import { useGameData } from '../hooks/useGameData';
import { apiErrorMessage } from '../i18n/api-errors';
import { useLanguage } from '../i18n/language-context';
import type { DevicePreferences } from '../utils/preferences';
import { AuctionPrompts } from './game/AuctionPrompts';
import { GameHeader } from './game/GameHeader';
import { GameInboxes } from './game/GameInboxes';
import { GameNav } from './game/GameNav';
import { GameSheets } from './game/GameSheets';
import { GameTools } from './game/GameTools';
import { LobbyPanel } from './game/LobbyPanel';
import { ManagementDialogs } from './game/ManagementDialogs';
import { WalletDialogs } from './game/WalletDialogs';
import { WalletsSection } from './game/WalletsSection';
import { putTradeRequestInto, type GameContext } from './game/game-context';
import { headerProps, walletsProps } from './game/game-page-props';
import { deriveGameView } from './game/game-view';
import { useGameDialogs } from './game/useGameDialogs';

/** Keeps content clear of the compact bottom navigation and the home indicator. */
const navPaddingClass = 'max-md:pb-[calc(88px+var(--mb-app-safe-bottom))]';

interface Props {
  gameId: string;
  onBack: () => void;
  preferences: DevicePreferences;
  offline: boolean;
  onPaymentFlowChange: (open: boolean) => void;
}

export function GamePage({ gameId, onBack, preferences, offline, onPaymentFlowChange }: Props) {
  const data = useGameData(gameId, offline, preferences.keepScreenAwake);
  const dialogs = useGameDialogs(gameId, onPaymentFlowChange);
  const { details, setDetails } = data;
  if (data.error !== null) return <LoadError error={data.error} onBack={onBack} />;
  if (details === null) return <LoadingGame />;
  const view = deriveGameView({
    ...data,
    details,
    activeWalletId: dialogs.wallet.activeWalletId,
    offline,
  });
  const ctx: GameContext = {
    ...data,
    gameId,
    details,
    view,
    dialogs,
    preferences,
    offline,
    putTradeRequest: (request) => putTradeRequestInto(setDetails, request),
  };
  return (
    <DialogNavContext.Provider value={view.showNav ? <GameNav ctx={ctx} /> : null}>
      <PageShell className={view.showNav ? navPaddingClass : undefined}>
        <GameHeader {...headerProps(ctx, data.liveStatus, onBack)} />
        <LobbyPanel gameId={gameId} details={details} setDetails={setDetails} offline={offline} />
        <WalletsSection {...walletsProps(ctx)} />
        <GameInboxes ctx={ctx} />
        <GameTools ctx={ctx} />
        {view.showNav && <GameNav ctx={ctx} />}
        <GameSheets ctx={ctx} />
        <WalletDialogs ctx={ctx} />
        <AuctionPrompts ctx={ctx} />
        <ManagementDialogs ctx={ctx} />
      </PageShell>
    </DialogNavContext.Provider>
  );
}

function LoadingGame() {
  const { t } = useLanguage();
  return (
    <PageShell>
      <StatPill variant="status" live>
        {t('loadingGame')}
      </StatPill>
    </PageShell>
  );
}

function LoadError({ error, onBack }: { error: unknown; onBack: () => void }) {
  const { t } = useLanguage();
  return (
    <PageShell>
      <Notice tone="error" as="section">
        <p>{apiErrorMessage(error, t, 'unableLoadGame')}</p>
        <Button variant="secondary" onClick={onBack}>
          {t('savedGames')}
        </Button>
      </Notice>
    </PageShell>
  );
}
