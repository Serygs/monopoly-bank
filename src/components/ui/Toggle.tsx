import type { InputHTMLAttributes, ReactNode } from 'react';

export interface ToggleProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'type' | 'checked' | 'onChange' | 'children'
> {
  label: ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
  /**
   * `setting` is the settings-panel on/off row (label first, `settings-toggle`);
   * `inline` keeps the native checkbox before its label.
   */
  variant?: 'setting' | 'inline';
}

/** Native checkbox in the wrapper its context expects. */
export function Toggle({ label, checked, onChange, variant = 'setting', ...props }: ToggleProps) {
  const input = (
    <input
      type="checkbox"
      checked={checked}
      onChange={(event) => onChange(event.target.checked)}
      {...props}
    />
  );
  if (variant === 'inline')
    return (
      <label>
        {input}
        {label}
      </label>
    );
  return (
    <label className="settings-toggle">
      <span>{label}</span>
      {input}
    </label>
  );
}
