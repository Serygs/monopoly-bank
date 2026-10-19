import { Dialog } from '../../components/Dialog';
import { BankingConfirmStep } from './BankingConfirmStep';
import { BankingCooldownStep } from './BankingCooldownStep';
import { BankingFormStep } from './BankingFormStep';
import { BankingWalletStep } from './BankingWalletStep';
import { stepPanelClass } from './banking-dialog-styles';
import type { BankingDialogProps } from './banking-dialog-types';
import { useBankingDialog, type BankingForm } from './useBankingDialog';

export type { BankingDialogProps } from './banking-dialog-types';

function BankingStep({ form }: { form: BankingForm }) {
  const { action, cooldownRounds, confirming } = form.fields;
  if (action === null) return <BankingWalletStep form={form} />;
  if (cooldownRounds !== null) return <BankingCooldownStep form={form} rounds={cooldownRounds} />;
  if (confirming) return <BankingConfirmStep form={form} action={action} />;
  return <BankingFormStep form={form} action={action} />;
}

export function BankingDialog(props: BankingDialogProps) {
  const form = useBankingDialog(props);
  const { t, title } = form;
  return (
    <Dialog
      title={title}
      closeLabel={t('closeDialog', { title })}
      onClose={props.onClose}
      sheet="flow"
      className={form.fields.action === null ? undefined : stepPanelClass}
    >
      <BankingStep form={form} />
    </Dialog>
  );
}
