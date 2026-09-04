import { useEffect, useState } from 'react';
import { CreateGamePage } from './pages/CreateGamePage';
import { GamePage } from './pages/GamePage';
import { SavedGamesPage } from './pages/SavedGamesPage';
import { AuthPage } from './pages/AuthPage';
import { ProfilePage } from './pages/ProfilePage';
import { JoinGamePage } from './pages/JoinGamePage';
import { monopolyBankApi } from './api/monopoly-bank-api';
import type { UserProfile } from '../shared/contracts/api';
import { useLanguage } from './i18n/language-context';
import { applyTheme, readPreferences, writePreferences, type DevicePreferences } from './utils/preferences';
import './App.css';

function App() {
  const { language, setLanguage, t } = useLanguage();
  const [path, setPath] = useState(window.location.pathname);
  const [preferences, setPreferences] = useState<DevicePreferences>(() => readPreferences());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [profile, setProfile] = useState<UserProfile | null | undefined>(undefined);
  useEffect(() => { applyTheme(preferences.theme); writePreferences(preferences); }, [preferences]);
  useEffect(() => { const onPopState = () => setPath(window.location.pathname); window.addEventListener('popstate', onPopState); return () => window.removeEventListener('popstate', onPopState); }, []);
  useEffect(() => { void monopolyBankApi.currentProfile().then(setProfile).catch(() => setProfile(null)); }, []);
  const navigate = (target: string) => { window.history.pushState({}, '', target); setPath(target); };
  const gameMatch = /^\/games\/([^/]+)$/.exec(path);
  if (profile === undefined) return <main className="page"><p className="status">Loading account…</p></main>;
  if (profile === null) return <AuthPage onAuthenticated={(user) => { setProfile(user); navigate('/'); }} />;
  const joinCode = path === '/games/join' ? new URLSearchParams(window.location.search).get('code') ?? '' : '';
  return <div className="app-shell"><header className="app-header"><div className="app-header-inner"><button type="button" className="brand" onClick={() => navigate('/')}><span className="brand-mark" aria-hidden="true">MB</span><span>{t('appName')}</span></button><div className="header-tools"><button className="button button-quiet" onClick={() => navigate('/profile')}>{profile.avatar} {profile.nickname}</button><span className="bank-status"><i aria-hidden="true" /> {t('bankOpen')}</span><button className="settings-button" type="button" aria-label="Settings" aria-expanded={settingsOpen} onClick={() => setSettingsOpen(!settingsOpen)}>⚙ <span>Settings</span></button><div className="language-switch" role="group" aria-label={t('language')}><button type="button" className={language === 'en' ? 'active' : ''} aria-pressed={language === 'en'} aria-label={t('english')} onClick={() => setLanguage('en')}>EN</button><button type="button" className={language === 'uk' ? 'active' : ''} aria-pressed={language === 'uk'} aria-label={t('ukrainian')} onClick={() => setLanguage('uk')}>UA</button></div></div></div>{settingsOpen && <div className="settings-panel"><label>Theme <select value={preferences.theme} onChange={(event) => setPreferences({ ...preferences, theme: event.target.value as DevicePreferences['theme'] })}><option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option></select></label><label><input type="checkbox" checked={preferences.sound} onChange={(event) => setPreferences({ ...preferences, sound: event.target.checked })} /> Sound</label><label><input type="checkbox" checked={preferences.vibration} onChange={(event) => setPreferences({ ...preferences, sound: event.target.checked })} /> Vibration</label></div>}</header>{path === '/profile' ? <ProfilePage profile={profile} onUpdated={setProfile} onBack={() => navigate('/')} /> : path === '/games/new' ? <CreateGamePage onCancel={() => navigate('/')} onCreated={(id) => navigate(`/games/${encodeURIComponent(id)}`)} /> : path === '/games/join' ? <JoinGamePage initialJoinCode={joinCode} onJoined={(id) => navigate(`/games/${encodeURIComponent(id)}`)} onBack={() => navigate('/')} /> : gameMatch !== null ? <GamePage gameId={gameMatch[1]} onBack={() => navigate('/')} preferences={preferences} /> : <SavedGamesPage onCreateGame={() => navigate('/games/new')} onJoinGame={() => navigate('/games/join')} onOpenGame={(id) => navigate(`/games/${encodeURIComponent(id)}`)} />}</div>;
}

export default App;
