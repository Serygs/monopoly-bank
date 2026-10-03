import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import type { UserProfile } from '../shared/contracts/api';
import { monopolyBankApi } from './api/monopoly-bank-api';
import { loadAccountSession } from './api/account-session';
import { Avatar } from './components/AvatarPicker';
import { useLanguage } from './i18n/language-context';
import { apiErrorMessage } from './i18n/api-errors';
import { AuthPage } from './pages/AuthPage';
import { PasswordRecoveryPage, PasswordResetPage, VerifyEmailPage } from './pages/EmailTokenPage';
import { CreateGamePage } from './pages/CreateGamePage';
import { GamePage } from './pages/GamePage';
import { JoinGamePage } from './pages/JoinGamePage';
import { ProfilePage } from './pages/ProfilePage';
import { SavedGamesPage } from './pages/SavedGamesPage';
import { readPreferences, writePreferences, type DevicePreferences } from './utils/preferences';
import { mountAppearance } from './appearance/appearance-controller';
import { AppearanceSettings } from './components/AppearanceSettings';
import { Dialog } from './components/Dialog';
import { currentRoute, routePath } from './utils/client-route';
import { EMAIL_FEATURES_ENABLED } from './utils/email-features';
import { applyPwaUpdate } from './pwa';
import './styles/app.css';

function App() {
  const { language, setLanguage, t } = useLanguage();
  const [path, setPath] = useState(window.location.pathname);
  const [preferences, setPreferences] = useState<DevicePreferences>(() => readPreferences());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [profile, setProfile] = useState<UserProfile | null | undefined>(undefined);
  const [accountError, setAccountError] = useState<unknown>(null);
  const [accountRetry, setAccountRetry] = useState(0);
  const [online, setOnline] = useState(() => navigator.onLine);
  const [updateReady, setUpdateReady] = useState(false);
  const [paymentFlowOpen, setPaymentFlowOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<unknown | null>(null);
  const [settingsPopoverPosition, setSettingsPopoverPosition] = useState<{
    top: number;
    right: number;
  } | null>(null);
  const settingsButtonRef = useRef<HTMLButtonElement>(null);
  const accountRequestVersion = useRef(0);

  const { visualStyle, colorMode } = preferences;
  useLayoutEffect(() => mountAppearance({ visualStyle, colorMode }), [visualStyle, colorMode]);
  useLayoutEffect(() => {
    if (!settingsOpen) return undefined;
    const updatePosition = () => {
      const bounds = settingsButtonRef.current?.getBoundingClientRect();
      if (bounds === undefined) return;
      setSettingsPopoverPosition({
        top: Math.max(8, bounds.bottom + 12),
        right: Math.max(8, window.innerWidth - bounds.right),
      });
    };
    updatePosition();
    window.addEventListener('resize', updatePosition);
    return () => window.removeEventListener('resize', updatePosition);
  }, [settingsOpen]);
  useEffect(() => {
    writePreferences(preferences);
  }, [preferences]);
  useEffect(() => {
    const onPopState = () => setPath(window.location.pathname);
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);
  useEffect(() => {
    if (!online) return;
    let cancelled = false;
    const version = ++accountRequestVersion.current;
    void loadAccountSession(monopolyBankApi)
      .then((user) => {
        if (!cancelled && version === accountRequestVersion.current) {
          setAccountError(null);
          setProfile(user);
        }
      })
      .catch((error: unknown) => {
        if (!cancelled && version === accountRequestVersion.current) setAccountError(error);
      });
    return () => {
      cancelled = true;
    };
  }, [accountRetry, online]);
  useEffect(() => {
    const resumed = () => {
      if (document.visibilityState === 'visible') setAccountRetry((attempt) => attempt + 1);
    };
    document.addEventListener('visibilitychange', resumed);
    return () => document.removeEventListener('visibilitychange', resumed);
  }, []);
  useEffect(() => {
    const connected = () => setOnline(true);
    const disconnected = () => setOnline(false);
    window.addEventListener('online', connected);
    window.addEventListener('offline', disconnected);
    return () => {
      window.removeEventListener('online', connected);
      window.removeEventListener('offline', disconnected);
    };
  }, []);
  useEffect(() => {
    const ready = () => setUpdateReady(true);
    window.addEventListener('pwa-update-ready', ready);
    return () => window.removeEventListener('pwa-update-ready', ready);
  }, []);

  const navigate = (target: string) => {
    setSettingsOpen(false);
    window.history.pushState({}, '', target);
    setPath(routePath(target));
  };
  const signOut = async () => {
    if (signingOut) return;
    setSigningOut(true);
    setSignOutError(null);
    try {
      await monopolyBankApi.logout();
      accountRequestVersion.current += 1;
      setAccountError(null);
      setSettingsOpen(false);
      setPaymentFlowOpen(false);
      window.history.replaceState({}, '', '/');
      setPath('/');
      setProfile(null);
    } catch (caught) {
      setSignOutError(caught);
    } finally {
      setSigningOut(false);
    }
  };
  const authenticated = (user: UserProfile) => {
    accountRequestVersion.current += 1;
    setAccountError(null);
    setProfile(user);
  };
  const emailToken = new URLSearchParams(window.location.hash.slice(1)).get('token') ?? '';
  if (EMAIL_FEATURES_ENABLED && path === '/verify-email')
    return (
      <VerifyEmailPage token={emailToken} onVerified={setProfile} onBack={() => navigate('/')} />
    );
  if (EMAIL_FEATURES_ENABLED && path === '/reset-password')
    return <PasswordResetPage token={emailToken} onBack={() => navigate('/')} />;
  const gameMatch = /^\/games\/([^/]+)$/.exec(path);
  if (profile === undefined && !online) return <OfflineShell />;
  if (profile === undefined)
    return (
      <main className="page">
        {accountError === null ? (
          <p className="status">{t('loadingAccount')}</p>
        ) : (
          <>
            <p className="notice notice-error" role="alert">
              {apiErrorMessage(accountError, t, 'unableLoadAccount')}
            </p>
            <button
              className="button button-primary"
              type="button"
              onClick={() => {
                setAccountError(null);
                setAccountRetry((attempt) => attempt + 1);
              }}
            >
              {t('tryAgain')}
            </button>
          </>
        )}
      </main>
    );
  if (profile === null && !online) return <OfflineShell />;
  if (profile === null) {
    const navigatePublic = (target: string) => {
      window.history.pushState({}, '', target);
      setPath(target);
    };
    if (EMAIL_FEATURES_ENABLED && path === '/forgot-password')
      return <PasswordRecoveryPage onBack={() => navigatePublic('/')} />;
    if (path === '/games/join') {
      const guestJoinCode = new URLSearchParams(window.location.search).get('code') ?? '';
      const guestInvitationToken = invitationFromLocation();
      return (
        <JoinGamePage
          initialJoinCode={guestJoinCode}
          invitationToken={guestInvitationToken}
          onJoined={() => undefined}
          onGuestJoined={(guest, gameId) => {
            authenticated(guest);
            window.history.pushState({}, '', `/games/${encodeURIComponent(gameId)}`);
            setPath(`/games/${encodeURIComponent(gameId)}`);
          }}
          onBack={() => {
            window.history.pushState({}, '', '/');
            setPath('/');
          }}
        />
      );
    }
    const returnRoute = currentRoute(
      window.location.pathname,
      window.location.search,
      window.location.hash,
    );
    return (
      <AuthPage
        onAuthenticated={(user) => {
          authenticated(user);
          navigate(returnRoute);
        }}
      />
    );
  }

  const joinCode =
    path === '/games/join' ? (new URLSearchParams(window.location.search).get('code') ?? '') : '';
  const invitationToken = path === '/games/join' ? invitationFromLocation() : '';
  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-header-inner">
          <button type="button" className="brand" onClick={() => navigate('/')}>
            <span className="brand-mark" aria-hidden="true">
              MB
            </span>
            <span>{t('appName')}</span>
          </button>
          <div className="header-tools">
            <button
              className="profile-menu-button"
              type="button"
              onClick={() => navigate('/profile')}
            >
              <Avatar avatar={profile.avatar} label={profile.nickname} className="header-avatar" />
              <span>{profile.nickname}</span>
            </button>
            <button
              ref={settingsButtonRef}
              className="settings-button"
              type="button"
              aria-label={t('settings')}
              aria-expanded={settingsOpen}
              aria-haspopup="dialog"
              aria-controls="settings-panel"
              onClick={() => setSettingsOpen(!settingsOpen)}
            >
              ⚙ <span>{t('settings')}</span>
            </button>
          </div>
        </div>
      </header>
      {settingsOpen && (
        <Dialog
          title={t('settings')}
          closeLabel={t('closeDialog', { title: t('settings') })}
          onClose={() => setSettingsOpen(false)}
          closeDisabled={signingOut}
          className="settings-panel"
          presentation="popover"
          popoverStyle={
            settingsPopoverPosition === null
              ? undefined
              : ({
                  '--settings-popover-top': `${settingsPopoverPosition.top}px`,
                  '--settings-popover-right': `${settingsPopoverPosition.right}px`,
                } as CSSProperties)
          }
        >
          <AppearanceSettings
            preferences={preferences}
            onChange={(change) => setPreferences((current) => ({ ...current, ...change }))}
          />
          <fieldset className="settings-options">
            <legend>{t('language')}</legend>
            <div className="settings-segmented">
              <button
                type="button"
                className={language === 'en' ? 'active' : ''}
                aria-pressed={language === 'en'}
                onClick={() => setLanguage('en')}
              >
                {t('english')}
              </button>
              <button
                type="button"
                className={language === 'uk' ? 'active' : ''}
                aria-pressed={language === 'uk'}
                onClick={() => setLanguage('uk')}
              >
                {t('ukrainian')}
              </button>
            </div>
          </fieldset>
          <label className="settings-toggle">
            <span>{t('sound')}</span>
            <input
              type="checkbox"
              checked={preferences.sound}
              onChange={(event) => setPreferences({ ...preferences, sound: event.target.checked })}
            />
          </label>
          <label className="settings-toggle">
            <span>{t('vibration')}</span>
            <input
              type="checkbox"
              checked={preferences.vibration}
              onChange={(event) =>
                setPreferences({ ...preferences, vibration: event.target.checked })
              }
            />
          </label>
          <div className="settings-account-actions">
            {signOutError !== null && (
              <p className="notice notice-error" role="alert">
                {apiErrorMessage(signOutError, t, 'unableSignOut')}
              </p>
            )}
            <button
              className="button button-quiet settings-sign-out"
              type="button"
              disabled={signingOut}
              onClick={() => void signOut()}
            >
              <SignOutIcon />
              <span>{signingOut ? t('signingOut') : t('signOut')}</span>
            </button>
          </div>
        </Dialog>
      )}
      {!online && (
        <p className="offline-banner" role="status">
          {t('staleSnapshot')}
        </p>
      )}
      {updateReady && !paymentFlowOpen && (
        <section className="update-banner" role="status">
          <span>{t('updateReady')}</span>
          <button type="button" className="button button-primary" onClick={applyPwaUpdate}>
            {t('updateApp')}
          </button>
          <button
            type="button"
            className="button button-quiet"
            onClick={() => setUpdateReady(false)}
          >
            {t('updateLater')}
          </button>
        </section>
      )}
      {path === '/profile' ? (
        <ProfilePage profile={profile} onUpdated={setProfile} onBack={() => navigate('/')} />
      ) : path === '/games/new' ? (
        <CreateGamePage
          profile={profile}
          onCancel={() => navigate('/')}
          onCreated={(id) => navigate(`/games/${encodeURIComponent(id)}`)}
        />
      ) : path === '/games/join' ? (
        <JoinGamePage
          initialJoinCode={joinCode}
          invitationToken={invitationToken}
          onJoined={(id) => navigate(`/games/${encodeURIComponent(id)}`)}
          onBack={() => navigate('/')}
        />
      ) : gameMatch !== null ? (
        <GamePage
          gameId={gameMatch[1]}
          onBack={() => navigate('/')}
          preferences={preferences}
          offline={!online}
          onPaymentFlowChange={setPaymentFlowOpen}
        />
      ) : (
        <SavedGamesPage
          onCreateGame={() => navigate('/games/new')}
          onJoinGame={(code) =>
            navigate(`/games/join${code === undefined ? '' : `?code=${encodeURIComponent(code)}`}`)
          }
          onOpenGame={(id) => navigate('/games/' + encodeURIComponent(id))}
        />
      )}
    </div>
  );
}

function SignOutIcon() {
  return (
    <svg className="settings-sign-out-icon" viewBox="0 0 20 20" aria-hidden="true">
      <path d="M8.25 3.25H5.5A1.75 1.75 0 0 0 3.75 5v10c0 .97.78 1.75 1.75 1.75h2.75M12.25 6.25 16 10l-3.75 3.75M7.5 10H16" />
    </svg>
  );
}

function OfflineShell() {
  const { t } = useLanguage();
  return (
    <main className="offline-shell">
      <span className="brand-mark" aria-hidden="true">
        MB
      </span>
      <h1>{t('offlineShellTitle')}</h1>
      <p>{t('offlineShellDescription')}</p>
    </main>
  );
}

/** Hash fragments do not leave the device in a Referer header. */
function invitationFromLocation(): string {
  return new URLSearchParams(window.location.hash.slice(1)).get('invite') ?? '';
}

export default App;
