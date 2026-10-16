import { cx } from './class-names';
import { Button } from './Button';

export interface StepperBarProps {
  label: string;
  /** Zero-based index of the current step. */
  step: number;
  total: number;
  /** "Step 1 of 3", already translated. */
  indicator: string;
  backLabel: string;
  /** The primary action: "Next" on every step but the last, then the final action. */
  nextLabel: string;
  onBack: () => void;
  onNext: () => void;
  busy?: boolean;
  className?: string;
}

/* Sits where the main navigation sits, so both share one height token and one safe-area inset. */
const barClass = cx(
  'fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface-elevated shadow-lg',
  'pb-[max(var(--mb-space-2),var(--mb-app-safe-bottom))]',
  'glass-panel border-x-0 border-b-0',
);
const innerClass =
  'mx-auto grid w-[min(100%,var(--mb-layout-content-max))] gap-(--mb-space-2) px-(--mb-space-4) pt-(--mb-space-2)';
const dotClass = 'size-2 rounded-full bg-border-strong';

/** The create-flow footer: step indicator on top, Back and Next / final action below. */
export function StepperBar({
  label,
  step,
  total,
  indicator,
  backLabel,
  nextLabel,
  onBack,
  onNext,
  busy = false,
  className,
}: StepperBarProps) {
  return (
    <nav className={cx(barClass, className)} aria-label={label}>
      <div className={innerClass}>
        <div className="flex items-center justify-center gap-(--mb-space-2)">
          <ol className="m-0 flex list-none gap-(--mb-space-2) p-0" aria-hidden="true">
            {Array.from({ length: total }, (_, index) => (
              <li key={index} className={cx(dotClass, index <= step && 'bg-accent')} />
            ))}
          </ol>
          <span className="text-small font-semibold text-secondary" role="status">
            {indicator}
          </span>
        </div>
        <div className={cx('grid gap-(--mb-space-2)', step > 0 ? 'grid-cols-[1fr_2fr]' : '')}>
          {step > 0 && (
            <Button variant="secondary" onClick={onBack} disabled={busy}>
              {backLabel}
            </Button>
          )}
          <Button variant="primary" onClick={onNext} disabled={busy}>
            {nextLabel}
          </Button>
        </div>
      </div>
    </nav>
  );
}
