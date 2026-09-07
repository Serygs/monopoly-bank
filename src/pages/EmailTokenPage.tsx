import { useEffect, useState, type FormEvent } from 'react';
import type { UserProfile } from '../../shared/contracts/api.js';
import { monopolyBankApi } from '../api/monopoly-bank-api';
import { apiErrorMessage } from '../i18n/api-errors';
import { useLanguage } from '../i18n/language-context';

export function VerifyEmailPage({ token, onVerified, onBack }: { token: string; onVerified: (profile: UserProfile) => void; onBack: () => void }) {
  const { t } = useLanguage(); const [error, setError] = useState<unknown>(null); const [verified, setVerified] = useState(false);
  useEffect(() => { let active = true; const verify = async () => { try { const profile = await monopolyBankApi.verifyEmail(token); if (active) { window.history.replaceState({}, '', '/verify-email'); onVerified(profile); setVerified(true); } } catch (caught) { if (active) setError(caught); } }; void verify(); return () => { active = false; }; }, [onVerified, token]);
  return <main className="page page-narrow auth-page"><section className="banknote-panel auth-card"><h1>{t('verifyEmail')}</h1>{error !== null ? <p className="notice notice-error" role="alert">{apiErrorMessage(error, t, 'unableAuthenticate')}</p> : verified ? <p className="notice notice-success" role="status">{t('emailVerified')}</p> : <p className="status" role="status">{t('verifyingEmail')}</p>}<button className="button button-secondary" type="button" onClick={onBack}>{t('signIn')}</button></section></main>;
}

export function PasswordResetPage({ token, onBack }: { token: string; onBack: () => void }) {
  const { t } = useLanguage(); const [password, setPassword] = useState(''); const [error, setError] = useState<unknown>(null); const [changed, setChanged] = useState(false); const [busy, setBusy] = useState(false);
  const submit = async (event: FormEvent) => { event.preventDefault(); if (password.length < 6) { setError(new Error(t('accountPasswordMinLength'))); return; } setBusy(true); setError(null); try { await monopolyBankApi.confirmPasswordReset(token, password); window.history.replaceState({}, '', '/reset-password'); setChanged(true); } catch (caught) { setError(caught); } finally { setBusy(false); } };
  return <main className="page page-narrow auth-page"><section className="banknote-panel auth-card"><h1>{t('passwordReset')}</h1>{changed ? <p className="notice notice-success" role="status">{t('passwordChanged')}</p> : <form className="game-form auth-form" onSubmit={(event) => void submit(event)}><label>{t('newPassword')}<input type="password" minLength={6} maxLength={256} autoComplete="new-password" value={password} onChange={(event) => setPassword(event.target.value)} required /></label>{error !== null && <p className="notice notice-error" role="alert">{error instanceof Error && error.message === t('accountPasswordMinLength') ? error.message : apiErrorMessage(error, t, 'unableAuthenticate')}</p>}<button className="button button-primary" disabled={busy || token === ''}>{busy ? t('pleaseWait') : t('passwordReset')}</button></form>}<button className="button button-quiet" type="button" onClick={onBack}>{t('signIn')}</button></section></main>;
}

export function PasswordRecoveryPage({ onBack }: { onBack: () => void }) {
  const { t } = useLanguage(); const [email, setEmail] = useState(''); const [requested, setRequested] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState<unknown>(null);
  const submit = async (event: FormEvent) => { event.preventDefault(); setBusy(true); setError(null); try { await monopolyBankApi.requestPasswordReset(email); setRequested(true); } catch (caught) { setError(caught); } finally { setBusy(false); } };
  return <main className="page page-narrow auth-page"><section className="banknote-panel auth-card"><h1>{t('passwordReset')}</h1><p className="lede">{t('passwordResetDescription')}</p>{requested ? <p className="notice notice-success" role="status">{t('passwordResetRequested')}</p> : <form className="game-form auth-form" onSubmit={(event) => void submit(event)}><label>{t('email')}<input type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required /></label>{error !== null && <p className="notice notice-error" role="alert">{apiErrorMessage(error, t, 'unableAuthenticate')}</p>}<button className="button button-primary" disabled={busy}>{busy ? t('pleaseWait') : t('passwordReset')}</button></form>}<button className="button button-quiet" type="button" onClick={onBack}>{t('signIn')}</button></section></main>;
}
