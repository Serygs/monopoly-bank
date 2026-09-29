import type { ReactNode } from 'react';
import { toolPanelClass } from './class-names';
import { Eyebrow, MutedText } from './Text';

export interface ToolPanelProps {
  /** Accessible name of the panel section. */
  label: string;
  eyebrow: string;
  title: string;
  description: string;
  children: ReactNode;
}

/** Elevated table-tool card (`DiceRoller`, `TableCalculator`): kicker, title and hint, then the tool. */
export function ToolPanel({ label, eyebrow, title, description, children }: ToolPanelProps) {
  return (
    <section className={toolPanelClass} aria-label={label}>
      <div>
        <Eyebrow>{eyebrow}</Eyebrow>
        <h2 className="m-0 text-primary">{title}</h2>
        <MutedText>{description}</MutedText>
      </div>
      {children}
    </section>
  );
}
