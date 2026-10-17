import type { ReactNode } from 'react';
import { Toggle } from './Toggle';

export interface ToggleRowProps {
  label: ReactNode;
  checked: boolean;
  onChange: (checked: boolean) => void;
  description?: ReactNode;
  disabled?: boolean;
}

/**
 * A full-width on/off row: label left, switch right, at least 44px tall and ruled off from its
 * sibling rows. It renders the kit `Toggle` in its `row` variant (a semantic switch).
 */
export function ToggleRow({ label, checked, onChange, description, disabled }: ToggleRowProps) {
  return (
    <Toggle
      variant="row"
      label={label}
      checked={checked}
      onChange={onChange}
      description={description}
      disabled={disabled}
    />
  );
}
