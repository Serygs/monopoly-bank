import { useEffect, useState, type FormEvent } from 'react';
import type { UserProfile } from '../../shared/contracts/api.js';
import { monopolyBankApi } from '../api/monopoly-bank-api';
import { Button, Field, Notice, PageShell, StatPill } from '../components/ui';
import { apiErrorMessage } from '../i18n/api-errors';
import { useLanguage } from '../i18n/language-context';
import { authFormClass, ledeClass } from '../components/ui/class-names';

export function VerifyEmailPage({
  token,
  onVerified,
  onBack,
}: {
  token: string;
  onVerified: (profile: UserProfile) => void;
  onBack: () => void;
}) {
  const { t } = useLanguage();
  const [error, setError] = useState<unknown>(null);
  const [verified, setVerified] = useState(false);
  useEffect(() => {
    let active = true;
    const verify = async () => {
      try {
        const profile = await monopolyBankApi.verifyEmail(token);
        if (active) {
          window.history.replaceState({}, '', '/verify-email');
          onVerified(profile);
          setVerified(true);
        }
      } catch (caught) {
        if (active) setError(caught);
      }
    };
    void verify();
    return () => {
      active = false;
    };
  }, [onVerified, token]);
  return (
    <PageShell variant="auth" card="banknote">
      <h1>{t('verifyEmail')}</h1>
      {error !== null ? (
        <Notice tone="error">{apiErrorMessage(error, t, 'unableAuthenticate')}</Notice>
      ) : verified ? (
        <Notice tone="success">{t('emailVerified')}</Notice>
      ) : (
        <StatPill variant="status" live>
          {t('verifyingEmail')}
        </StatPill>
      )}
      <Button variant="secondary" onClick={onBack}>
        {t('signIn')}
      </Button>
    </PageShell>
  );
}

export function PasswordResetPage({ token, onBack }: { token: string; onBack: () => void }) {
  const { t } = useLanguage();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [changed, setChanged] = useState(false);
  const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (password.length < 6) {
      setError(new Error(t('accountPasswordMinLength')));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await monopolyBankApi.confirmPasswordReset(token, password);
      window.history.replaceState({}, '', '/reset-password');
      setChanged(true);
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  };
  return (
    <PageShell variant="auth" card="banknote">
      <h1>{t('passwordReset')}</h1>
      {changed ? (
        <Notice tone="success">{t('passwordChanged')}</Notice>
      ) : (
        <form className={authFormClass} onSubmit={(event) => void submit(event)}>
          <Field label={t('newPassword')}>
            <input
              type="password"
              minLength={6}
              maxLength={256}
              autoComplete="new-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </Field>
          {error !== null && (
            <Notice tone="error">
              {error instanceof Error && error.message === t('accountPasswordMinLength')
                ? error.message
                : apiErrorMessage(error, t, 'unableAuthenticate')}
            </Notice>
          )}
          <Button variant="primary" type="submit" disabled={busy || token === ''}>
            {busy ? t('pleaseWait') : t('passwordReset')}
          </Button>
        </form>
      )}
      <Button variant="quiet" onClick={onBack}>
        {t('signIn')}
      </Button>
    </PageShell>
  );
}

export function PasswordRecoveryPage({ onBack }: { onBack: () => void }) {
  const { t } = useLanguage();
  const [email, setEmail] = useState('');
  const [requested, setRequested] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await monopolyBankApi.requestPasswordReset(email);
      setRequested(true);
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  };
  return (
    <PageShell variant="auth" card="banknote">
      <h1>{t('passwordReset')}</h1>
      <p className={ledeClass}>{t('passwordResetDescription')}</p>
      {requested ? (
        <Notice tone="success">{t('passwordResetRequested')}</Notice>
      ) : (
        <form className={authFormClass} onSubmit={(event) => void submit(event)}>
          <Field label={t('email')}>
            <input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </Field>
          {error !== null && (
            <Notice tone="error">{apiErrorMessage(error, t, 'unableAuthenticate')}</Notice>
          )}
          <Button variant="primary" type="submit" disabled={busy}>
            {busy ? t('pleaseWait') : t('passwordReset')}
          </Button>
        </form>
      )}
      <Button variant="quiet" onClick={onBack}>
        {t('signIn')}
      </Button>
    </PageShell>
  );
}
