import { useEffect, useState } from 'react';
import type { GameSummary } from '../../shared/contracts/api';
import { MonopolyBankApiError, monopolyBankApi } from '../api/monopoly-bank-api';

interface Props { onCreateGame: () => void; onOpenGame: (gameId: string) => void; }

export function SavedGamesPage({ onCreateGame, onOpenGame }: Props) {
  const [games, setGames] = useState<GameSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const loadGames = () => { setLoading(true); setError(null); void monopolyBankApi.listGames().then((result) => { setGames(result); }, (caught: unknown) => { setError(caught instanceof MonopolyBankApiError ? caught.message : 'Unable to load saved games.'); }).finally(() => setLoading(false)); };
  useEffect(() => { void monopolyBankApi.listGames().then((result) => { setGames(result); }, (caught: unknown) => { setError(caught instanceof MonopolyBankApiError ? caught.message : 'Unable to load saved games.'); }).finally(() => setLoading(false)); }, []);
  return <main className="page"><section className="page-heading"><div><p className="eyebrow">Monopoly Bank</p><h1>Saved games</h1><p className="lede">Pick up a game or start a new bank.</p></div><button className="button button-primary" type="button" onClick={onCreateGame}>Create new game</button></section>
    {loading && <p className="status" role="status">Loading saved games…</p>}
    {error !== null && <section className="notice notice-error" role="alert"><p>{error}</p><button className="button button-secondary" type="button" onClick={() => void loadGames()}>Try again</button></section>}
    {!loading && error === null && games.length === 0 && <section className="empty-state"><h2>No saved games yet</h2><p>Create a game for two to six players to get started.</p><button className="button button-primary" type="button" onClick={onCreateGame}>Create new game</button></section>}
    {!loading && error === null && games.length > 0 && <section className="game-grid" aria-label="Saved games">{games.map(({ game, playerCount }) => <article className="game-card" key={game.id}><div><h2>{game.name}</h2><p>{playerCount} {playerCount === 1 ? 'player' : 'players'}</p><p className="muted">Updated {formatDate(game.updatedAt)}</p></div><button className="button button-secondary" type="button" onClick={() => onOpenGame(game.id)}>Open game</button></article>)}</section>}
  </main>;
}

function formatDate(value: string): string { const date = new Date(value); return Number.isNaN(date.valueOf()) ? value : new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(date); }
