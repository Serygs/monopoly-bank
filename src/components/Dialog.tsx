import { useEffect, useId, useRef, type ReactNode } from 'react';

const focusableSelector = 'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

interface DialogProps {
  title: string;
  children: ReactNode;
  onClose: () => void;
  closeLabel: string;
  eyebrow?: string;
  className?: string;
  closeDisabled?: boolean;
}

export function Dialog({ title, children, onClose, closeLabel, eyebrow, className = '', closeDisabled = false }: DialogProps) {
  const titleId = useId();
  const dialogRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const timer = window.setTimeout(() => firstFocusable(dialogRef.current)?.focus(), 0);

    return () => {
      window.clearTimeout(timer);
      document.body.style.overflow = originalOverflow;
      previousFocus?.focus();
    };
  }, []);

  const onKeyDown = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape' && !closeDisabled) {
      event.preventDefault();
      onClose();
      return;
    }
    if (event.key !== 'Tab') return;

    const focusable = focusableElements(dialogRef.current);
    if (focusable.length === 0) {
      event.preventDefault();
      dialogRef.current?.focus();
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return <div className="dialog-backdrop" role="presentation" onMouseDown={() => { if (!closeDisabled) onClose(); }}>
    <section ref={dialogRef} className={`dialog ${className}`.trim()} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} onKeyDown={onKeyDown} onMouseDown={(event) => event.stopPropagation()}>
      <header>
        <div>
          {eyebrow !== undefined && <p className="eyebrow">{eyebrow}</p>}
          <h2 id={titleId}>{title}</h2>
        </div>
        <button className="button button-quiet icon-button dialog-close" type="button" onClick={onClose} disabled={closeDisabled} aria-label={closeLabel}>×</button>
      </header>
      {children}
    </section>
  </div>;
}

function focusableElements(element: HTMLElement | null): HTMLElement[] {
  return element === null ? [] : Array.from(element.querySelectorAll<HTMLElement>(focusableSelector));
}

function firstFocusable(element: HTMLElement | null): HTMLElement | null {
  return focusableElements(element)[0] ?? element;
}
