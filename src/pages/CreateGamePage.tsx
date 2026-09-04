import { useRef, useState, type FormEvent } from 'react';
import { monopolyBankApi } from '../api/monopoly-bank-api';
import { apiErrorMessage } from '../i18n/api-errors';
import { useLanguage } from '../i18n/language-context';
import type { Translate } from '../i18n/translations';
import { formatMoney } from '../utils/money';
import { currencies, type Currency } from '../../shared/types/monopoly';

const colors = ['#e05263', '#2f80ed', '#27ae60', '#f2994a', '#9b51e0', '#14b8a6'];
interface PlayerForm { key: number; name: string; color: string; }
interface Props { onCancel: () => void; onCreated: (gameId: string) => void; }

export function CreateGamePage({ onCancel, onCreated }: Props) {
  const { t } = useLanguage();
  const nextKey = useRef(3);
  const [name, setName] = useState(''); const [startingBalance, setStartingBalance] = useState('1500'); const [passGoReward, setPassGoReward] = useState('200');
  const [currency, setCurrency] = useState<Currency>('K');
  const [gameAccessPassword, setGameAccessPassword] = useState('');
  const [players, setPlayers] = useState<PlayerForm[]>([{ key: 1, name: '', color: colors[0] }, { key: 2, name: '', color: colors[1] }]);
  const [errors, setErrors] = useState<Record<string, string>>({}); const [submitting, setSubmitting] = useState(false); const [submitError, setSubmitError] = useState<unknown | null>(null);
  const updatePlayer = (key: number, change: Partial<Omit<PlayerForm, 'key'>>) => setPlayers(players.map((player) => player.key === key ? { ...player, ...change } : player));
  const addPlayer = () => { if (players.length < 6) { const color = colors.find((candidate) => !players.some((player) => player.color === candidate)) ?? colors[0]; setPlayers([...players, { key: nextKey.current++, name: '', color }]); } };
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const nextErrors = validate(name, startingBalance, passGoReward, players, t); if (gameAccessPassword.length < 10) nextErrors.gameAccessPassword = 'Use at least 10 characters.'; setErrors(nextErrors); setSubmitError(null); if (Object.keys(nextErrors).length > 0) return;
    setSubmitting(true); try { const details = await monopolyBankApi.createGame({ name: name.trim(), startingBalance: Number(startingBalance), passGoReward: Number(passGoReward), currency, gameAccessPassword, players: players.map((player) => ({ name: player.name.trim(), color: player.color })) }); onCreated(details.game.id); } catch (caught) { setSubmitError(caught); } finally { setSubmitting(false); }
  };
  return <main className="page page-narrow"><section className="page-heading"><div><p className="eyebrow">{t('newBank')}</p><h1>{t('createGame')}</h1><p className="lede">{t('createGameLede')}</p></div><button className="button button-quiet" type="button" onClick={onCancel}>{t('cancel')}</button></section>
    <form className="game-form" onSubmit={(event) => void submit(event)} noValidate><fieldset><legend>{t('game')}</legend><label>{t('gameName')}<input value={name} onChange={(event) => setName(event.target.value)} aria-invalid={errors.name !== undefined} />{fieldError(errors.name)}</label><label>{t('currency')}<select value={currency} onChange={(event) => setCurrency(event.target.value as Currency)}>{currencies.map((option) => <option key={option} value={option}>{option}</option>)}</select></label><label>Game access password<input type="password" autoComplete="new-password" value={gameAccessPassword} onChange={(event) => setGameAccessPassword(event.target.value)} aria-invalid={errors.gameAccessPassword !== undefined} />{fieldError(errors.gameAccessPassword)}</label><div className="field-grid"><MoneyField label={t('startingBalance')} value={startingBalance} currency={currency} onChange={setStartingBalance} error={errors.startingBalance} /><MoneyField label={t('passGoReward')} value={passGoReward} currency={currency} onChange={setPassGoReward} error={errors.passGoReward} /></div></fieldset>
      <fieldset><div className="section-title"><legend>{t('playersOfSix', { count: players.length })}</legend><button className="button button-secondary" type="button" onClick={addPlayer} disabled={players.length >= 6}>{t('addPlayer')}</button></div>{fieldError(errors.players)}<div className="player-list">{players.map((player, index) => <section className="player-editor" key={player.key}><label>{t('playerName', { number: index + 1 })}<input value={player.name} onChange={(event) => updatePlayer(player.key, { name: event.target.value })} aria-invalid={errors[`player-${player.key}`] !== undefined} />{fieldError(errors[`player-${player.key}`])}</label><div className="color-picker"><span>{t('color')}</span><div className="color-options">{colors.map((color) => { const taken = players.some((candidate) => candidate.key !== player.key && candidate.color === color); return <button className={`color-option${player.color === color ? ' selected' : ''}`} type="button" key={color} style={{ backgroundColor: color }} aria-label={t('selectColor', { color })} aria-pressed={player.color === color} disabled={taken} onClick={() => updatePlayer(player.key, { color })} />; })}</div></div><button className="button button-quiet remove-player" type="button" onClick={() => setPlayers(players.filter((candidate) => candidate.key !== player.key))} disabled={players.length <= 2}>{t('remove')}</button></section>)}</div></fieldset>
      {submitError !== null && <p className="notice notice-error" role="alert">{apiErrorMessage(submitError, t, 'unableCreateGame')}</p>}<div className="form-actions"><button className="button button-primary" type="submit" disabled={submitting}>{submitting ? t('creating') : t('createGame')}</button></div></form>
  </main>;
}

function MoneyField({ label, value, currency, onChange, error }: { label: string; value: string; currency: Currency; onChange: (value: string) => void; error: string | undefined }) { const { t } = useLanguage(); const amount = isPositive(value) ? formatMoney(Number(value), currency) : '—'; return <label>{label}<input type="number" inputMode="numeric" min="1" step="1" value={value} onChange={(event) => onChange(event.target.value)} aria-invalid={error !== undefined} /><span className="field-hint">{t('displayedAs', { amount })}</span>{fieldError(error)}</label>; }
function fieldError(error: string | undefined) { return error === undefined ? null : <span className="field-error">{error}</span>; }
function isPositive(value: string) { const number = Number(value); return Number.isSafeInteger(number) && number > 0; }
function validate(name: string, starting: string, reward: string, players: PlayerForm[], t: Translate): Record<string, string> { const errors: Record<string, string> = {}; if (name.trim().length === 0) errors.name = t('enterGameName'); if (!isPositive(starting)) errors.startingBalance = t('enterPositiveInteger'); if (!isPositive(reward)) errors.passGoReward = t('enterPositiveInteger'); if (players.length < 2 || players.length > 6) errors.players = t('invalidPlayerCount'); for (const player of players) if (player.name.trim().length === 0) errors[`player-${player.key}`] = t('enterPlayerName'); return errors; }
