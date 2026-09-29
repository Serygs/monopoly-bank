import type { FormEvent, ReactNode } from 'react';
import { BankSeal } from './BankSeal';
import { Eyebrow } from './Text';

/** Heading row of the sign-in and join cards: the bank seal beside the eyebrow and title. */
const authHeadingClass = 'flex min-w-0 items-center gap-(--mb-space-4) [&>div]:min-w-0';

/** Sign-in, join and email-token forms: the full-width primary submit. */
const authFormClass =
  'game-form [&_.button-primary]:w-full [&_.button-primary]:min-h-(--mb-control-height-lg)';

export interface AuthHeadingProps {
  eyebrow: string;
  title: string;
}

/** The auth-card heading: `MB` seal, eyebrow and the page `h1`. */
export function AuthHeading({ eyebrow, title }: AuthHeadingProps) {
  return (
    <div className={authHeadingClass}>
      <BankSeal variant="auth" />
      <div>
        <Eyebrow>{eyebrow}</Eyebrow>
        <h1>{title}</h1>
      </div>
    </div>
  );
}

export interface AuthFormProps {
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  children: ReactNode;
}

/** The form of an auth card (sign-in, join, email token); its primary submit spans the card. */
export function AuthForm({ onSubmit, children }: AuthFormProps) {
  return (
    <form className={authFormClass} onSubmit={onSubmit}>
      {children}
    </form>
  );
}
