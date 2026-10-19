import { Button, Notice, SheetActions, Toggle } from '../../components/ui';
import { CommentField } from './BankingCommentField';
import { StepBody } from './banking-dialog-parts';
import { stepFooterClass } from './banking-dialog-styles';
import { Confirmation } from './Confirmation';
import type { ActionType } from './game-page-helpers';
import type { BankingForm } from './useBankingDialog';

function OverrideConfirm({ form }: { form: BankingForm }) {
  const { t, money, d, fields, handlers } = form;
  if (d.purchaseOverride === undefined || d.selectedTile === null) return null;
  return (
    <div className="mt-(--mb-space-3) grid gap-(--mb-space-3)">
      <Notice tone="info">
        {t('priceOverrideWarning', {
          price: money(d.purchaseOverride),
          listPrice: money(d.selectedTile.tile.price),
        })}
      </Notice>
      <Toggle
        variant="inline"
        label={t('priceOverrideConfirm')}
        checked={fields.overrideConfirmed}
        onChange={(overrideConfirmed) => handlers.patchField({ overrideConfirmed })}
      />
    </div>
  );
}

function confirmLabel(form: BankingForm): string {
  if (form.submitting) return form.t('recording');
  return form.transactionError === null ? form.t('confirmTransaction') : form.t('tryAgain');
}

function ConfirmFooter({ form, action }: { form: BankingForm; action: ActionType }) {
  const { t, fields, d, handlers, submitting } = form;
  const reviewOnly = action === 'PASS_GO' || action === 'JACKPOT_PAYOUT';
  const overridePending = d.purchaseOverride !== undefined && !fields.overrideConfirmed;
  return (
    <SheetActions className={stepFooterClass}>
      <Button
        variant="secondary"
        disabled={submitting}
        onClick={() =>
          reviewOnly ? handlers.select(null) : handlers.patchField({ confirming: false })
        }
      >
        {t('back')}
      </Button>
      <Button
        variant="primary"
        disabled={submitting || overridePending}
        onClick={() => void form.submit()}
      >
        {confirmLabel(form)}
      </Button>
    </SheetActions>
  );
}

export function BankingConfirmStep({ form, action }: { form: BankingForm; action: ActionType }) {
  const { t, inputs, fields, d, funds, transactionError } = form;
  return (
    <>
      <StepBody>
        <p className="sr-only">{t('confirmationIntro')}</p>
        {transactionError !== null && <Notice tone="error">{transactionError}</Notice>}
        <Confirmation
          action={d.requestAction ?? action}
          player={inputs.player}
          target={d.target}
          amount={d.amountValue}
          passGoReward={d.reward}
          currency={inputs.currency}
          preview={form.preview}
          comment={fields.comment}
          propertyName={form.confirmedName}
          interest={d.loan.interest}
          lenderIsBank={d.loan.isBankRepayment}
          reserved={funds.reserved}
        />
        <OverrideConfirm form={form} />
        {action === 'PASS_GO' && (
          <div className="mt-(--mb-space-3)">
            <CommentField form={form} />
          </div>
        )}
      </StepBody>
      <ConfirmFooter form={form} action={action} />
    </>
  );
}
