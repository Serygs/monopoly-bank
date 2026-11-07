import { BANK_TO_PLAYER_MAX_AMOUNT } from '../../../shared/domain/banking';
import { FieldError } from '../../components/ui';
import { bankruptcyClass, shortfallClass } from './banking-dialog-styles';
import type { BankingForm } from './useBankingDialog';

function LimitErrors({ form }: { form: BankingForm }) {
  const { t, money, d, funds } = form;
  const { loan } = d;
  return (
    <>
      {d.exceedsBankLoanMax && loan.bankLoanMax !== null && (
        <FieldError as="p" announce>
          {t('bankLoanExceedsMax', { max: money(loan.bankLoanMax) })}
        </FieldError>
      )}
      {d.exceedsBankToPlayerMax && (
        <FieldError as="p" announce>
          {t('bankToPlayerExceedsMax', { max: money(BANK_TO_PLAYER_MAX_AMOUNT) })}
        </FieldError>
      )}
      {d.overRepayment && (
        <FieldError as="p" announce>
          {t('loanRepayExceeds', { amount: money(loan.owed) })}
        </FieldError>
      )}
      {funds.error !== null && (
        <FieldError as="p" announce>
          {funds.error}
        </FieldError>
      )}
    </>
  );
}

export function BankingProblems({ form }: { form: BankingForm }) {
  const { t, money, funds, props, canRaise } = form;
  return (
    <>
      <LimitErrors form={form} />
      {funds.shortfall !== null && (
        <div className={shortfallClass}>
          <p>{t('shortBy', { amount: money(funds.shortfall) })}</p>
          {/* A payment's ways out live in the "Find funds" menu. */}
          {!canRaise && (
            <button type="button" className={bankruptcyClass} onClick={props.onBankrupt}>
              {t('declareBankrupt')}
            </button>
          )}
        </div>
      )}
    </>
  );
}
