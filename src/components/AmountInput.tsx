import { useLanguage } from '../i18n/language-context';
import { formatThousands } from '../utils/money';
import { sanitizeMoneyInput, type AmountInputState } from '../utils/money-input';
import type { AmountUnit } from '../utils/preferences';
import { AMOUNT_UNIT_LABELS, AMOUNT_UNITS } from './amount-input-state';
import { cx } from './ui/class-names';

const suffixClass =
  'pointer-events-none absolute end-(--mb-space-3) top-1/2 -translate-y-1/2 font-money text-small leading-none font-bold text-secondary tabular-nums';
const unitToggleClass = cx(
  'grid w-[calc(var(--mb-control-height-md)*3+6px)] min-h-(--mb-control-height-lg) grid-cols-3 rounded-control border border-border bg-surface-subtle p-[3px]',
  'glass:border-[rgb(255_255_255/0.58)] glass:bg-[rgb(255_255_255/0.38)] glass:shadow-[inset_0_1px_0_rgb(255_255_255/0.56)]',
  'glass:backdrop-blur-[16px] glass:backdrop-saturate-[1.2]',
  'glass:dark:border-[rgb(255_255_255/0.2)] glass:dark:bg-[rgb(50_61_76/0.56)] glass:dark:shadow-[inset_0_1px_0_rgb(255_255_255/0.1)]',
);
const unitButtonClass = cx(
  'min-h-(--mb-control-height-md) min-w-0 rounded-[calc(var(--mb-radius-control)-3px)] border-0 bg-transparent p-0',
  'font-ui text-small leading-none font-semibold text-secondary',
  'transition-[color,background-color,box-shadow] duration-(--mb-duration-fast) ease-standard',
  'aria-pressed:bg-accent aria-pressed:text-on-accent aria-pressed:shadow-sm',
  'fine-pointer:hover:not-aria-pressed:bg-[color-mix(in_srgb,var(--mb-color-surface-elevated)_72%,transparent)] fine-pointer:hover:not-aria-pressed:text-primary',
  'motion-reduce:transition-none',
);

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
    <div className="grid grid-cols-[minmax(0,1fr)_auto] items-stretch gap-(--mb-space-2)">
      {/* `amount-input-wrap` keeps the input's end padding above the shared field rules. */}
      <span className="amount-input-wrap relative block min-w-0">
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
          <span className={suffixClass} aria-hidden="true">
            {t(short)}
          </span>
        )}
      </span>
      <div className={unitToggleClass} role="group" aria-label={t('amountUnitGroup')}>
        {AMOUNT_UNITS.map((unit) => (
          <button
            key={unit}
            type="button"
            className={unitButtonClass}
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
