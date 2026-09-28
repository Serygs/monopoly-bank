import { useState, type FormEvent } from 'react';
import type { UserProfile } from '../../shared/contracts/api.js';
import { monopolyBankApi } from '../api/monopoly-bank-api';
import { AvatarPicker } from '../components/AvatarPicker';
import { Button, Field, Notice, PageShell } from '../components/ui';
import { apiErrorMessage } from '../i18n/api-errors';
import { useLanguage } from '../i18n/language-context';

interface Props {
  initialJoinCode: string;
  invitationToken: string;
  onJoined: (gameId: string) => void;
  onBack: () => void;
  onGuestJoined?: (profile: UserProfile, gameId: string) => void;
}

export function JoinGamePage({
  initialJoinCode,
  invitationToken,
  onJoined,
  onBack,
  onGuestJoined,
}: Props) {
  const { t } = useLanguage();
  const [joinCode, setJoinCode] = useState(initialJoinCode.toUpperCase());
  const [gameAccessPassword, setGameAccessPassword] = useState('');
  const [nickname, setNickname] = useState('');
  const [avatar, setAvatar] = useState('🎩');
  const [error, setError] = useState<unknown>(null);
  const [submitting, setSubmitting] = useState(false);
  const hasInvitation = invitationToken !== '';
  const guest = onGuestJoined !== undefined;
  const credentials = () =>
    hasInvitation
      ? { invitationToken }
      : {
          joinCode: joinCode.trim().toUpperCase(),
          ...(gameAccessPassword === '' ? {} : { gameAccessPassword }),
        };

  const join = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      if (onGuestJoined === undefined) {
        const details = await monopolyBankApi.joinGame(credentials());
        onJoined(details.game.id);
      } else {
        const result = await monopolyBankApi.joinGameAsGuest({
          nickname,
          avatar,
          ...credentials(),
        });
        onGuestJoined(result.profile, result.game.game.id);
      }
    } catch (caught) {
      setError(caught);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <PageShell variant="auth" card="join">
      <Button variant="quiet" className="auth-back" onClick={onBack}>
        ← {t('savedGames')}
      </Button>
      <div className="auth-card-heading">
        <span className="auth-card-mark" aria-hidden="true">
          MB
        </span>
        <div>
          <p className="eyebrow">{t('lobby')}</p>
          <h1>{guest ? t('joinAsGuest') : t('joinGame')}</h1>
        </div>
      </div>
      <p className="lede">
        {guest
          ? t('guestJoinDescription')
          : hasInvitation
            ? t('secureInviteDescription')
            : t('joinGameDescription')}
      </p>
      <form className="game-form auth-form" onSubmit={(event) => void join(event)}>
        {guest && (
          <>
            <Field label={t('nickname')}>
              <input
                value={nickname}
                minLength={2}
                maxLength={40}
                autoComplete="nickname"
                placeholder={t('yourNickname')}
                onChange={(event) => setNickname(event.target.value)}
                required
              />
            </Field>
            <AvatarPicker
              avatar={avatar}
              onChange={setAvatar}
              label={t('avatar')}
              uploadLabel={t('avatarUpload')}
              uploadHint={t('avatarUploadHint')}
              invalidImageMessage={t('avatarUploadError')}
            />
          </>
        )}
        {hasInvitation ? (
          <Notice tone="success">{t('secureInviteReady')}</Notice>
        ) : (
          <>
            <Field label={t('invitationCode')}>
              <input
                value={joinCode}
                autoCapitalize="characters"
                autoComplete="off"
                minLength={6}
                maxLength={12}
                placeholder={t('invitationCodeExample')}
                onChange={(event) => setJoinCode(event.target.value.toUpperCase())}
                required
              />
            </Field>
            <Field label={t('optionalPassword')} hint={t('gamePasswordMinLength')}>
              <input
                type="password"
                value={gameAccessPassword}
                minLength={4}
                maxLength={256}
                autoComplete="current-password"
                placeholder={t('tablePassword')}
                onChange={(event) => setGameAccessPassword(event.target.value)}
              />
            </Field>
          </>
        )}
        {error !== null && (
          <Notice tone="error">{apiErrorMessage(error, t, 'unableJoinGame')}</Notice>
        )}
        <Button variant="primary" type="submit" disabled={submitting}>
          {submitting ? t('joining') : guest ? t('joinAsGuest') : t('joinGame')}
        </Button>
      </form>
    </PageShell>
  );
}
