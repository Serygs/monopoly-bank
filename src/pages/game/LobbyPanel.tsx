import type { GameDetails } from '../../../shared/contracts/api';
import type { Player } from '../../../shared/types/monopoly';
import { monopolyBankApi } from '../../api/monopoly-bank-api';
import { Button, Notice } from '../../components/ui';
import { useAsyncAction } from '../../hooks/useAsyncAction';
import { apiErrorMessage } from '../../i18n/api-errors';
import { useLanguage } from '../../i18n/language-context';
import type { SetGameDetails } from './game-context';
import { lobbyNeedsMorePlayers, withClientGameDetails } from './game-page-helpers';

/** The lobby banner sits further from the wallets than a plain notice; `!` beats Notice's margin. */
const stateBannerClass = 'mb-(--mb-space-6)!';
const playerRowClass =
  'glass-card flex items-center justify-between gap-(--mb-space-3) rounded-surface border border-border bg-surface-elevated px-(--mb-space-4) py-(--mb-space-2)';

interface LobbyPanelProps {
  gameId: string;
  details: GameDetails;
  setDetails: SetGameDetails;
  offline: boolean;
}

function TrashIcon() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M4 7h16M10 11v6M14 11v6M6 7l1 12h10l1-12M9 7V4h6v3" />
    </svg>
  );
}

function LobbyBanner({ gameId, details, setDetails, offline }: LobbyPanelProps) {
  const { t } = useLanguage();
  return (
    <Notice tone="success" as="section" className={stateBannerClass}>
      <p>
        {t('waitingForPlayers')}
        {lobbyNeedsMorePlayers(details.players.length) && <> — {t('startGameHint')}</>}
      </p>
      {details.canManage && (
        <Button
          variant="primary"
          disabled={offline || lobbyNeedsMorePlayers(details.players.length)}
          onClick={() => void monopolyBankApi.startGame(gameId).then(setDetails)}
        >
          {t('startGame')}
        </Button>
      )}
    </Notice>
  );
}

function PlayerRow({
  player,
  offline,
  onRemove,
}: {
  player: Player;
  offline: boolean;
  onRemove: (playerId: string) => void;
}) {
  const { t } = useLanguage();
  return (
    <div className={playerRowClass}>
      <span className="min-w-0 truncate font-semibold text-primary">{player.name}</span>
      <Button
        variant="quiet"
        className="icon-button min-h-11 min-w-11 shrink-0 justify-center rounded-pill p-0"
        disabled={offline}
        aria-label={t('removePlayer', { name: player.name })}
        onClick={() => onRemove(player.id)}
      >
        <TrashIcon />
      </Button>
    </div>
  );
}

function LobbyPlayers({ gameId, details, setDetails, offline }: LobbyPanelProps) {
  const { t } = useLanguage();
  const { busy, error, run } = useAsyncAction();
  const remove = (playerId: string) =>
    void run(async () => {
      setDetails(
        withClientGameDetails(await monopolyBankApi.removeLobbyPlayer(gameId, playerId), details),
      );
    });
  const controlled = details.controlledPlayerIds ?? [];
  return (
    <section aria-label={t('lobbyPlayersTitle')} className="grid gap-(--mb-space-2)">
      {details.players
        .filter((player) => !controlled.includes(player.id))
        .map((player) => (
          <PlayerRow key={player.id} player={player} offline={offline || busy} onRemove={remove} />
        ))}
      {error !== null && (
        <Notice tone="error">{apiErrorMessage(error, t, 'unableRemovePlayer')}</Notice>
      )}
    </section>
  );
}

export function LobbyPanel(props: LobbyPanelProps) {
  if (props.details.game.status !== 'LOBBY') return null;
  return (
    <>
      <LobbyBanner {...props} />
      {props.details.canManage && <LobbyPlayers {...props} />}
    </>
  );
}
