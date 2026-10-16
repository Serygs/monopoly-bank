import type { Currency, Loan, Player } from '../../../shared/types/monopoly';
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
        return (
          <button
            type="button"
            key={loan.id}
            aria-pressed={value === loan.id}
            onClick={() => onChange(loan)}
          >
            <span>
              {t('loanOutstanding', {
                lender: lender?.name ?? t('playerFallback'),
                outstanding: formatMoney(loanOutstanding(loan), currency),
              })}
            </span>
          </button>
        );
      })}
    </fieldset>
  );
}
