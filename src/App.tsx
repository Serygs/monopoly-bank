import { useEffect, useState } from 'react';
import { CreateGamePage } from './pages/CreateGamePage';
import { GamePage } from './pages/GamePage';
import { SavedGamesPage } from './pages/SavedGamesPage';
import { useLanguage } from './i18n/language-context';
import { applyTheme, readPreferences, writePreferences, type DevicePreferences } from './utils/preferences';
import './App.css';

function App() {
  const { language, setLanguage, t } = useLanguage();
  const [path, setPath] = useState(window.location.pathname);
  const [preferences, setPreferences] = useState<DevicePreferences>(() => readPreferences());
  const [settingsOpen, setSettingsOpen] = useState(false);
  useEffect(() => { applyTheme(preferences.theme); writePreferences(preferences); }, [preferences]);
  useEffect(() => { const onPopState = () => setPath(window.location.pathname); window.addEventListener('popstate', onPopState); return () => window.removeEventListener('popstate', onPopState); }, []);
  const navigate = (target: string) => { window.history.pushState({}, '', target); setPath(target); };
  const gameMatch = /^\/games\/([^/]+)$/.exec(path);
  return <div className="app-shell"><header className="app-header"><div className="app-header-inner"><button type="button" className="brand" onClick={() => navigate('/')}><span className="brand-mark" aria-hidden="true">MB</span><span>{t('appName')}</span></button><div className="header-tools"><span className="bank-status"><i aria-hidden="true" /> {t('bankOpen')}</span><button className="settings-button" type="button" aria-expanded={settingsOpen} onClick={() => setSettingsOpen(!settingsOpen)}>⚙ Settings</button><div className="language-switch" role="group" aria-label={t('language')}><button type="button" className={language === 'en' ? 'active' : ''} aria-pressed={language === 'en'} aria-label={t('english')} onClick={() => setLanguage('en')}>EN</button><button type="button" className={language === 'uk' ? 'active' : ''} aria-pressed={language === 'uk'} aria-label={t('ukrainian')} onClick={() => setLanguage('uk')}>UA</button></div></div></div>{settingsOpen && <div className="settings-panel"><label>Theme <select value={preferences.theme} onChange={(event) => setPreferences({ ...preferences, theme: event.target.value as DevicePreferences['theme'] })}><option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option></select></label><label><input type="checkbox" checked={preferences.sound} onChange={(event) => setPreferences({ ...preferences, sound: event.target.checked })} /> Sound</label><label><input type="checkbox" checked={preferences.vibration} onChange={(event) => setPreferences({ ...preferences, vibration: event.target.checked })} /> Vibration</label></div>}</header>{path === '/games/new' ? <CreateGamePage onCancel={() => navigate('/')} onCreated={(id) => navigate(`/games/${encodeURIComponent(id)}`)} /> : gameMatch !== null ? <GamePage gameId={gameMatch[1]} onBack={() => navigate('/')} preferences={preferences} /> : <SavedGamesPage onCreateGame={() => navigate('/games/new')} onOpenGame={(id) => navigate(`/games/${encodeURIComponent(id)}`)} />}</div>;
}

export default App;
