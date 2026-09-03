import { useEffect, useState } from 'react';
import type { GameDetails } from '../../shared/contracts/api';
import { MonopolyBankApiError, monopolyBankApi } from '../api/monopoly-bank-api';
import { formatThousands } from '../utils/money';

interface Props { gameId: string; onBack: () => void; }

export function GamePage({ gameId, onBack }: Props) {
  const [details, setDetails] = useState<GameDetails | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { let active = true; void monopolyBankApi.getGame(gameId).then((game) => { if (active) setDetails(game); }, (caught: unknown) => { if (active) setError(caught instanceof MonopolyBankApiError ? caught.message : 'Unable to load game.'); }); return () => { active = false; }; }, [gameId]);
  if (error !== null) return <main className="page"><section className="notice notice-error" role="alert"><p>{error}</p><button className="button button-secondary" type="button" onClick={onBack}>Back to saved games</button></section></main>;
  if (details === null) return <main className="page"><p className="status" role="status">Loading game…</p></main>;
  return <main className="page"><section className="page-heading"><div><p className="eyebrow">Active game</p><h1>{details.game.name}</h1><p className="lede">Starting balance {formatThousands(details.game.startingBalance)}k · Pass GO {formatThousands(details.game.passGoReward)}k</p></div><button className="button button-quiet" type="button" onClick={onBack}>Saved games</button></section><section className="wallet-grid" aria-label="Player wallets">{details.players.map((player) => <article className="wallet-card" key={player.id}><span className="player-color" style={{ backgroundColor: player.color }} aria-hidden="true" /><p>{player.name}</p><strong>{formatThousands(player.balance)}k</strong></article>)}</section><section className="empty-state"><h2>Payments are next</h2><p>This screen reflects persisted game and player balances. Banking controls will arrive in the next phase.</p></section></main>;
}
