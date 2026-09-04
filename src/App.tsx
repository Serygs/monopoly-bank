import { useEffect, useState } from 'react';
import type { UserProfile } from '../shared/contracts/api';
import { monopolyBankApi } from './api/monopoly-bank-api';
import { Avatar } from './components/AvatarPicker';
import { useLanguage } from './i18n/language-context';
import { AuthPage } from './pages/AuthPage';
import { CreateGamePage } from './pages/CreateGamePage';
import { GamePage } from './pages/GamePage';
import { JoinGamePage } from './pages/JoinGamePage';
import { ProfilePage } from './pages/ProfilePage';
import { SavedGamesPage } from './pages/SavedGamesPage';
import { applyTheme, readPreferences, writePreferences, type DevicePreferences } from './utils/preferences';
import './App.css';

function App() {
  const { language, setLanguage, t } = useLanguage();
  const [path, setPath] = useState(window.location.pathname);
  const [preferences, setPreferences] = useState<DevicePreferences>(() => readPreferences());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [profile, setProfile] = useState<UserProfile | null | undefined>(undefined);

  useEffect(() => { applyTheme(preferences.theme); writePreferences(preferences); }, [preferences]);
  useEffect(() => {
    const onPopState = () => setPath(window.location.pathname);
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);
  useEffect(() => { void monopolyBankApi.currentProfile().then(setProfile).catch(() => setProfile(null)); }, []);

  const navigate = (target: string) => { window.history.pushState({}, '', target); setPath(target); };
  const gameMatch = /^\/games\/([^/]+)$/.exec(path);
  if (profile === undefined) return <main className="page"><p className="status">{t('loadingAccount')}</p></main>;
  if (profile === null) return <AuthPage onAuthenticated={(user) => { setProfile(user); navigate('/'); }} />;

  const joinCode = path === '/games/join' ? new URLSearchParams(window.location.search).get('code') ?? '' : '';
  const invitationToken = path === '/games/join' ? new URLSearchParams(window.location.search).get('invite') ?? '' : '';
  return <div className="app-shell">
    <header className="app-header">
      <div className="app-header-inner">
        <button type="button" className="brand" onClick={() => navigate('/')}><span className="brand-mark" aria-hidden="true">MB</span><span>{t('appName')}</span></button>
        <div className="header-tools">
          <button className="profile-menu-button" type="button" onClick={() => navigate('/profile')}><Avatar avatar={profile.avatar} label={profile.nickname} className="header-avatar" /><span>{profile.nickname}</span></button>
          <span className="bank-status"><i aria-hidden="true" /> {t('bankOpen')}</span>
          <button className="settings-button" type="button" aria-label={t('settings')} aria-expanded={settingsOpen} onClick={() => setSettingsOpen(!settingsOpen)}>⚙ <span>{t('settings')}</span></button>
        </div>
      </div>
      {settingsOpen && <section className="settings-panel" aria-label={t('settings')}><header><div><p className="eyebrow">{t('settings')}</p><h2>{t('settings')}</h2></div><button className="button button-quiet" type="button" onClick={() => setSettingsOpen(false)}>{t('close')}</button></header><label className="settings-select"><span>{t('theme')}</span><select value={preferences.theme} onChange={(event) => setPreferences({ ...preferences, theme: event.target.value as DevicePreferences['theme'] })}><option value="system">{t('themeSystem')}</option><option value="light">{t('themeLight')}</option><option value="dark">{t('themeDark')}</option></select></label><fieldset className="settings-options"><legend>{t('language')}</legend><div className="settings-segmented"><button type="button" className={language === 'en' ? 'active' : ''} aria-pressed={language === 'en'} onClick={() => setLanguage('en')}>{t('english')}</button><button type="button" className={language === 'uk' ? 'active' : ''} aria-pressed={language === 'uk'} onClick={() => setLanguage('uk')}>{t('ukrainian')}</button></div></fieldset><label className="settings-toggle"><span>{t('sound')}</span><input type="checkbox" checked={preferences.sound} onChange={(event) => setPreferences({ ...preferences, sound: event.target.checked })} /></label><label className="settings-toggle"><span>{t('vibration')}</span><input type="checkbox" checked={preferences.vibration} onChange={(event) => setPreferences({ ...preferences, vibration: event.target.checked })} /></label></section>}
    </header>
    {path === '/profile' ? <ProfilePage profile={profile} onUpdated={setProfile} onBack={() => navigate('/')} /> : path === '/games/new' ? <CreateGamePage profile={profile} onCancel={() => navigate('/')} onCreated={(id) => navigate(`/games/${encodeURIComponent(id)}`)} /> : path === '/games/join' ? <JoinGamePage initialJoinCode={joinCode} invitationToken={invitationToken} onJoined={(id) => navigate(`/games/${encodeURIComponent(id)}`)} onBack={() => navigate('/')} /> : gameMatch !== null ? <GamePage gameId={gameMatch[1]} onBack={() => navigate('/')} preferences={preferences} /> : <SavedGamesPage onCreateGame={() => navigate('/games/new')} onJoinGame={(code) => navigate(`/games/join${code === undefined ? '' : `?code=${encodeURIComponent(code)}`}`)} onOpenGame={(id) => navigate('/games/' + encodeURIComponent(id))} />}
  </div>;
}

export default App;
