import { LazyBoundary } from '../../components/app-shell/LazyBoundary';
import { useFeedback } from '../../components/ui';
import { useLanguage } from '../../i18n/language-context';
import { lazyNamed } from '../../utils/lazy-named';
import type { GameContext } from './game-context';
import { withClientGameDetails } from './game-page-helpers';
import { FinishGameDialog } from './FinishGameDialog';
import { ReverseTransactionDialog } from './ReverseTransactionDialog';

// The QR code generator ships with the invite dialog, which is opened rarely.
const InviteDialog = lazyNamed(() => import('./InviteDialog'), 'InviteDialog');

function InviteHost({ ctx }: { ctx: GameContext }) {
  const { gameId, details, setDetails, dialogs } = ctx;
  if (!dialogs.sheets.inviteOpen) return null;
  return (
    <LazyBoundary>
      <InviteDialog
        joinCode={details.joinCode}
        gameId={gameId}
        playerCount={details.players.length}
        hasPassword={details.hasAccessPassword}
        canRegenerate={details.canManage === true && details.game.status === 'LOBBY'}
        onCodeChanged={(joinCode) =>
          setDetails((current) => (current === null ? current : { ...current, joinCode }))
        }
        onClose={() => dialogs.sheets.setInviteOpen(false)}
      />
    </LazyBoundary>
  );
}

function FinishHost({ ctx }: { ctx: GameContext }) {
  const { gameId, details, setDetails, dialogs } = ctx;
  if (!dialogs.sheets.finishing) return null;
  return (
    <FinishGameDialog
      players={details.players}
      currency={details.game.currency}
      gameId={gameId}
      onFinished={(finished) => {
        setDetails((current) => withClientGameDetails(finished, current));
        dialogs.sheets.setFinishing(false);
      }}
      onClose={() => dialogs.sheets.setFinishing(false)}
    />
  );
}

function ReverseHost({ ctx }: { ctx: GameContext }) {
  const { language, t } = useLanguage();
  const notify = useFeedback();
  const { gameId, details, setDetails, dialogs } = ctx;
  const { reversing, setReversing, setVersion } = dialogs.activity;
  if (reversing === null) return null;
  return (
    <ReverseTransactionDialog
      gameId={gameId}
      transaction={reversing}
      players={details.players}
      currency={details.game.currency}
      language={language}
      onClose={() => setReversing(null)}
      onReversed={(players) => {
        setDetails({ ...details, players });
        setReversing(null);
        setVersion((version) => version + 1);
        notify({ tone: 'success', message: t('reversalRecorded') });
      }}
    />
  );
}

export function ManagementDialogs({ ctx }: { ctx: GameContext }) {
  return (
    <>
      <InviteHost ctx={ctx} />
      <FinishHost ctx={ctx} />
      <ReverseHost ctx={ctx} />
    </>
  );
}
