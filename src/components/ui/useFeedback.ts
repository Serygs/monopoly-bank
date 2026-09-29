import { createContext, useContext } from 'react';
import type { NoticeTone } from './class-names';

/** A transient message for the app-wide notification region. */
export interface FeedbackMessage {
  tone: NoticeTone;
  /** Already-translated copy (`useLanguage().t`). */
  message: string;
}

export type Notify = (feedback: FeedbackMessage) => void;

export const FeedbackContext = createContext<Notify | null>(null);

/** Auto-dismiss delay for polite (success and info) toasts; errors stay until dismissed. */
export const TOAST_DURATION_MS = 6000;
/** Oldest toasts are dropped beyond this many. */
export const TOAST_LIMIT = 3;

/**
 * Queues a transient outcome message ("Profile updated.") in the notification region mounted
 * by `FeedbackProvider`. Form validation errors are not for this: they stay beside their field.
 */
export function useFeedback(): Notify {
  const notify = useContext(FeedbackContext);
  if (notify === null) {
    throw new Error('useFeedback must be used inside FeedbackProvider.');
  }
  return notify;
}
