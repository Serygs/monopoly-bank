import { Notice, FieldHint } from '../../components/ui';
import { InterestRatePicker, LoanPicker } from './LoanFields';
import type { BankingForm } from './useBankingDialog';

function RepaymentFields({ form }: { form: BankingForm }) {
  const { t, inputs, fields, d, handlers, money } = form;
  const { loan } = d;
  return (
    <>
      <LoanPicker
        loans={loan.repayable}
        players={inputs.players}
        currency={inputs.currency}
        value={fields.loanId}
        onChange={handlers.chooseLoan}
      />
      {loan.isBankRepayment && loan.selected !== null && (
        <>
          <InterestRatePicker
            value={loan.rate}
            suggested={loan.selected.rounds?.suggestedRatePercent ?? 0}
            round={loan.selected.rounds?.round ?? 1}
            onChange={handlers.chooseRate}
          />
          <FieldHint>
            {t('bankLoanRepayHint', {
              principal: money(loan.owed),
              interest: money(loan.interest),
              total: money(loan.owed + loan.interest),
            })}
          </FieldHint>
        </>
      )}
    </>
  );
}

function BankLoanFields({ form }: { form: BankingForm }) {
  const { t, d, money } = form;
  return (
    <>
      {d.loan.bankLoan !== null && <Notice tone="info">{t('bankLoanAlreadyActive')}</Notice>}
      {d.loan.bankLoanMax !== null && (
        <FieldHint>{t('bankLoanMaxHint', { max: money(d.loan.bankLoanMax) })}</FieldHint>
      )}
    </>
  );
}

export function BankingLoanFields({ form }: { form: BankingForm }) {
  const { action } = form.fields;
  return (
    <>
      {action === 'LOAN_REPAYMENT' && <RepaymentFields form={form} />}
      {action === 'BANK_LOAN' && <BankLoanFields form={form} />}
    </>
  );
}
