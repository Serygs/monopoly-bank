import { BANK_TO_PLAYER_MAX_AMOUNT } from '../../../shared/domain/banking';
import { Button, FieldError } from '../../components/ui';
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

function ShortfallActions({ form }: { form: BankingForm }) {
  const { t, props, d, fields, handlers, canAuction, auctionBusy } = form;
  const { action } = fields;
  const lotSuggestion = fields.comment.trim().slice(0, 60);
  const auctionable = action === 'PLAYER_TO_BANK' || action === 'PLAYER_TO_PLAYER';
  const onStartAuction = props.onStartAuction;
  return (
    <div className="flex flex-wrap gap-(--mb-space-2)">
      {d.loan.isBankRepayment && (
        <>
          <Button variant="secondary" onClick={() => handlers.select('MORTGAGE')}>
            {t('mortgageProperty')}
          </Button>
          <Button variant="secondary" onClick={() => handlers.select('BANK_TO_PLAYER')}>
            {t('sellBuildingsToBank')}
          </Button>
        </>
      )}
      {canAuction && !auctionBusy && auctionable && onStartAuction !== undefined && (
        <Button variant="secondary" onClick={() => onStartAuction(lotSuggestion)}>
          {t('auctionInstead')}
        </Button>
      )}
      <button type="button" className={bankruptcyClass} onClick={props.onBankrupt}>
        {t('declareBankrupt')}
      </button>
    </div>
  );
}

export function BankingProblems({ form }: { form: BankingForm }) {
  const { t, money, funds } = form;
  return (
    <>
      <LimitErrors form={form} />
      {funds.shortfall !== null && (
        <div className={shortfallClass}>
          <p>{t('shortBy', { amount: money(funds.shortfall) })}</p>
          <ShortfallActions form={form} />
        </div>
      )}
    </>
  );
}
