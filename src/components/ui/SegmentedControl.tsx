import { Radio, RadioGroup } from '@headlessui/react';
import type { ReactNode } from 'react';
import { Button } from './Button';
import { cx, glassControlClass } from './class-names';
import { keepEnterInRadio } from './radio-keys';

export interface SegmentedOption<Value extends string> {
  value: Value;
  label: ReactNode;
}

export interface SegmentedControlProps<Value extends string> {
  options: readonly SegmentedOption<Value>[];
  value: Value;
  onChange: (value: Value) => void;
  /**
   * `settings` is the settings-panel segmented track (its fieldset legend names the choice);
   * `filter` is a labelled row of filter buttons.
   */
  variant?: 'settings' | 'filter';
  /** Settings track width; `3` uses the three-column track. */
  columns?: 2 | 3;
  /** Accessible group name; used by the `filter` variant. */
  label?: string;
  /** Container class for the `filter` variant. */
  className?: string;
}

/* `settings-segmented(--three)` stay as hooks for the unit and e2e suites. */
const settingsTrackClass =
  'grid gap-[2px] rounded-md bg-surface-subtle p-[3px] glass:w-full glass:min-w-0';

const settingsOptionClass = cx(
  'min-h-(--mb-control-height-md) rounded-[9px] border-0 font-ui text-small leading-none font-semibold transition-[color,background-color,box-shadow] duration-(--mb-duration-fast) ease-standard disabled:cursor-not-allowed disabled:opacity-48',
  'glass:max-w-full glass:min-w-0 glass:px-(--mb-space-1) glass:wrap-anywhere',
);

const settingsOptionStateClass = {
  checked: 'bg-accent text-on-accent shadow-sm',
  unchecked:
    'bg-transparent text-secondary fine-pointer:hover:bg-[color-mix(in_srgb,var(--mb-color-surface-elevated)_72%,transparent)] fine-pointer:hover:text-primary',
};

/* Filter chip on the button core; `button-filter` / `active` stay as test hooks. */
const filterOptionClass = cx(
  'button-filter min-h-10 justify-center rounded-pill border-border bg-surface-elevated px-(--mb-space-3) py-[10px] text-small leading-[1.15] text-secondary',
  'aria-checked:border-accent aria-checked:bg-accent aria-checked:text-on-accent',
  glassControlClass,
  'glass:aria-checked:border-[rgb(255_255_255/0.34)] glass:aria-checked:bg-[rgb(45_65_90/0.8)] glass:aria-checked:text-white',
);

/**
 * Mutually exclusive choice on Headless UI `RadioGroup`: one tab stop, arrow keys move and
 * select, and each option exposes `role="radio"` with `aria-checked`.
 */
export function SegmentedControl<Value extends string>({
  options,
  value,
  onChange,
  variant = 'settings',
  columns = 2,
  label,
  className,
}: SegmentedControlProps<Value>) {
  if (variant === 'filter')
    return (
      <RadioGroup value={value} onChange={onChange} className={className} aria-label={label}>
        {options.map((option) => (
          <Radio
            as={Button}
            key={option.value}
            value={option.value}
            className={cx(filterOptionClass, option.value === value && 'active')}
            onKeyDown={keepEnterInRadio}
          >
            {option.label}
          </Radio>
        ))}
      </RadioGroup>
    );
  return (
    <RadioGroup
      value={value}
      onChange={onChange}
      className={cx(
        'settings-segmented',
        columns === 3 && 'settings-segmented--three',
        settingsTrackClass,
        columns === 3 ? 'grid-cols-3' : 'grid-cols-2',
      )}
      aria-label={label}
    >
      {options.map((option) => (
        <Radio
          as="button"
          type="button"
          key={option.value}
          value={option.value}
          className={cx(
            settingsOptionClass,
            settingsOptionStateClass[option.value === value ? 'checked' : 'unchecked'],
          )}
          onKeyDown={keepEnterInRadio}
        >
          {option.label}
        </Radio>
      ))}
    </RadioGroup>
  );
}
