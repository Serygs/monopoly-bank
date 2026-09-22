import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import type { UserProfile } from '../shared/contracts/api';
import { monopolyBankApi } from './api/monopoly-bank-api';
import { Avatar } from './components/AvatarPicker';
import { useLanguage } from './i18n/language-context';
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
  const [online, setOnline] = useState(() => navigator.onLine);
  const [updateReady, setUpdateReady] = useState(false);
  const [paymentFlowOpen, setPaymentFlowOpen] = useState(false);
  const [settingsPopoverPosition, setSettingsPopoverPosition] = useState<{ top: number; right: number } | null>(null);
  const settingsButtonRef = useRef<HTMLButtonElement>(null);

  const { visualStyle, colorMode } = preferences;
  useLayoutEffect(() => mountAppearance({ visualStyle, colorMode }), [visualStyle, colorMode]);
  useLayoutEffect(() => {
    if (!settingsOpen) return undefined;
    const updatePosition = () => {
      const bounds = settingsButtonRef.current?.getBoundingClientRect();
      if (bounds === undefined) return;
      setSettingsPopoverPosition({ top: Math.max(8, bounds.bottom + 12), right: Math.max(8, window.innerWidth - bounds.right) });
    };
    updatePosition();
    window.addEventListener('resize', updatePosition);
    return () => window.removeEventListener('resize', updatePosition);
  }, [settingsOpen]);
  useEffect(() => { writePreferences(preferences); }, [preferences]);
  useEffect(() => {
    const onPopState = () => setPath(window.location.pathname);
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);
  useEffect(() => { void monopolyBankApi.currentProfile().then(setProfile).catch(() => setProfile(null)); }, []);
  useEffect(() => { const connected = () => setOnline(true); const disconnected = () => setOnline(false); window.addEventListener('online', connected); window.addEventListener('offline', disconnected); return () => { window.removeEventListener('online', connected); window.removeEventListener('offline', disconnected); }; }, []);
  useEffect(() => { const ready = () => setUpdateReady(true); window.addEventListener('pwa-update-ready', ready); return () => window.removeEventListener('pwa-update-ready', ready); }, []);

  const navigate = (target: string) => { setSettingsOpen(false); window.history.pushState({}, '', target); setPath(routePath(target)); };
  const emailToken = new URLSearchParams(window.location.hash.slice(1)).get('token') ?? '';
  if (EMAIL_FEATURES_ENABLED && path === '/verify-email') return <VerifyEmailPage token={emailToken} onVerified={setProfile} onBack={() => navigate('/')} />;
  if (EMAIL_FEATURES_ENABLED && path === '/reset-password') return <PasswordResetPage token={emailToken} onBack={() => navigate('/')} />;
  const gameMatch = /^\/games\/([^/]+)$/.exec(path);
  if (profile === undefined) return <main className="page"><p className="status">{t('loadingAccount')}</p></main>;
  if (profile === null && !online) return <OfflineShell />;
  if (profile === null) {
    const navigatePublic = (target: string) => { window.history.pushState({}, '', target); setPath(target); };
    if (EMAIL_FEATURES_ENABLED && path === '/forgot-password') return <PasswordRecoveryPage onBack={() => navigatePublic('/')} />;
    if (path === '/games/join') {
      const guestJoinCode = new URLSearchParams(window.location.search).get('code') ?? '';
      const guestInvitationToken = invitationFromLocation();
      return <JoinGamePage initialJoinCode={guestJoinCode} invitationToken={guestInvitationToken} onJoined={() => undefined} onGuestJoined={(guest, gameId) => { setProfile(guest); window.history.pushState({}, '', `/games/${encodeURIComponent(gameId)}`); setPath(`/games/${encodeURIComponent(gameId)}`); }} onBack={() => { window.history.pushState({}, '', '/'); setPath('/'); }} />;
    }
    const returnRoute = EMAIL_FEATURES_ENABLED ? currentRoute(window.location.pathname, window.location.search, window.location.hash) : '/';
    return <AuthPage onAuthenticated={(user) => { setProfile(user); navigate(returnRoute); }} />;
  }

  const joinCode = path === '/games/join' ? new URLSearchParams(window.location.search).get('code') ?? '' : '';
  const invitationToken = path === '/games/join' ? invitationFromLocation() : '';
  return <div className="app-shell">
    <header className="app-header">
      <div className="app-header-inner">
        <button type="button" className="brand" onClick={() => navigate('/')}><span className="brand-mark" aria-hidden="true">MB</span><span>{t('appName')}</span></button>
        <div className="header-tools">
          <button className="profile-menu-button" type="button" onClick={() => navigate('/profile')}><Avatar avatar={profile.avatar} label={profile.nickname} className="header-avatar" /><span>{profile.nickname}</span></button>
          <button ref={settingsButtonRef} className="settings-button" type="button" aria-label={t('settings')} aria-expanded={settingsOpen} aria-haspopup="dialog" aria-controls="settings-panel" onClick={() => setSettingsOpen(!settingsOpen)}>⚙ <span>{t('settings')}</span></button>
        </div>
      </div>
      {settingsOpen && <Dialog title={t('settings')} closeLabel={t('closeDialog', { title: t('settings') })} onClose={() => setSettingsOpen(false)} className="settings-panel" presentation="popover" popoverStyle={settingsPopoverPosition === null ? undefined : { '--settings-popover-top': `${settingsPopoverPosition.top}px`, '--settings-popover-right': `${settingsPopoverPosition.right}px` } as CSSProperties}><AppearanceSettings preferences={preferences} onChange={(change) => setPreferences((current) => ({ ...current, ...change }))} /><fieldset className="settings-options"><legend>{t('language')}</legend><div className="settings-segmented"><button type="button" className={language === 'en' ? 'active' : ''} aria-pressed={language === 'en'} onClick={() => setLanguage('en')}>{t('english')}</button><button type="button" className={language === 'uk' ? 'active' : ''} aria-pressed={language === 'uk'} onClick={() => setLanguage('uk')}>{t('ukrainian')}</button></div></fieldset><label className="settings-toggle"><span>{t('sound')}</span><input type="checkbox" checked={preferences.sound} onChange={(event) => setPreferences({ ...preferences, sound: event.target.checked })} /></label><label className="settings-toggle"><span>{t('vibration')}</span><input type="checkbox" checked={preferences.vibration} onChange={(event) => setPreferences({ ...preferences, vibration: event.target.checked })} /></label></Dialog>}
    </header>
    {!online && <p className="offline-banner" role="status">{t('staleSnapshot')}</p>}
    {updateReady && !paymentFlowOpen && <section className="update-banner" role="status"><span>{t('updateReady')}</span><button type="button" className="button button-primary" onClick={applyPwaUpdate}>{t('updateApp')}</button><button type="button" className="button button-quiet" onClick={() => setUpdateReady(false)}>{t('updateLater')}</button></section>}
    {path === '/profile' ? <ProfilePage profile={profile} onUpdated={setProfile} onBack={() => navigate('/')} /> : path === '/games/new' ? <CreateGamePage profile={profile} onCancel={() => navigate('/')} onCreated={(id) => navigate(`/games/${encodeURIComponent(id)}`)} /> : path === '/games/join' ? <JoinGamePage initialJoinCode={joinCode} invitationToken={invitationToken} onJoined={(id) => navigate(`/games/${encodeURIComponent(id)}`)} onBack={() => navigate('/')} /> : gameMatch !== null ? <GamePage gameId={gameMatch[1]} onBack={() => navigate('/')} preferences={preferences} offline={!online} onPaymentFlowChange={setPaymentFlowOpen} /> : <SavedGamesPage onCreateGame={() => navigate('/games/new')} onJoinGame={(code) => navigate(`/games/join${code === undefined ? '' : `?code=${encodeURIComponent(code)}`}`)} onOpenGame={(id) => navigate('/games/' + encodeURIComponent(id))} />}
  </div>;
}

function OfflineShell() { const { t } = useLanguage(); return <main className="offline-shell"><span className="brand-mark" aria-hidden="true">MB</span><h1>{t('offlineShellTitle')}</h1><p>{t('offlineShellDescription')}</p></main>; }

/** Hash fragments do not leave the device in a Referer header. */
function invitationFromLocation(): string {
  return new URLSearchParams(window.location.hash.slice(1)).get('invite') ?? '';
}

export default App;
