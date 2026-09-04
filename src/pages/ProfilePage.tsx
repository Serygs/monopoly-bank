import { useState, type FormEvent } from 'react';
import type { UserProfile } from '../../shared/contracts/api';
import { monopolyBankApi } from '../api/monopoly-bank-api';

export function ProfilePage({ profile, onUpdated, onBack }: { profile: UserProfile; onUpdated: (profile: UserProfile) => void; onBack: () => void }) {
  const [nickname, setNickname] = useState(profile.nickname); const [avatar, setAvatar] = useState(profile.avatar); const [error, setError] = useState<string | null>(null);
  const save = async (event: FormEvent) => { event.preventDefault(); try { onUpdated(await monopolyBankApi.updateProfile({ nickname, avatar })); } catch (caught) { setError(caught instanceof Error ? caught.message : 'Unable to update profile.'); } };
  return <main className="page page-narrow"><section className="banknote-panel"><button className="button button-quiet" onClick={onBack}>Saved games</button><p className="eyebrow">Player profile</p><h1>{profile.avatar} {profile.nickname}</h1><dl><dt>Games played</dt><dd>{profile.gamesPlayed}</dd><dt>Games won</dt><dd>{profile.gamesWon}</dd><dt>Win rate</dt><dd>{Math.round(profile.winRate * 100)}%</dd></dl><form className="game-form" onSubmit={(event) => void save(event)}><label>Nickname<input value={nickname} onChange={(event) => setNickname(event.target.value)} /></label><label>Avatar<select value={avatar} onChange={(event) => setAvatar(event.target.value)}>{['🎩', '🚗', '🐶', '🚢', '🎲', '💎'].map((item) => <option key={item}>{item}</option>)}</select></label>{error !== null && <p className="notice notice-error">{error}</p>}<button className="button button-primary">Save profile</button></form></section></main>;
}
