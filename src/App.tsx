import { useEffect, useState } from 'react';
import { CreateGamePage } from './pages/CreateGamePage';
import { GamePage } from './pages/GamePage';
import { SavedGamesPage } from './pages/SavedGamesPage';
import './App.css';

function App() {
  const [path, setPath] = useState(window.location.pathname);
  useEffect(() => { const onPopState = () => setPath(window.location.pathname); window.addEventListener('popstate', onPopState); return () => window.removeEventListener('popstate', onPopState); }, []);
  const navigate = (target: string) => { window.history.pushState({}, '', target); setPath(target); };
  const gameMatch = /^\/games\/([^/]+)$/.exec(path);
  return <div className="app-shell"><header className="app-header"><button type="button" className="brand" onClick={() => navigate('/')}>Monopoly Bank</button></header>{path === '/games/new' ? <CreateGamePage onCancel={() => navigate('/')} onCreated={(id) => navigate(`/games/${encodeURIComponent(id)}`)} /> : gameMatch !== null ? <GamePage gameId={gameMatch[1]} onBack={() => navigate('/')} /> : <SavedGamesPage onCreateGame={() => navigate('/games/new')} onOpenGame={(id) => navigate(`/games/${encodeURIComponent(id)}`)} />}</div>;
}

export default App;
