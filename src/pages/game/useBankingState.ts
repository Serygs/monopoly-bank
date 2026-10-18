import { useRef, useState } from 'react';
import { initialFields, type BankingFields, type BankingInputs } from './banking-dialog-fields';

export function useBankingState(inputs: BankingInputs) {
  const [fields, setFields] = useState(() => initialFields(inputs));
  const [error, setError] = useState<unknown | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  const commandIdRef = useRef<string | null>(null);

  const patch = (changes: Partial<BankingFields>) =>
    setFields((current) => ({ ...current, ...changes }));

  const edit = (changes: Partial<BankingFields>) => {
    patch(changes);
    setError(null);
    commandIdRef.current = null;
  };

  return {
    fields,
    patch,
    edit,
    error,
    setError,
    submitting,
    setSubmitting,
    submittingRef,
    commandIdRef,
  };
}

export type BankingState = ReturnType<typeof useBankingState>;
