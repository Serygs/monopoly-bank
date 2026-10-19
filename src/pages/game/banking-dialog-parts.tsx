import type { ReactNode } from 'react';
import { stepBodyClass } from './banking-dialog-styles';

export function StepBody({ children }: { children: ReactNode }) {
  return <div className={stepBodyClass}>{children}</div>;
}
