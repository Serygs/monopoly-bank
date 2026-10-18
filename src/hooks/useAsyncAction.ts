import { useCallback, useRef, useState } from 'react';

export interface AsyncAction {
  busy: boolean;
  error: unknown | null;
  setError: (error: unknown | null) => void;
  run: (action: () => Promise<void>, onError?: (caught: unknown) => void) => Promise<void>;
}

export function useAsyncAction(): AsyncAction {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown | null>(null);
  const running = useRef(false);
  const run = useCallback(
    async (action: () => Promise<void>, onError?: (caught: unknown) => void) => {
      if (running.current) return;
      running.current = true;
      setBusy(true);
      setError(null);
      try {
        await action();
      } catch (caught) {
        setError(caught);
        onError?.(caught);
      } finally {
        running.current = false;
        setBusy(false);
      }
    },
    [],
  );
  return { busy, error, setError, run };
}
