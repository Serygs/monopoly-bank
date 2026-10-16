import type { Currency, Mortgage } from '../../../shared/types/monopoly';
import { MAX_PROPERTY_NAME_LENGTH, redemptionCost } from '../../../shared/domain/mortgage';
import { Field, FieldHint, Toggle } from '../../components/ui';
import { pickerClass } from './picker-class';
import { useLanguage } from '../../i18n/language-context';
import { formatMoney } from '../../utils/money';

export interface MortgageDetailsProps {
  propertyName: string;
  onPropertyNameChange: (name: string) => void;
  noBuildings: boolean;
  onNoBuildingsChange: (confirmed: boolean) => void;
}

/** The name of the property and the honour-system confirmation that it has no buildings. */
export function MortgageDetails({
  propertyName,
  onPropertyNameChange,
  noBuildings,
  onNoBuildingsChange,
}: MortgageDetailsProps) {
  const { t } = useLanguage();
  return (
    <div className="grid gap-(--mb-space-3)">
      <Field variant="dialog" label={t('propertyName')}>
        <input
          value={propertyName}
          maxLength={MAX_PROPERTY_NAME_LENGTH}
          placeholder={t('propertyNamePlaceholder')}
          autoComplete="off"
          onChange={(event) => onPropertyNameChange(event.target.value)}
        />
      </Field>
      <Toggle
        variant="inline"
        label={t('noBuildingsConfirm')}
        checked={noBuildings}
        onChange={onNoBuildingsChange}
      />
    </div>
  );
}

export interface RedemptionPickerProps {
  mortgages: Mortgage[];
  currency: Currency;
  value: string;
  onChange: (mortgage: Mortgage) => void;
}

/** The player's mortgaged properties with what each costs to redeem. */
export function RedemptionPicker({ mortgages, currency, value, onChange }: RedemptionPickerProps) {
  const { t } = useLanguage();
  return (
    <fieldset className={pickerClass}>
      <legend>{t('chooseMortgage')}</legend>
      {mortgages.length === 0 && <FieldHint>{t('noMortgages')}</FieldHint>}
      {mortgages.map((mortgage) => (
        <button
          type="button"
          key={mortgage.id}
          aria-pressed={value === mortgage.id}
          onClick={() => onChange(mortgage)}
        >
          <span>{mortgage.propertyName}</span>
          <small>
            {t('redeemFor', {
              cost: formatMoney(redemptionCost(mortgage.mortgageValue), currency),
              value: formatMoney(mortgage.mortgageValue, currency),
            })}
          </small>
        </button>
      ))}
    </fieldset>
  );
}
