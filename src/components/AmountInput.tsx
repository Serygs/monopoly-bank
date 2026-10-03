import { useLanguage } from '../i18n/language-context';
import { formatThousands } from '../utils/money';
import { sanitizeMoneyInput, type AmountInputState } from '../utils/money-input';
import type { AmountUnit } from '../utils/preferences';
import { AMOUNT_UNIT_LABELS, AMOUNT_UNITS } from './amount-input-state';

export function AmountInput({
  id,
  state,
  onDigitsChange,
  onUnitChange,
  invalid = false,
}: {
  id?: string;
  state: AmountInputState;
  onDigitsChange: (digits: string) => void;
  onUnitChange: (unit: AmountUnit) => void;
  invalid?: boolean;
}) {
  const { t } = useLanguage();
  const { short, note } = AMOUNT_UNIT_LABELS[state.unit];
  return (
    <div className="amount-field-row">
      <span className="amount-input-wrap">
        <input
          id={id}
          type="text"
          inputMode="numeric"
          pattern="[0-9 ]*"
          value={state.digits === '' ? '' : formatThousands(Number(state.digits))}
          onChange={(event) => onDigitsChange(sanitizeMoneyInput(event.target.value, state.unit))}
          aria-invalid={invalid}
        />
        {note !== undefined && (
          <span className="amount-unit-suffix" aria-hidden="true">
            {t(short)}
          </span>
        )}
      </span>
      <div className="amount-unit-toggle" role="group" aria-label={t('amountUnitGroup')}>
        {AMOUNT_UNITS.map((unit) => (
          <button
            key={unit}
            type="button"
            aria-pressed={state.unit === unit}
            aria-label={t(AMOUNT_UNIT_LABELS[unit].full)}
            onClick={() => onUnitChange(unit)}
          >
            {t(AMOUNT_UNIT_LABELS[unit].short)}
          </button>
        ))}
      </div>
    </div>
  );
}
