import { useState, type FormEvent } from 'react';
import type { UserProfile } from '../../shared/contracts/api';
import { monopolyBankApi } from '../api/monopoly-bank-api';
import { AvatarPicker } from '../components/AvatarPicker';
import { apiErrorMessage } from '../i18n/api-errors';
import { useLanguage } from '../i18n/language-context';

export function AuthPage({ onAuthenticated }: { onAuthenticated: (profile: UserProfile) => void }) {
  const { t } = useLanguage();
  const [registering, setRegistering] = useState(false);
  const [nickname, setNickname] = useState('');
  const [avatar, setAvatar] = useState('🎩');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<unknown>(null);
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
      onAuthenticated(
        registering
          ? await monopolyBankApi.register({ nickname, avatar, password })
          : await monopolyBankApi.login({ nickname, password }),
      );
    } catch (caught) {
      setError(caught);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="page page-narrow auth-page">
      <section className="auth-card">
        <div className="auth-card-heading">
          <span className="auth-card-mark" aria-hidden="true">
            MB
          </span>
          <div>
            <p className="eyebrow">{t('appName')}</p>
            <h1>{registering ? t('createAccount') : t('welcomeBack')}</h1>
          </div>
        </div>
        <p className="lede">
          {registering ? t('createAccountDescription') : t('signInDescription')}
        </p>
        <form className="game-form auth-form" onSubmit={(event) => void submit(event)}>
          <label>
            {t('nickname')}
            <input
              value={nickname}
              minLength={2}
              maxLength={40}
              autoComplete="nickname"
              placeholder={t('yourNickname')}
              onChange={(event) => setNickname(event.target.value)}
              required
            />
          </label>
          {registering && (
            <AvatarPicker
              avatar={avatar}
              onChange={setAvatar}
              label={t('avatar')}
              uploadLabel={t('avatarUpload')}
              uploadHint={t('avatarUploadHint')}
              invalidImageMessage={t('avatarUploadError')}
            />
          )}
          <label>
            {t('password')}
            <input
              type="password"
              value={password}
              minLength={6}
              maxLength={256}
              autoComplete={registering ? 'new-password' : 'current-password'}
              placeholder={t('passwordPlaceholder')}
              onChange={(event) => setPassword(event.target.value)}
              required
            />
          </label>
          {error !== null && (
            <p className="notice notice-error" role="alert">
              {error instanceof Error && error.message === t('accountPasswordMinLength')
                ? error.message
                : apiErrorMessage(error, t, registering ? 'unableRegister' : 'unableAuthenticate')}
            </p>
          )}
          <button className="button button-primary" disabled={busy}>
            {busy ? t('pleaseWait') : registering ? t('createAccount') : t('signIn')}
          </button>
        </form>
        <div className="auth-card-footer">
          <span>{registering ? t('alreadyHaveAccount') : t('newToMonopolyBank')}</span>
          <button
            className="button button-quiet"
            type="button"
            onClick={() => setRegistering(!registering)}
          >
            {registering ? t('signIn') : t('createAccount')}
          </button>
        </div>
      </section>
    </main>
  );
}
