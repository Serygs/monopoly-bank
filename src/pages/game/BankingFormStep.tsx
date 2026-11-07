import { Button, Notice, SheetActions } from '../../components/ui';
import { BankingAmountFields } from './BankingAmountFields';
import { CommentField } from './BankingCommentField';
import { BankingLoanFields } from './BankingLoanFields';
import { BankingProblems } from './BankingProblems';
import { BankingPropertyHints, BankingPropertyPickers } from './BankingPropertyFields';
import { BankingTargetFields } from './BankingTargetFields';
import { StepBody } from './banking-dialog-parts';
import { stepFooterClass } from './banking-dialog-styles';
import { actionDescription, type ActionType } from './game-page-helpers';
import type { BankingForm } from './useBankingDialog';

export function BankingFormStep({ form, action }: { form: BankingForm; action: ActionType }) {
  const { t, money, inputs, d, valid, handlers, transactionError, canRaise, waitingShortfall } =
    form;
  return (
    <>
      <StepBody>
        <p className="sr-only">{actionDescription(action, inputs.player.name, t)}</p>
        {waitingShortfall !== null && (
          <Notice tone="info">{t('raiseReminder', { amount: money(waitingShortfall) })}</Notice>
        )}
        {transactionError !== null && <Notice tone="error">{transactionError}</Notice>}
        <BankingTargetFields form={form} />
        <BankingPropertyPickers form={form} />
        <BankingLoanFields form={form} />
        <BankingPropertyHints form={form} />
        <BankingAmountFields form={form} />
        <BankingProblems form={form} />
        {!d.commentless && (
          <div className="mt-(--mb-space-2)">
            <CommentField form={form} />
          </div>
        )}
      </StepBody>
      <SheetActions className={stepFooterClass}>
        <Button variant="secondary" onClick={handlers.leaveForm}>
          {t('back')}
        </Button>
        {canRaise ? (
          <Button variant="primary" onClick={handlers.openRaise}>
            {t('raiseFunds')}
          </Button>
        ) : (
          <Button
            variant="primary"
            disabled={!valid}
            aria-describedby={d.build.buildMode !== null && !valid ? 'building-reason' : undefined}
            onClick={handlers.review}
          >
            {t('reviewTransaction')}
          </Button>
        )}
      </SheetActions>
    </>
  );
}
