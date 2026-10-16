import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { cx } from './class-names';

export interface AnchoredPopoverProps {
  /** The element the popover hangs under; taps on it do not count as outside taps. */
  anchorRef: RefObject<HTMLElement | null>;
  id?: string;
  /** Accessible name; the panel is `role="dialog"`. */
  label: string;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  /** Maximum panel width in px (it never exceeds the viewport minus the gutters). */
  maxWidth?: number;
}

const GUTTER = 12;

/**
 * A popover that renders in `document.body` at fixed coordinates, so no card, `overflow` or
 * sibling stacking context (glass panels each create one) can clip it or paint over it. It uses
 * the shared `glass-popover` surface, and closes on outside tap, Escape and scroll or resize.
 */
export function AnchoredPopover({
  anchorRef,
  id,
  label,
  onClose,
  children,
  className,
  maxWidth = 352,
}: AnchoredPopoverProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<CSSProperties>({ visibility: 'hidden' });

  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    if (anchor === null) return;
    const rect = anchor.getBoundingClientRect();
    const width = Math.min(maxWidth, window.innerWidth - 2 * GUTTER);
    const left = Math.max(GUTTER, Math.min(rect.right - width, window.innerWidth - width - GUTTER));
    setStyle({ position: 'fixed', top: rect.bottom + 8, left, width });
  }, [anchorRef, maxWidth]);

  useEffect(() => {
    const closeFromOutside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (panelRef.current?.contains(target) || anchorRef.current?.contains(target)) return;
      onClose();
    };
    const closeFromEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('pointerdown', closeFromOutside);
    document.addEventListener('keydown', closeFromEscape);
    window.addEventListener('resize', onClose);
    return () => {
      document.removeEventListener('pointerdown', closeFromOutside);
      document.removeEventListener('keydown', closeFromEscape);
      window.removeEventListener('resize', onClose);
    };
  }, [anchorRef, onClose]);

  return createPortal(
    <div
      ref={panelRef}
      id={id}
      role="dialog"
      aria-label={label}
      style={style}
      className={cx(
        'glass-popover z-[120] rounded-card border border-border bg-surface-elevated p-(--mb-space-2) text-primary shadow-lg',
        className,
      )}
    >
      {children}
    </div>,
    document.body,
  );
}
