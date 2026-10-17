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

/* Like the sheet action bar: no surface of its own, a canvas fade under the pill buttons. */
const barClass = cx(
  'fixed inset-x-0 bottom-0 z-30',
  'bg-linear-to-t from-canvas from-70% to-transparent',
  'pb-[max(var(--mb-space-4),var(--mb-app-safe-bottom))]',
);
const innerClass =
  'mx-auto grid w-[min(100%,var(--mb-layout-content-max))] gap-(--mb-space-3) px-[max(18px,var(--mb-app-safe-left))] pt-(--mb-space-6)';
const dotClass =
  'h-2 w-2 rounded-pill bg-border-strong motion-safe:transition-[width,background-color] motion-safe:duration-(--mb-duration-normal)';

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
              <li
                key={index}
                data-state={index < step ? 'done' : index === step ? 'current' : 'upcoming'}
                className={cx(
                  dotClass,
                  index < step && 'bg-accent',
                  index === step && 'w-6 bg-accent ring-2 ring-accent/30',
                )}
              />
            ))}
          </ol>
          <span className="text-small font-semibold text-secondary" role="status">
            {indicator}
          </span>
        </div>
        <div className={cx('grid gap-(--mb-space-2)', step > 0 ? 'grid-cols-[1fr_1.4fr]' : '')}>
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
