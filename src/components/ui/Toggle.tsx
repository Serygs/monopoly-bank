import { Switch } from '@headlessui/react';
import type { ReactNode } from 'react';

export interface ToggleProps {
  label: ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
  /**
   * `setting` is the settings-panel on/off row (label first, `settings-toggle`, a switch);
   * `inline` keeps a native checkbox before its label.
   */
  variant?: 'setting' | 'inline';
}

/**
 * Settings rows are semantic on/off switches (Headless UI `Switch`, `role="switch"`);
 * every other use stays a native checkbox so it keeps its platform affordance.
 */
export function Toggle({ label, checked, onChange, disabled, variant = 'setting' }: ToggleProps) {
  if (variant === 'inline')
    return (
      <label>
        <input
          type="checkbox"
          checked={checked}
          onChange={(event) => onChange(event.target.checked)}
          disabled={disabled}
        />
        {label}
      </label>
    );
  return (
    <label className="settings-toggle">
      <span>{label}</span>
      <Switch checked={checked} onChange={onChange} disabled={disabled} />
    </label>
  );
}
