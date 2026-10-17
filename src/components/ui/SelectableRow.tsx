import type { ReactNode } from 'react';
import { cx } from './class-names';

export interface SelectableRowProps {
  selected: boolean;
  onSelect: () => void;
  /** `radio` for choose-one lists, `check` for choose-many. */
  indicator?: 'radio' | 'check';
  /** Content before the title, e.g. a colour dot or an avatar. */
  leading?: ReactNode;
  title: ReactNode;
  caption?: ReactNode;
  trailing?: ReactNode;
  disabled?: boolean;
  className?: string;
}

/** The selection mark: a ring (radio) or box (check) that is filled and ticked when selected. */
function Indicator({ kind, selected }: { kind: 'radio' | 'check'; selected: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cx(
        'inline-flex size-5 shrink-0 items-center justify-center border-2 transition-[background-color,border-color] duration-(--mb-duration-fast)',
        kind === 'radio' ? 'rounded-full' : 'rounded-[6px]',
        selected ? 'border-accent bg-accent text-on-accent' : 'border-strong bg-transparent',
      )}
    >
      {selected &&
        (kind === 'radio' ? (
          <span className="size-2 rounded-full bg-current" />
        ) : (
          <svg viewBox="0 0 16 16" className="size-3.5" fill="none" stroke="currentColor">
            <path
              d="M3.5 8.5l3 3 6-7"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        ))}
    </span>
  );
}

/**
 * A pressable row for choosing from a list. Selection is shown by the indicator, the accent
 * border and `aria-pressed`, never by colour alone.
 */
export function SelectableRow({
  selected,
  onSelect,
  indicator = 'check',
  leading,
  title,
  caption,
  trailing,
  disabled,
  className,
}: SelectableRowProps) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      disabled={disabled}
      onClick={onSelect}
      className={cx(
        'selectable-row grid min-h-[56px] w-full cursor-pointer grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-(--mb-space-3) rounded-control border bg-surface-elevated px-(--mb-space-3) py-(--mb-space-2) text-start font-ui text-primary',
        'transition-[color,background-color,border-color,box-shadow] duration-(--mb-duration-fast) ease-standard focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-48',
        selected
          ? 'border-accent bg-surface-subtle shadow-[inset_0_0_0_1px_var(--mb-color-accent)]'
          : 'border-border',
        className,
      )}
    >
      <Indicator kind={indicator} selected={selected} />
      <span className="flex min-w-0 items-center gap-(--mb-space-2)">
        {leading}
        <span className="grid min-w-0 gap-[2px]">
          <span className="font-semibold wrap-anywhere">{title}</span>
          {caption !== undefined && <small className="font-normal text-secondary">{caption}</small>}
        </span>
      </span>
      {trailing !== undefined && <span className="shrink-0">{trailing}</span>}
    </button>
  );
}
