import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { UserProfile } from '../../shared/contracts/api.js';
import { MonopolyBankApiError, monopolyBankApi } from '../api/monopoly-bank-api';
import { Button, Field, Notice, PageShell } from '../components/ui';
import { apiErrorMessage } from '../i18n/api-errors';
import { useLanguage } from '../i18n/language-context';
import { AuthForm, AuthHeading } from '../components/ui/AuthCard';
import { Lede } from '../components/ui/Text';

interface Props {
  initialJoinCode: string;
  invitationToken: string;
  onJoined: (gameId: string) => void;
  /** Only the signed-out flow has a way back; inside the app shell the bottom nav replaces it. */
  onBack?: () => void;
  onGuestJoined?: (profile: UserProfile, gameId: string) => void;
  /** A signed-in visitor with a link or code joins at once; the form only shows if that fails. */
  autoJoin?: boolean;
}

export function JoinGamePage({
  initialJoinCode,
  invitationToken,
  onJoined,
  onBack,
  onGuestJoined,
  autoJoin = false,
}: Props) {
  const { t } = useLanguage();
  const [joinCode, setJoinCode] = useState(initialJoinCode.toUpperCase());
  const [gameAccessPassword, setGameAccessPassword] = useState('');
  const [nickname, setNickname] = useState('');
  const avatar = '🎩';
  const [error, setError] = useState<unknown>(null);
  const [submitting, setSubmitting] = useState(false);
  const hasInvitation = invitationToken !== '';
  const guest = onGuestJoined !== undefined;
  const fromLink = initialJoinCode !== '';
  const autoStarted = useRef(false);
  const [autoJoining, setAutoJoining] = useState(autoJoin && (hasInvitation || fromLink));
  // A link carries the code; the password is asked only once the code alone was not enough.
  const [passwordNeeded, setPasswordNeeded] = useState(false);
  const credentials = () =>
    hasInvitation
      ? { invitationToken }
      : {
          joinCode: joinCode.trim().toUpperCase(),
          ...(gameAccessPassword === '' ? {} : { gameAccessPassword }),
        };

  const join = async (event?: FormEvent) => {
    event?.preventDefault();
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
      if (caught instanceof MonopolyBankApiError && caught.code === 'INVALID_JOIN_CODE')
        setPasswordNeeded(true);
    } finally {
      setSubmitting(false);
      setAutoJoining(false);
    }
  };
  useEffect(() => {
    if (!autoJoining || autoStarted.current) return;
    autoStarted.current = true;
    void join();
    // Runs once on arrival; `join` reads the credentials from the link.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const showCode = !hasInvitation && !fromLink;
  const showPassword = !hasInvitation && (!fromLink || passwordNeeded);

  return (
    <PageShell variant="auth" card="join">
      {/* `!` outranks the Button primitive's own centring and inline padding. */}
      {onBack !== undefined && (
        <Button variant="quiet" className="mb-(--mb-space-4) justify-start! px-0!" onClick={onBack}>
          ← {t('savedGames')}
        </Button>
      )}
      <AuthHeading eyebrow={t('lobby')} title={guest ? t('joinAsGuest') : t('joinGame')} />
      <Lede>
        {guest
          ? t('guestJoinDescription')
          : hasInvitation
            ? t('secureInviteDescription')
            : t('joinGameDescription')}
      </Lede>
      {autoJoining ? (
        <Notice tone="success">{t('joiningLobby')}</Notice>
      ) : (
        <AuthForm onSubmit={(event) => void join(event)}>
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
            </>
          )}
          {hasInvitation ? (
            <Notice tone="success">{t('secureInviteReady')}</Notice>
          ) : (
            <>
              {showCode && (
                <Field label={t('invitationCode')}>
                  <input
                    value={joinCode}
                    autoCapitalize="characters"
                    autoComplete="off"
                    minLength={4}
                    maxLength={12}
                    placeholder={t('invitationCodeExample')}
                    onChange={(event) => setJoinCode(event.target.value.toUpperCase())}
                    required
                  />
                </Field>
              )}
              {showPassword && (
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
              )}
            </>
          )}
          {error !== null && (
            <Notice tone="error">{apiErrorMessage(error, t, 'unableJoinGame')}</Notice>
          )}
          <Button variant="primary" type="submit" disabled={submitting}>
            {submitting ? t('joining') : guest ? t('joinAsGuest') : t('joinGame')}
          </Button>
        </AuthForm>
      )}
    </PageShell>
  );
}
