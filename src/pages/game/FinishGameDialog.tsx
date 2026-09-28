import { useState } from 'react';
import type { GameDetails } from '../../../shared/contracts/api';
import type { Currency, Player } from '../../../shared/types/monopoly';
import { monopolyBankApi } from '../../api/monopoly-bank-api';
import { Dialog } from '../../components/Dialog';
import { Button, DialogActions, DialogBody, MoneyValue, Notice, Toggle } from '../../components/ui';
import { useLanguage } from '../../i18n/language-context';
import { cx, mutedClass } from '../../components/ui/class-names';

export interface FinishGameDialogProps {
  gameId: string;
  players: Player[];
  currency: Currency;
  onFinished: (details: GameDetails) => void;
  onClose: () => void;
}

const cashLeaderClass = 'rounded-[9px] border border-accent bg-surface-elevated p-[10px]';

/** Native winner checkboxes, each with the player's colour dot. */
const winnerPickerClass = cx(
  'mx-0 my-[16px] grid gap-[8px] border-0 p-0 [&_legend]:mb-[6px] [&_legend]:font-bold [&_legend]:text-primary',
  '[&_label]:flex [&_label]:min-h-(--mb-control-height-md) [&_label]:items-center [&_label]:gap-[8px] [&_i]:size-[12px] [&_i]:rounded-[50%]',
  '[&_input[type=checkbox]]:size-[20px] [&_input[type=checkbox]]:accent-accent',
);

export function FinishGameDialog({
  gameId,
  players,
  currency,
  onFinished,
  onClose,
}: FinishGameDialogProps) {
  const { t } = useLanguage();
  const [winnerIds, setWinnerIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  const leader = [...players].sort((a, b) => b.balance - a.balance || a.id.localeCompare(b.id))[0];
  const toggle = (id: string) =>
    setWinnerIds((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id],
    );
  const finish = async () => {
    setSaving(true);
    setError(false);
    try {
      onFinished(await monopolyBankApi.finishGame(gameId, { winnerPlayerIds: winnerIds }));
    } catch {
      setError(true);
      setSaving(false);
    }
  };
  return (
    <Dialog
      title={t('finishGame')}
      closeLabel={t('closeDialog', { title: t('finishGame') })}
      onClose={onClose}
      closeDisabled={saving}
    >
      <DialogBody>{t('finishGameDescription')}</DialogBody>
      <p className={mutedClass}>{t('finishWinnerHint')}</p>
      {leader !== undefined && (
        <p className={cashLeaderClass}>
          <strong>{t('cashLeader')}:</strong> {leader.name} ·{' '}
          <MoneyValue amount={leader.balance} currency={currency} />
        </p>
      )}
      <fieldset className={winnerPickerClass}>
        <legend>{t('chooseWinners')}</legend>
        {players.map((player) => (
          <Toggle
            key={player.id}
            variant="inline"
            checked={winnerIds.includes(player.id)}
            onChange={() => toggle(player.id)}
            label={
              <>
                {' '}
                <i style={{ backgroundColor: player.color }} /> {player.name}
              </>
            }
          />
        ))}
      </fieldset>
      {error && <Notice tone="error">{t('unableLoadGame')}</Notice>}
      <DialogActions>
        <Button variant="secondary" disabled={saving} onClick={onClose}>
          {t('cancel')}
        </Button>
        <Button
          variant="quiet"
          disabled={saving}
          onClick={() => {
            setWinnerIds([]);
            void finish();
          }}
        >
          {t('finishNoWinner')}
        </Button>
        <Button variant="danger" disabled={saving} onClick={() => void finish()}>
          {t('finishGame')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
