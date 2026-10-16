import type { Currency, Mortgage } from '../../../shared/types/monopoly';
import { MAX_PROPERTY_NAME_LENGTH, redemptionCost } from '../../../shared/domain/mortgage';
import { Field, FieldHint, Toggle } from '../../components/ui';
import { cx } from '../../components/ui/class-names';
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

const pickerClass = cx(
  'mx-0 my-(--mb-space-3) grid gap-(--mb-space-2) border-0 p-0 [&>legend]:mb-(--mb-space-2) [&>legend]:font-semibold [&>legend]:text-primary',
  '[&_button]:grid [&_button]:min-h-[56px] [&_button]:gap-[2px] [&_button]:rounded-[11px] [&_button]:border [&_button]:border-border',
  '[&_button]:bg-surface-elevated [&_button]:p-[10px] [&_button]:text-left [&_button]:font-semibold [&_button]:text-primary',
  '[&_button]:transition-[color,background-color,border-color,box-shadow] [&_button]:duration-(--mb-duration-fast) [&_button]:ease-standard',
  '[&_button[aria-pressed=true]]:border-accent [&_button[aria-pressed=true]]:bg-surface-subtle [&_button[aria-pressed=true]]:shadow-[inset_0_0_0_1px_var(--mb-color-accent)]',
  '[&_small]:font-regular [&_small]:text-secondary',
);

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
