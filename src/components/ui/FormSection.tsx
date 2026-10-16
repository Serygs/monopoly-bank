import type { ReactNode } from 'react';
import { cx } from './class-names';

export interface FormSectionProps {
  /** The card title, rendered inside the card as its header. */
  legend: ReactNode;
  children: ReactNode;
  className?: string;
}

/**
 * A form card: one `fieldset` whose `legend` is the header inside the card padding (never on the
 * border), with the same typography and spacing on every screen. Styles: `.form-section` in
 * `primitives.css`; the Liquid Glass skin comes from `glass-panel`.
 */
export function FormSection({ legend, children, className }: FormSectionProps) {
  return (
    <fieldset className={cx('form-section glass-panel', className)}>
      <legend>{legend}</legend>
      {children}
    </fieldset>
  );
}
