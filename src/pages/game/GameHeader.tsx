import type { Game } from '../../../shared/types/monopoly';
import { PageHeader } from '../../components/PageHeader';
import { Button, MoneyValue, StatPill, Toolbar } from '../../components/ui';
import { useLanguage } from '../../i18n/language-context';
import { gameStatusTranslationKey } from '../../utils/game-status';

export type LiveStatus = 'connecting' | 'reconnecting' | 'live' | 'offline';

export interface GameHeaderProps {
  game: Game;
  canManage: boolean | undefined;
  liveStatus: LiveStatus;
  offline: boolean;
  onBack: () => void;
  onOpenActivity: () => void;
  onOpenStatistics: () => void;
  onInvite: () => void;
  onFinish: () => void;
}

/** Game page heading: status, name, Pass GO reward, toolbar and live-connection pill. */
export function GameHeader({
  game,
  canManage,
  liveStatus,
  offline,
  onBack,
  onOpenActivity,
  onOpenStatistics,
  onInvite,
  onFinish,
}: GameHeaderProps) {
  const { t } = useLanguage();
  return (
    <PageHeader
      className="game-heading"
      eyebrow={t(gameStatusTranslationKey(game.status))}
      title={game.name}
      description={
        <span className="game-pass-go">
          <span>{t('passGoRewardLabel')}:</span>
          <strong>
            <MoneyValue amount={game.passGoReward} currency={game.currency} />
          </strong>
        </span>
      }
      backAction={
        <Button variant="quiet" className="game-back-link" onClick={onBack}>
          <span aria-hidden="true">←</span>
          {t('savedGames')}
        </Button>
      }
      actions={
        <Toolbar variant="game-page">
          <Button variant="secondary" disabled={offline} onClick={onOpenActivity}>
            {t('activity')}
          </Button>
          <Button variant="secondary" disabled={offline} onClick={onOpenStatistics}>
            {t('statistics')}
          </Button>
          {canManage && game.status === 'LOBBY' && (
            <Button variant="secondary" disabled={offline} onClick={onInvite}>
              {t('invitePlayers')}
            </Button>
          )}
          {canManage && game.status === 'ACTIVE' && (
            <Button variant="danger" disabled={offline} onClick={onFinish}>
              {t('finishGame')}
            </Button>
          )}
        </Toolbar>
      }
    >
      {game.status === 'ACTIVE' && (
        <StatPill live className={`live-status live-status-${liveStatus}`}>
          {liveStatus === 'live'
            ? t('connectionLive')
            : liveStatus === 'connecting'
              ? t('connectionConnecting')
              : liveStatus === 'reconnecting'
                ? t('connectionReconnecting')
                : t('connectionOffline')}
        </StatPill>
      )}
    </PageHeader>
  );
}
