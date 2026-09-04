import { useState, type FormEvent } from 'react';
import { monopolyBankApi } from '../api/monopoly-bank-api';
import { apiErrorMessage } from '../i18n/api-errors';
import { useLanguage } from '../i18n/language-context';

interface Props { initialJoinCode: string; invitationToken: string; onJoined: (gameId: string) => void; onBack: () => void; }

export function JoinGamePage({ initialJoinCode, invitationToken, onJoined, onBack }: Props) {
  const { t } = useLanguage();
  const [joinCode, setJoinCode] = useState(initialJoinCode.toUpperCase());
  const [gameAccessPassword, setGameAccessPassword] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [submitting, setSubmitting] = useState(false);
  const hasInvitation = invitationToken !== '';
  const join = async (event: FormEvent) => { event.preventDefault(); setSubmitting(true); setError(null); try { const details = await monopolyBankApi.joinGame(hasInvitation ? { invitationToken } : { joinCode: joinCode.trim().toUpperCase(), ...(gameAccessPassword === '' ? {} : { gameAccessPassword }) }); onJoined(details.game.id); } catch (caught) { setError(caught); } finally { setSubmitting(false); } };
  return <main className="page page-narrow auth-page"><section className="banknote-panel auth-card"><button className="button button-quiet auth-back" type="button" onClick={onBack}>← {t('savedGames')}</button><div className="auth-card-heading"><span className="auth-card-mark" aria-hidden="true">MB</span><div><p className="eyebrow">{t('lobby')}</p><h1>{t('joinGame')}</h1></div></div><p className="lede">{hasInvitation ? t('secureInviteDescription') : t('joinGameDescription')}</p><form className="game-form auth-form" onSubmit={(event) => void join(event)}>{hasInvitation ? <p className="notice notice-success" role="status">{t('secureInviteReady')}</p> : <><label>{t('invitationCode')}<input value={joinCode} autoCapitalize="characters" autoComplete="off" minLength={6} maxLength={12} placeholder={t('invitationCodeExample')} onChange={(event) => setJoinCode(event.target.value.toUpperCase())} required /></label><label>{t('optionalPassword')}<input type="password" value={gameAccessPassword} minLength={4} maxLength={256} autoComplete="current-password" placeholder={t('tablePassword')} onChange={(event) => setGameAccessPassword(event.target.value)} /><span className="field-hint">{t('gamePasswordMinLength')}</span></label></>}{error !== null && <p className="notice notice-error" role="alert">{apiErrorMessage(error, t, 'unableJoinGame')}</p>}<button className="button button-primary" disabled={submitting}>{submitting ? t('joining') : t('joinGame')}</button></form></section></main>;
}
