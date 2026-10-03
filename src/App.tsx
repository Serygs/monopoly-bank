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
import { AppearanceSettings, SettingsGroup } from './components/AppearanceSettings';
import { Dialog } from './components/Dialog';
import {
  BankSeal,
  Button,
  FeedbackProvider,
  Notice,
  PageShell,
  SegmentedControl,
  StatPill,
  Toggle,
} from './components/ui';
import { currentRoute, routePath } from './utils/client-route';
import { EMAIL_FEATURES_ENABLED } from './utils/email-features';
import { applyPwaUpdate } from './pwa';
import { cx } from './components/ui/class-names';
import './styles/app.css';

/*
 * The shell keeps its semantic class names as hooks: the safe-area padding and offsets
 * (`env(safe-area-inset-*)`, `--mb-app-safe-*`) and the iOS `@supports` block stay in
 * `layout.css`, and the Liquid Glass ambient background drift stays in `liquid-glass.css`.
 */
const appShellClass =
  'app-shell min-h-dvh [background:var(--mb-background-shell)] text-primary glass:relative glass:isolate';
const appHeaderClass = cx(
  'app-header sticky top-0 z-20 border-b border-b-[color:color-mix(in_srgb,var(--mb-color-highlight)_48%,transparent)]',
  '[background:var(--mb-background-header)] text-on-inverse shadow-header',
  // Only the dark Classic header needs the inverse ring; Liquid Glass light keeps the default.
  'classic:light:[&_button:focus-visible]:outline-text-on-inverse',
  'glass:border-b-[rgb(255_255_255/0.36)] glass:text-primary',
  'glass:backdrop-blur-[20px] glass:backdrop-saturate-[1.3] glass:max-md:backdrop-blur-[16px] glass:max-md:backdrop-saturate-[1.22]',
);
/* Liquid Glass frosts the profile and settings buttons and drops their hover fill. */
const glassHeaderControlClass = cx(
  'glass:border glass:border-solid glass:border-[rgb(255_255_255/0.4)]',
  'glass:bg-[rgb(255_255_255/0.22)] glass:fine-pointer:hover:bg-[rgb(255_255_255/0.22)]',
  'glass:shadow-[inset_0_1px_0_rgb(255_255_255/0.38),0_5px_16px_rgb(40_60_90/0.07)]',
);
const appHeaderInnerClass = cx(
  'app-header-inner mx-auto flex w-[min(100%,var(--mb-layout-content-max))] items-center justify-between',
  'min-h-(--mb-layout-header-height-compact) gap-(--mb-space-2)',
  'md:min-h-(--mb-layout-header-height-medium) md:gap-(--mb-space-4)',
  'lg:min-h-(--mb-layout-header-height-wide) short-landscape:min-h-[52px]',
);
const headerButtonClass = cx(
  'inline-flex min-h-(--mb-control-height-md) min-w-(--mb-control-height-md) items-center justify-center',
  'gap-(--mb-space-2) bg-transparent font-semibold text-inherit',
  'transition-[color,background-color,border-color,transform] duration-(--mb-duration-fast) ease-standard',
  'active:transform-[translateY(1px)] motion-reduce:transform-none! fine-pointer:hover:bg-inverse-hover',
);
const brandClass = cx(headerButtonClass, 'border-none p-0 text-[1rem] tracking-[-0.015em]');
const profileButtonClass = cx(
  headerButtonClass,
  'rounded-pill border-none p-(--mb-space-1)',
  'md:max-w-[16rem] md:py-(--mb-space-1) md:pr-(--mb-space-2) md:pl-(--mb-space-1)',
  'max-md:[&>span:last-child]:hidden',
  glassHeaderControlClass,
);
const settingsButtonClass = cx(
  headerButtonClass,
  'w-(--mb-control-height-md) rounded-md border border-[color:color-mix(in_srgb,var(--mb-color-text-on-inverse)_28%,transparent)] p-0',
  'md:w-auto md:px-(--mb-space-3) max-md:[&>span]:hidden',
  glassHeaderControlClass,
);
/*
 * Popover position from md up. It reads the `--settings-popover-top/right` properties written
 * below. The breakpoint variants sort after the Dialog panel's own `max-height`.
 */
const settingsPanelClass = cx(
  'settings-panel md:fixed md:max-w-[calc(100vw_-_2_*_var(--mb-space-3))]',
  'md:top-[var(--settings-popover-top,calc(var(--mb-layout-header-height-medium)_+_var(--mb-app-safe-top)_+_12px))]',
  'lg:top-[var(--settings-popover-top,calc(var(--mb-layout-header-height-wide)_+_var(--mb-app-safe-top)_+_12px))]',
  'md:right-[var(--settings-popover-right,max(var(--mb-layout-page-inline-medium),calc((100vw_-_var(--mb-layout-content-max))_/_2)))]',
  'md:max-h-[calc(100dvh_-_var(--settings-popover-top,calc(var(--mb-layout-header-height-medium)_+_var(--mb-app-safe-top)_+_12px))_-_24px)]',
  'short-landscape:max-h-[calc(100dvh_-_var(--mb-app-safe-top)_-_var(--mb-space-2))]',
  // The cap applies to the anchored popover only; below `md` both styles share the full-width sheet.
  'glass:min-w-0 glass:md:max-w-[min(22.5rem,calc(100vw_-_2_*_var(--mb-space-3)))] glass:overflow-x-hidden',
  'glass:md:w-[min(22.5rem,calc(100vw_-_2_*_var(--mb-space-3)))]',
  'glass:border-[rgb(255_255_255/0.65)] glass:bg-[rgb(255_255_255/0.76)] glass:dark:border-[rgb(255_255_255/0.24)] glass:dark:bg-[rgb(40_49_62/0.88)]',
  'glass:shadow-[0_18px_45px_rgb(40_60_90/0.14),inset_0_1px_0_rgb(255_255_255/0.65)]',
  'glass:backdrop-blur-[24px] glass:backdrop-saturate-[1.3] glass:max-md:backdrop-blur-[16px] glass:max-md:backdrop-saturate-[1.24]',
  'glass:forced-colors:backdrop-filter-none',
  'glass:[&>header>div]:min-w-0 glass:[&>header_h2]:max-w-full glass:[&>header_h2]:text-[1.75rem] glass:[&>header_h2]:whitespace-nowrap',
  'glass:[&_.settings-options]:min-w-0',
);
const bannerClass = cx(
  'fixed z-40 m-auto w-[min(var(--mb-layout-content-max),calc(100%_-_2_*_var(--mb-space-3)))]',
  'rounded-md border border-[color:color-mix(in_srgb,var(--mb-color-highlight)_65%,transparent)]',
  'bg-surface-inverse px-(--mb-space-4) py-(--mb-space-3) text-on-inverse shadow-md',
);
const offlineShellClass = cx(
  'offline-shell grid min-h-dvh content-center justify-items-start gap-(--mb-space-4) bg-surface-inverse text-on-inverse',
  '[&>:is(h1,p)]:m-0 [&>:is(h1,p)]:max-w-[34rem]',
  '[&>h1]:font-display [&>h1]:text-display [&>h1]:leading-tight [&>h1]:font-bold [&>h1]:tracking-display',
  '[&>p]:text-[color:color-mix(in_srgb,var(--mb-color-text-on-inverse)_76%,transparent)]',
);

/** Every route, including the signed-out and email-token pages, shares one notification region. */
function App() {
  return (
    <FeedbackProvider>
      <AppRoutes />
    </FeedbackProvider>
  );
}

function AppRoutes() {
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
      <PageShell>
        {accountError === null ? (
          <StatPill variant="status">{t('loadingAccount')}</StatPill>
        ) : (
          <>
            <Notice tone="error">{apiErrorMessage(accountError, t, 'unableLoadAccount')}</Notice>
            <Button
              variant="primary"
              onClick={() => {
                setAccountError(null);
                setAccountRetry((attempt) => attempt + 1);
              }}
            >
              {t('tryAgain')}
            </Button>
          </>
        )}
      </PageShell>
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
    <div className={appShellClass}>
      <header className={appHeaderClass}>
        <div className={appHeaderInnerClass}>
          <button type="button" className={brandClass} onClick={() => navigate('/')}>
            <BankSeal variant="header" />
            <span>{t('appName')}</span>
          </button>
          <div className="header-tools flex items-center justify-end gap-(--mb-space-2)">
            <button
              className={profileButtonClass}
              type="button"
              onClick={() => navigate('/profile')}
            >
              <Avatar avatar={profile.avatar} label={profile.nickname} />
              <span>{profile.nickname}</span>
            </button>
            <button
              ref={settingsButtonRef}
              className={settingsButtonClass}
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
          className={settingsPanelClass}
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
          <SettingsGroup legend={t('language')}>
            <SegmentedControl
              options={[
                { value: 'en', label: t('english') },
                { value: 'uk', label: t('ukrainian') },
              ]}
              value={language}
              onChange={setLanguage}
            />
          </SettingsGroup>
          <Toggle
            label={t('sound')}
            checked={preferences.sound}
            onChange={(sound) => setPreferences({ ...preferences, sound })}
          />
          <Toggle
            label={t('vibration')}
            checked={preferences.vibration}
            onChange={(vibration) => setPreferences({ ...preferences, vibration })}
          />
          <div className="settings-account-actions grid gap-(--mb-space-3) border-t border-dialog-divider mt-(--mb-space-1) pt-(--mb-space-4)">
            {signOutError !== null && (
              <Notice tone="error" className="m-0">
                {apiErrorMessage(signOutError, t, 'unableSignOut')}
              </Notice>
            )}
            <Button
              variant="quiet"
              className="settings-sign-out w-full justify-start text-secondary enabled:active:text-danger enabled:active:bg-danger-soft fine-pointer:enabled:hover:text-danger fine-pointer:enabled:hover:bg-danger-soft"
              disabled={signingOut}
              onClick={() => void signOut()}
            >
              <SignOutIcon />
              <span>{signingOut ? t('signingOut') : t('signOut')}</span>
            </Button>
          </div>
        </Dialog>
      )}
      {!online && (
        <p className={cx('offline-banner', bannerClass)} role="status">
          {t('staleSnapshot')}
        </p>
      )}
      {updateReady && !paymentFlowOpen && (
        <section
          className={cx(
            'update-banner',
            bannerClass,
            'flex items-center justify-end gap-(--mb-space-2) [&_span]:mr-auto',
          )}
          role="status"
        >
          <span>{t('updateReady')}</span>
          <Button variant="primary" onClick={applyPwaUpdate}>
            {t('updateApp')}
          </Button>
          <Button variant="quiet" onClick={() => setUpdateReady(false)}>
            {t('updateLater')}
          </Button>
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
    <svg
      className="settings-sign-out-icon size-5 fill-none stroke-current stroke-[1.75] [stroke-linecap:round] [stroke-linejoin:round]"
      viewBox="0 0 20 20"
      aria-hidden="true"
    >
      <path d="M8.25 3.25H5.5A1.75 1.75 0 0 0 3.75 5v10c0 .97.78 1.75 1.75 1.75h2.75M12.25 6.25 16 10l-3.75 3.75M7.5 10H16" />
    </svg>
  );
}

function OfflineShell() {
  const { t } = useLanguage();
  return (
    <main className={offlineShellClass}>
      <BankSeal variant="offline" />
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
