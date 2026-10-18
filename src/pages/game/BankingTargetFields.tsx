import { Notice } from '../../components/ui';
import { PlayerPicker } from './PlayerPicker';
import type { BankingForm } from './useBankingDialog';

export function BankingTargetFields({ form }: { form: BankingForm }) {
  const { t, inputs, fields, d, handlers } = form;
  const showMortgageHint =
    d.board === null &&
    fields.action === 'PLAYER_TO_PLAYER' &&
    d.mortgage.targetMortgages.length > 0;
  return (
    <>
      {d.targetRequired && (
        <PlayerPicker
          label={t('chooseRecipient')}
          players={d.recipients}
          gamePlayers={inputs.players}
          value={d.effectiveTargetId}
          currency={inputs.currency}
          onChange={handlers.changeTarget}
        />
      )}
      {showMortgageHint && (
        <Notice tone="info">
          {t('mortgagedRentHint', {
            name: d.target?.name ?? '',
            properties: d.mortgage.targetMortgages.map((item) => item.propertyName).join(', '),
          })}
        </Notice>
      )}
    </>
  );
}
