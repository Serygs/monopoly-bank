import {
  interestRatePercents,
  type Currency,
  type InterestRatePercent,
  type Loan,
  type Player,
} from '../../../shared/types/monopoly';
import { FieldHint } from '../../components/ui';
import { useLanguage } from '../../i18n/language-context';
import { loanOutstanding } from '../../utils/loans';
import { formatMoney } from '../../utils/money';
import { pickerClass } from './picker-class';

export interface LoanPickerProps {
  loans: Loan[];
  players: Player[];
  currency: Currency;
  value: string;
  onChange: (loan: Loan) => void;
}

/** The borrower's active loans, each with the lender and what is still owed. */
export function LoanPicker({ loans, players, currency, value, onChange }: LoanPickerProps) {
  const { t } = useLanguage();
  return (
    <fieldset className={pickerClass}>
      <legend>{t('chooseLoan')}</legend>
      {loans.length === 0 && <FieldHint>{t('noLoans')}</FieldHint>}
      {loans.map((loan) => {
        const lender = players.find((candidate) => candidate.id === loan.lenderPlayerId);
        const outstanding = formatMoney(loanOutstanding(loan), currency);
        return (
          <button
            type="button"
            key={loan.id}
            aria-pressed={value === loan.id}
            onClick={() => onChange(loan)}
          >
            <span>
              {loan.lenderKind === 'BANK'
                ? t('bankLoanOutstanding', {
                    bank: t('bank'),
                    outstanding,
                    round: loan.rounds?.round ?? 1,
                  })
                : t('loanOutstanding', {
                    lender: lender?.name ?? t('playerFallback'),
                    outstanding,
                  })}
            </span>
          </button>
        );
      })}
    </fieldset>
  );
}

export interface InterestRatePickerProps {
  value: InterestRatePercent;
  /** The rate the round tracking suggests; labelled with the round it applies to. */
  suggested: InterestRatePercent;
  round: number;
  onChange: (rate: InterestRatePercent) => void;
}

/** 0% / 10% / 20% for repaying a bank loan, with the suggested one marked. */
export function InterestRatePicker({ value, suggested, round, onChange }: InterestRatePickerProps) {
  const { t } = useLanguage();
  return (
    <fieldset className={pickerClass}>
      <legend>{t('interestRate')}</legend>
      {interestRatePercents.map((rate) => (
        <button
          type="button"
          key={rate}
          aria-pressed={value === rate}
          onClick={() => onChange(rate)}
        >
          <span>{rate === suggested ? t('interestSuggested', { rate, round }) : `${rate}%`}</span>
        </button>
      ))}
    </fieldset>
  );
}
