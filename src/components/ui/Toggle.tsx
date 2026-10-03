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

/*
 * `settings-toggle` stays as the unit-test hook. `flex!` keeps the row a flex line even inside
 * containers whose label rules set `display: grid`.
 */
const settingRowClass =
  'settings-toggle flex! min-h-(--mb-control-height-lg) items-center justify-between rounded-control border border-border px-(--mb-space-3) py-0 fine-pointer:hover:border-strong fine-pointer:hover:bg-surface-subtle glass:min-w-0';

/** 40×24 track with an 18px knob that slides 16px when on. */
const switchClass =
  'm-0 flex h-[24px] w-[40px] appearance-none glass:flex-none rounded-pill border border-strong bg-surface-subtle p-0 transition-[border-color,background-color] duration-(--mb-duration-fast) ease-standard before:m-[2px] before:block before:size-[18px] before:rounded-[50%] before:bg-surface-elevated before:shadow-sm before:transition-transform before:duration-(--mb-duration-normal) before:ease-standard aria-checked:border-accent aria-checked:bg-accent aria-checked:before:translate-x-[16px]';

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
    <label className={settingRowClass}>
      <span>{label}</span>
      <Switch checked={checked} onChange={onChange} disabled={disabled} className={switchClass} />
    </label>
  );
}
