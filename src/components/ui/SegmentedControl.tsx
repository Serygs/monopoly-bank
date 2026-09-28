import { Radio, RadioGroup } from '@headlessui/react';
import type { ReactNode } from 'react';
import { Button } from './Button';
import { cx } from './class-names';
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
            className={cx('button-filter', option.value === value && 'active')}
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
      className={cx('settings-segmented', columns === 3 && 'settings-segmented--three')}
      aria-label={label}
    >
      {options.map((option) => (
        <Radio
          as="button"
          type="button"
          key={option.value}
          value={option.value}
          className={cx(option.value === value && 'active')}
          onKeyDown={keepEnterInRadio}
        >
          {option.label}
        </Radio>
      ))}
    </RadioGroup>
  );
}
