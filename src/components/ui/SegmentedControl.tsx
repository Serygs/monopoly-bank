import type { ReactNode } from 'react';
import { Button } from './Button';
import { cx } from './class-names';

export interface SegmentedOption<Value extends string> {
  value: Value;
  label: ReactNode;
}

export interface SegmentedControlProps<Value extends string> {
  options: readonly SegmentedOption<Value>[];
  value: Value;
  onChange: (value: Value) => void;
  /**
   * `settings` is the settings-panel segmented track (no group role: its fieldset names it);
   * `filter` is a labelled `role="group"` row of filter buttons.
   */
  variant?: 'settings' | 'filter';
  /** Settings track width; `3` uses the three-column track. */
  columns?: 2 | 3;
  /** Accessible group name; used by the `filter` variant. */
  label?: string;
  /** Container class for the `filter` variant. */
  className?: string;
}

/** Mutually exclusive choice rendered as `aria-pressed` buttons. */
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
      <div className={className} role="group" aria-label={label}>
        {options.map((option) => (
          <Button
            className={cx('button-filter', option.value === value && 'active')}
            key={option.value}
            aria-pressed={option.value === value}
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </Button>
        ))}
      </div>
    );
  return (
    <div className={cx('settings-segmented', columns === 3 && 'settings-segmented--three')}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={cx(option.value === value && 'active')}
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
