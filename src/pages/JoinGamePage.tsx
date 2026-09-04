import { useState, type FormEvent } from 'react';
import { monopolyBankApi } from '../api/monopoly-bank-api';

export function JoinGamePage({ initialJoinCode, onJoined, onBack }: { initialJoinCode: string; onJoined: (gameId: string) => void; onBack: () => void }) {
  const [joinCode, setJoinCode] = useState(initialJoinCode.toUpperCase());
  const [gameAccessPassword, setGameAccessPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const join = async (event: FormEvent) => { event.preventDefault(); setSubmitting(true); setError(null); try { onJoined((await monopolyBankApi.joinGame({ joinCode: joinCode.trim().toUpperCase(), gameAccessPassword })).game.id); } catch (caught) { setError(caught instanceof Error ? caught.message : 'Unable to join this game.'); } finally { setSubmitting(false); } };
  return <main className="page page-narrow"><section className="banknote-panel"><button className="button button-quiet" type="button" onClick={onBack}>Saved games</button><p className="eyebrow">Private table</p><h1>Join a game</h1><p className="lede">Enter the invitation code and the table password supplied by the game owner.</p><form className="game-form" onSubmit={(event) => void join(event)}><label>Invitation code<input value={joinCode} autoCapitalize="characters" autoComplete="off" minLength={6} maxLength={12} onChange={(event) => setJoinCode(event.target.value.toUpperCase())} required /></label><label>Game password<input type="password" value={gameAccessPassword} minLength={10} autoComplete="current-password" onChange={(event) => setGameAccessPassword(event.target.value)} required /></label>{error !== null && <p className="notice notice-error" role="alert">{error}</p>}<button className="button button-primary" disabled={submitting}>{submitting ? 'Joining…' : 'Join game'}</button></form></section></main>;
}
