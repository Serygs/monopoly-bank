import { cloneElement, useId, type AriaAttributes, type ReactElement, type ReactNode } from 'react';
import { cx } from './class-names';

export interface FieldControlProps {
  id?: string;
  'aria-describedby'?: string;
  'aria-errormessage'?: string;
  'aria-invalid'?: AriaAttributes['aria-invalid'];
}

export interface FieldProps {
  label: ReactNode;
  /** The single form control this label describes. */
  children: ReactElement<FieldControlProps>;
  hint?: ReactNode;
  error?: ReactNode;
  /** Secondary label text such as "optional", rendered after the label. */
  note?: ReactNode;
  /** `dialog` uses the dialog field layout (`dialog-field`). */
  variant?: 'form' | 'dialog';
  /** Wraps the label text in a `<span>`. */
  wrapLabel?: boolean;
  /** `small` renders the hint as an unclassed `<small>`. */
  hintElement?: 'span' | 'small';
  className?: string;
}

/** Label ↔ control ↔ hint/error wiring: `htmlFor`, `aria-describedby`, `aria-errormessage`. */
export function Field({
  label,
  children,
  hint,
  error,
  note,
  variant = 'form',
  wrapLabel = false,
  hintElement = 'span',
  className,
}: FieldProps) {
  const fieldId = useId();
  const controlId = children.props.id ?? `${fieldId}control`;
  const hintId = hint === undefined ? undefined : `${fieldId}hint`;
  const errorId = error === undefined ? undefined : `${fieldId}error`;
  const control = cloneElement(children, {
    id: controlId,
    'aria-describedby': cx(children.props['aria-describedby'], hintId),
    'aria-errormessage': errorId,
    'aria-invalid': children.props['aria-invalid'] ?? (error === undefined ? undefined : true),
  });
  return (
    <label className={cx(variant === 'dialog' && 'dialog-field', className)} htmlFor={controlId}>
      {wrapLabel ? <span>{label}</span> : label}
      {note !== undefined && (
        <>
          {' '}
          <FieldNote>{note}</FieldNote>
        </>
      )}
      {control}
      {hint !== undefined &&
        (hintElement === 'small' ? (
          <small id={hintId}>{hint}</small>
        ) : (
          <FieldHint id={hintId}>{hint}</FieldHint>
        ))}
      {error !== undefined && <FieldError id={errorId}>{error}</FieldError>}
    </label>
  );
}

export interface FieldTextProps {
  children: ReactNode;
  id?: string;
  as?: 'span' | 'p';
}

/*
 * `field-hint` / `field-note` stay as hooks: the create-lobby players heading resets the
 * `.field-hint` margin, and `AvatarPicker` widens it on compact screens.
 */
const fieldTextClass = 'text-small font-regular text-muted';

/** Supporting copy for a control (`field-hint`). */
export function FieldHint({ as: Element = 'span', ...props }: FieldTextProps) {
  return <Element className={cx('field-hint', fieldTextClass)} {...props} />;
}

/** Secondary label text (`field-note`). */
export function FieldNote({ as: Element = 'span', ...props }: FieldTextProps) {
  return <Element className={cx('field-note', fieldTextClass)} {...props} />;
}

export interface FieldErrorProps extends FieldTextProps {
  /** Announce the error as soon as it appears (`role="alert"`). */
  announce?: boolean;
}

/** Validation message for a control. */
export function FieldError({ as: Element = 'span', announce = false, ...props }: FieldErrorProps) {
  return (
    <Element
      className="text-small font-semibold text-danger"
      role={announce ? 'alert' : undefined}
      {...props}
    />
  );
}
