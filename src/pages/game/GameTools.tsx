import { DiceRoller } from '../../components/DiceRoller';
import { Dialog } from '../../components/Dialog';
import { TableCalculator } from '../../components/TableCalculator';
import { cx } from '../../components/ui/class-names';
import { useLanguage } from '../../i18n/language-context';
import type { GameContext } from './game-context';

/** Dice and calculator: stacked below `md`, side by side from `md`. */
const gameToolsClass =
  'mt-[24px] grid grid-cols-1 gap-(--mb-space-4) md:grid-cols-2 md:gap-(--mb-layout-gap-medium) lg:gap-(--mb-layout-gap-wide)';

function Tools({ ctx }: { ctx: GameContext }) {
  const { gameId, details, view, preferences } = ctx;
  return (
    <>
      <DiceRoller
        gameId={gameId}
        players={details.players}
        rollerPlayerId={view.activeWallet?.id ?? null}
        sound={preferences.sound}
        vibration={preferences.vibration}
      />
      <TableCalculator />
    </>
  );
}

export function GameTools({ ctx }: { ctx: GameContext }) {
  const { t } = useLanguage();
  const { details, dialogs } = ctx;
  const { toolsOpen, setToolsOpen } = dialogs.sheets;
  if (details.game.status !== 'ACTIVE') return null;
  return (
    <>
      <div className={cx(gameToolsClass, 'max-md:hidden')}>
        <Tools ctx={ctx} />
      </div>
      {toolsOpen && (
        <Dialog
          title={t('navTools')}
          closeLabel={t('closeDialog', { title: t('navTools') })}
          onClose={() => setToolsOpen(false)}
        >
          <div className="mt-(--mb-space-4) grid gap-(--mb-space-4)">
            <Tools ctx={ctx} />
          </div>
        </Dialog>
      )}
    </>
  );
}
