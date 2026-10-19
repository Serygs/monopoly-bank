import { Button, Notice, SheetActions } from '../../components/ui';
import { StepBody } from './banking-dialog-parts';
import { stepFooterClass } from './banking-dialog-styles';
import type { BankingForm } from './useBankingDialog';

export function BankingCooldownStep({ form, rounds }: { form: BankingForm; rounds: number }) {
  const { t, handlers } = form;
  return (
    <>
      <StepBody>
        <Notice tone="info">{t('bankLoanCooldownWarning', { rounds })}</Notice>
      </StepBody>
      <SheetActions className={stepFooterClass}>
        <Button variant="secondary" onClick={() => handlers.patchField({ cooldownRounds: null })}>
          {t('back')}
        </Button>
        <Button variant="primary" onClick={handlers.borrowAnyway}>
          {t('borrowAnyway')}
        </Button>
      </SheetActions>
    </>
  );
}
