import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useLanguage } from '../../i18n/language-context';
import { cx, type NoticeTone } from './class-names';
import { Toast } from './Toast';
import { FeedbackContext, TOAST_DURATION_MS, TOAST_LIMIT, type Notify } from './useFeedback';

interface QueuedToast {
  id: number;
  tone: NoticeTone;
  message: string;
}

/** An auto-dismiss countdown; `handle` is unset while the toast is held (paused). */
interface DismissTimer {
  handle: number | undefined;
  remaining: number;
  startedAt: number;
}

/*
 * Top-centre stack, clear of the iOS status bar, above the dialog layer (`z-100`). The region
 * ignores the pointer so an empty region never blocks the header; each toast re-enables it.
 * Both live stacks share the column layout through `*:`.
 */
const regionClass = cx(
  'pointer-events-none fixed inset-x-0 top-0 z-110 grid justify-items-center gap-(--mb-space-2)',
  'pt-[calc(var(--mb-app-safe-top)_+_var(--mb-space-3))] pr-[max(var(--mb-space-3),env(safe-area-inset-right))] pl-[max(var(--mb-space-3),env(safe-area-inset-left))]',
  // The live stacks stay rendered while empty: a live region that appears with its content is
  // often not announced.
  '*:grid *:w-[min(100%,28rem)] *:gap-(--mb-space-2)',
);

/**
 * Mounts the single app-wide notification region and provides `useFeedback()`.
 *
 * The region is portalled straight into `<body>`: Headless UI's modal only makes the app root
 * inert, and it treats other `body > *` nodes as third-party roots, so a toast raised from inside
 * an open dialog is still announced and clickable without dismissing the dialog.
 *
 * Success and info toasts sit in a `polite` live stack and leave after `TOAST_DURATION_MS`;
 * errors sit in an `assertive` stack and stay until dismissed. Toasts carry no role of their own,
 * so each message is announced exactly once. A toast under the pointer or holding focus pauses
 * its countdown and resumes with the time it had left (WCAG 2.2.1 Timing Adjustable).
 */
export function FeedbackProvider({ children }: { children: ReactNode }) {
  const { t } = useLanguage();
  const [toasts, setToasts] = useState<readonly QueuedToast[]>([]);
  const nextId = useRef(0);
  const timers = useRef(new Map<number, DismissTimer>());

  const dismiss = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer !== undefined) window.clearTimeout(timer.handle);
    timers.current.delete(id);
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const resume = useCallback(
    (id: number) => {
      const timer = timers.current.get(id);
      if (timer === undefined || timer.handle !== undefined) return;
      timer.startedAt = Date.now();
      timer.handle = window.setTimeout(() => dismiss(id), timer.remaining);
    },
    [dismiss],
  );

  const pause = useCallback((id: number) => {
    const timer = timers.current.get(id);
    if (timer === undefined || timer.handle === undefined) return;
    window.clearTimeout(timer.handle);
    timer.handle = undefined;
    timer.remaining = Math.max(0, timer.remaining - (Date.now() - timer.startedAt));
  }, []);

  const notify = useCallback<Notify>(
    ({ tone, message }) => {
      nextId.current += 1;
      const id = nextId.current;
      // A repeated message replaces its earlier copy, so it is announced again, not stacked.
      setToasts((current) =>
        [
          ...current.filter((toast) => toast.tone !== tone || toast.message !== message),
          { id, tone, message },
        ].slice(-TOAST_LIMIT),
      );
      if (tone !== 'error') {
        timers.current.set(id, {
          handle: undefined,
          remaining: TOAST_DURATION_MS,
          startedAt: 0,
        });
        resume(id);
      }
    },
    [resume],
  );

  // A toast replaced by a repeat or pushed out by the stack cap drops its countdown too, even
  // while it was held.
  useEffect(() => {
    for (const [id, timer] of timers.current)
      if (!toasts.some((toast) => toast.id === id)) {
        window.clearTimeout(timer.handle);
        timers.current.delete(id);
      }
  }, [toasts]);

  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending.values()) window.clearTimeout(timer.handle);
      pending.clear();
    };
  }, []);

  const renderToast = (toast: QueuedToast) => (
    <Toast
      key={toast.id}
      tone={toast.tone}
      message={toast.message}
      closeLabel={t('dismissNotification')}
      onDismiss={() => dismiss(toast.id)}
      onPause={() => pause(toast.id)}
      onResume={() => resume(toast.id)}
    />
  );

  return (
    <FeedbackContext.Provider value={notify}>
      {children}
      {createPortal(
        <section className={regionClass} aria-label={t('notificationsRegion')}>
          <div aria-live="polite">
            {toasts.filter((toast) => toast.tone !== 'error').map(renderToast)}
          </div>
          <div aria-live="assertive">
            {toasts.filter((toast) => toast.tone === 'error').map(renderToast)}
          </div>
        </section>,
        document.body,
      )}
    </FeedbackContext.Provider>
  );
}
