import { useRef, useState } from 'react';
import { initialFields, type BankingFields, type BankingInputs } from './banking-dialog-fields';

export function useBankingState(inputs: BankingInputs) {
  const [fields, setFields] = useState(() => initialFields(inputs));
  const [error, setError] = useState<unknown | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);
  /** One command id per operation of the current form (keyed by its request). */
  const commandIdsRef = useRef(new Map<string, string>());

  const patch = (changes: Partial<BankingFields>) =>
    setFields((current) => ({ ...current, ...changes }));

  const edit = (changes: Partial<BankingFields>) => {
    patch(changes);
    setError(null);
    commandIdsRef.current.clear();
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
    commandIdsRef,
  };
}

export type BankingState = ReturnType<typeof useBankingState>;
