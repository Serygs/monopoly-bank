import {
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import { monopolyBankApi } from '../api/monopoly-bank-api';
import { apiErrorMessage } from '../i18n/api-errors';
import { useLanguage } from '../i18n/language-context';
import { AmountInput } from '../components/AmountInput';
import { useAmountInput } from '../components/amount-input-state';
import { PageHeader } from '../components/PageHeader';
import type { Translate } from '../i18n/translations';
import { formatMoney } from '../utils/money';
import { getGameNameSuggestions, randomSuggestionStart } from '../utils/game-name-suggestions';
import {
  selectableCurrencies,
  type Currency,
  type PaymentMode,
  type SelectableCurrency,
} from '../../shared/types/monopoly';
import type { UserProfile } from '../../shared/contracts/api';

const colors = [
  { value: '#d83f55', token: '--color-player-red', nameKey: 'playerColorRed' },
  { value: '#2878d0', token: '--color-player-blue', nameKey: 'playerColorBlue' },
  { value: '#238b57', token: '--color-player-green', nameKey: 'playerColorGreen' },
  { value: '#d97721', token: '--color-player-orange', nameKey: 'playerColorOrange' },
  { value: '#8b4cc5', token: '--color-player-purple', nameKey: 'playerColorPurple' },
  { value: '#087f78', token: '--color-player-teal', nameKey: 'playerColorTeal' },
] as const;
const defaultStartingBalance = 15_000_000;
const defaultPassGoReward = 2_000_000;
interface PlayerForm {
  key: number;
  name: string;
  color: string;
}
interface Props {
  profile: UserProfile;
  onCancel: () => void;
  onCreated: (gameId: string) => void;
}

export function CreateGamePage({ profile, onCancel, onCreated }: Props) {
  const { language, t } = useLanguage();
  const nextKey = useRef(3);
  const gameNameInputRef = useRef<HTMLInputElement>(null);
  const suggestionsRootRef = useRef<HTMLDivElement>(null);
  const gameNameInputId = useId();
  const suggestionsId = useId();
  const [name, setName] = useState('');
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [suggestionStart, setSuggestionStart] = useState(0);
  const [startingBalance, setStartingBalance] = useState(String(defaultStartingBalance));
  const [passGoReward, setPassGoReward] = useState(String(defaultPassGoReward));
  const [currency, setCurrency] = useState<SelectableCurrency>('USD');
  const [paymentMode, setPaymentMode] = useState<PaymentMode>('FAST');
  const [gameAccessPassword, setGameAccessPassword] = useState('');
  const [players, setPlayers] = useState<PlayerForm[]>([
    { key: 1, name: profile.nickname, color: colors[0].value },
  ]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<unknown | null>(null);
  const suggestions = getGameNameSuggestions(language, suggestionStart);

  useEffect(() => {
    if (!suggestionsOpen) return;
    const closeFromOutside = (event: PointerEvent) => {
      if (!suggestionsRootRef.current?.contains(event.target as Node)) setSuggestionsOpen(false);
    };
    const closeFromEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setSuggestionsOpen(false);
      gameNameInputRef.current?.focus();
    };
    document.addEventListener('pointerdown', closeFromOutside);
    document.addEventListener('keydown', closeFromEscape);
    return () => {
      document.removeEventListener('pointerdown', closeFromOutside);
      document.removeEventListener('keydown', closeFromEscape);
    };
  }, [suggestionsOpen]);

  const toggleSuggestions = () => {
    setSuggestionsOpen((open) => {
      if (!open) setSuggestionStart(randomSuggestionStart());
      return !open;
    });
  };
  const updatePlayer = (key: number, change: Partial<Omit<PlayerForm, 'key'>>) =>
    setPlayers(players.map((player) => (player.key === key ? { ...player, ...change } : player)));
  const addPlayer = () => {
    if (players.length < 6) {
      const color =
        colors.find((candidate) => !players.some((player) => player.color === candidate.value))
          ?.value ?? colors[0].value;
      setPlayers([...players, { key: nextKey.current++, name: '', color }]);
    }
  };
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextErrors = validate(name, startingBalance, passGoReward, players, t);
    if (gameAccessPassword !== '' && gameAccessPassword.length < 4)
      nextErrors.gameAccessPassword = t('gamePasswordMinLength');
    setErrors(nextErrors);
    setSubmitError(null);
    if (Object.keys(nextErrors).length > 0) return;
    setSubmitting(true);
    try {
      const details = await monopolyBankApi.createGame({
        name: name.trim(),
        startingBalance: Number(startingBalance),
        passGoReward: Number(passGoReward),
        currency,
        paymentMode,
        ...(gameAccessPassword === '' ? {} : { gameAccessPassword }),
        players: players.map((player) => ({ name: player.name.trim(), color: player.color })),
      });
      onCreated(details.game.id);
    } catch (caught) {
      setSubmitError(caught);
    } finally {
      setSubmitting(false);
    }
  };
  return (
    <main className="page create-game-page">
      <PageHeader
        eyebrow={t('newBank')}
        title={t('createLobby')}
        description={t('lobbyLede')}
        backAction={
          <button className="button button-quiet" type="button" onClick={onCancel}>
            {t('cancel')}
          </button>
        }
      />
      <form
        className="game-form create-game-form"
        onSubmit={(event) => void submit(event)}
        noValidate
      >
        <fieldset className="form-section create-section-basics">
          <legend>{t('gameBasics')}</legend>
          <div className="form-section-fields">
            <div className="game-name-field">
              <label htmlFor={gameNameInputId}>{t('gameName')}</label>
              <div className="game-name-control" ref={suggestionsRootRef}>
                <input
                  ref={gameNameInputRef}
                  id={gameNameInputId}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  aria-invalid={errors.name !== undefined}
                />
                <button
                  className="game-name-suggest-trigger"
                  type="button"
                  aria-haspopup="dialog"
                  aria-expanded={suggestionsOpen}
                  aria-controls={suggestionsId}
                  onClick={toggleSuggestions}
                >
                  <SparklesIcon />
                  <span>{t('suggestGameName')}</span>
                </button>
                {suggestionsOpen && (
                  <div
                    className="game-name-suggestions"
                    id={suggestionsId}
                    role="dialog"
                    aria-label={t('suggestedGameNames')}
                  >
                    <div className="game-name-suggestions-heading">
                      <SparklesIcon />
                      <span>{t('suggestedGameNames')}</span>
                    </div>
                    <div className="game-name-suggestion-list" role="group">
                      {suggestions.map((suggestion) => (
                        <button
                          className="game-name-suggestion"
                          type="button"
                          key={suggestion.name}
                          onClick={() => {
                            setName(suggestion.name);
                            setSuggestionsOpen(false);
                            gameNameInputRef.current?.focus();
                          }}
                        >
                          <span aria-hidden="true">{suggestion.icon}</span>
                          <span>{suggestion.name}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              {fieldError(errors.name)}
            </div>
            <label>
              {t('currency')}
              <select
                value={currency}
                onChange={(event) => setCurrency(event.target.value as SelectableCurrency)}
              >
                {selectableCurrencies.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </label>
          </div>
        </fieldset>
        <fieldset className="form-section create-section-rules">
          <legend>{t('bankingRules')}</legend>
          <div className="form-section-fields">
            <label>
              {t('paymentMode')}
              <select
                value={paymentMode}
                onChange={(event) => setPaymentMode(event.target.value as PaymentMode)}
              >
                <option value="FAST">{t('paymentModeFast')}</option>
                <option value="CONFIRMATION">{t('paymentModeConfirmation')}</option>
              </select>
              <span className="field-hint">{t('paymentModeLocked')}</span>
            </label>
            <label>
              {t('optionalPassword')}
              <input
                type="password"
                autoComplete="new-password"
                value={gameAccessPassword}
                onChange={(event) => setGameAccessPassword(event.target.value)}
                aria-invalid={errors.gameAccessPassword !== undefined}
              />
              <span className="field-hint">{t('optionalPasswordHint')}</span>
              {fieldError(errors.gameAccessPassword)}
            </label>
            <div className="field-grid">
              <MoneyField
                label={t('startingBalance')}
                value={startingBalance}
                currency={currency}
                onChange={setStartingBalance}
                error={errors.startingBalance}
              />
              <MoneyField
                label={t('passGoReward')}
                value={passGoReward}
                currency={currency}
                onChange={setPassGoReward}
                error={errors.passGoReward}
              />
            </div>
          </div>
        </fieldset>
        <fieldset className="form-section create-section-owner">
          <legend>{t('ownerPlayer')}</legend>
          <div className="player-list">
            {players.slice(0, 1).map((player) => (
              <section className="player-editor" key={player.key}>
                <label>
                  {t('playerName', { number: 1 })}
                  <input
                    value={player.name}
                    onChange={(event) => updatePlayer(player.key, { name: event.target.value })}
                    aria-invalid={errors[`player-${player.key}`] !== undefined}
                  />
                  {fieldError(errors[`player-${player.key}`])}
                </label>
                <ColorPicker
                  player={player}
                  players={players}
                  onChange={(color) => updatePlayer(player.key, { color })}
                />
              </section>
            ))}
          </div>
        </fieldset>
        <fieldset className="form-section create-section-players">
          <legend>{t('localPlayers')}</legend>
          <div className="section-title">
            <p className="field-hint">{t('localPlayersHint')}</p>
            <button
              className="button button-secondary"
              type="button"
              onClick={addPlayer}
              disabled={players.length >= 6}
            >
              {t('addPlayer')}
            </button>
          </div>
          {fieldError(errors.players)}
          <div className="player-list">
            {players.slice(1).map((player, index) => (
              <section className="player-editor" key={player.key}>
                <label>
                  {t('playerName', { number: index + 2 })}
                  <input
                    value={player.name}
                    onChange={(event) => updatePlayer(player.key, { name: event.target.value })}
                    aria-invalid={errors[`player-${player.key}`] !== undefined}
                  />
                  {fieldError(errors[`player-${player.key}`])}
                </label>
                <ColorPicker
                  player={player}
                  players={players}
                  onChange={(color) => updatePlayer(player.key, { color })}
                />
                <button
                  className="button button-quiet remove-player"
                  type="button"
                  onClick={() =>
                    setPlayers(players.filter((candidate) => candidate.key !== player.key))
                  }
                >
                  {t('remove')}
                </button>
              </section>
            ))}
          </div>
        </fieldset>
        {submitError !== null && (
          <p className="notice notice-error create-form-status" role="alert">
            {apiErrorMessage(submitError, t, 'unableCreateGame')}
          </p>
        )}
        <div className="form-actions create-form-actions">
          <button className="button button-primary" type="submit" disabled={submitting}>
            {submitting ? t('startingLobby') : t('createLobby')}
          </button>
        </div>
      </form>
    </main>
  );
}

function SparklesIcon() {
  return (
    <svg className="sparkles-icon" viewBox="0 0 20 20" aria-hidden="true">
      <path d="M10 1.75c.48 3.43 2.27 5.22 5.7 5.7-3.43.48-5.22 2.27-5.7 5.7-.48-3.43-2.27-5.22-5.7-5.7 3.43-.48 5.22-2.27 5.7-5.7Z" />
      <path d="M15.75 12.25c.2 1.45.96 2.2 2.4 2.4-1.44.2-2.2.96-2.4 2.4-.2-1.44-.95-2.2-2.4-2.4 1.45-.2 2.2-.95 2.4-2.4ZM3.45 12.3c.14 1.03.68 1.57 1.71 1.71-1.03.15-1.57.68-1.71 1.72-.15-1.04-.68-1.57-1.72-1.72 1.04-.14 1.57-.68 1.72-1.71Z" />
    </svg>
  );
}

function ColorPicker({
  player,
  players,
  onChange,
}: {
  player: PlayerForm;
  players: PlayerForm[];
  onChange: (color: string) => void;
}) {
  const { t } = useLanguage();
  const moveColorFocus = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'Home', 'End'].includes(event.key))
      return;
    const options = Array.from(
      event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="radio"]:not(:disabled)'),
    );
    if (options.length === 0) return;
    event.preventDefault();
    const currentIndex = options.indexOf(document.activeElement as HTMLButtonElement);
    const nextIndex =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? options.length - 1
          : event.key === 'ArrowRight' || event.key === 'ArrowDown'
            ? (currentIndex + 1) % options.length
            : (currentIndex - 1 + options.length) % options.length;
    options[nextIndex]?.focus();
    options[nextIndex]?.click();
  };
  return (
    <fieldset className="color-picker">
      <legend>{t('color')}</legend>
      <div
        className="color-options"
        role="radiogroup"
        aria-label={t('color')}
        onKeyDown={moveColorFocus}
      >
        {colors.map((color) => {
          const taken = players.some(
            (candidate) => candidate.key !== player.key && candidate.color === color.value,
          );
          const selected = player.color === color.value;
          return (
            <button
              className={`color-option${selected ? ' selected' : ''}`}
              type="button"
              role="radio"
              key={color.value}
              style={{ '--player-color': `var(${color.token})` } as CSSProperties}
              aria-label={t('selectColor', { color: t(color.nameKey) })}
              aria-checked={selected}
              tabIndex={selected ? 0 : -1}
              disabled={taken}
              onClick={() => onChange(color.value)}
            >
              <span aria-hidden="true">{selected ? '✓' : ''}</span>
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

function MoneyField({
  label,
  value,
  currency,
  onChange,
  error,
}: {
  label: string;
  value: string;
  currency: Currency;
  onChange: (value: string) => void;
  error: string | undefined;
}) {
  const { t } = useLanguage();
  const inputId = useId();
  const { state, changeDigits, changeUnit } = useAmountInput(value, onChange, () => 'MILLIONS');
  const amount = isPositive(value) ? formatMoney(Number(value), currency) : '—';
  return (
    <div className="dialog-field amount-field">
      <label htmlFor={inputId}>{label}</label>
      <AmountInput
        id={inputId}
        state={state}
        onDigitsChange={changeDigits}
        onUnitChange={changeUnit}
        invalid={error !== undefined}
      />
      <span className="field-hint">{t('displayedAs', { amount })}</span>
      {fieldError(error)}
    </div>
  );
}
function fieldError(error: string | undefined) {
  return error === undefined ? null : <span className="field-error">{error}</span>;
}
function isPositive(value: string) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0;
}
function validate(
  name: string,
  starting: string,
  reward: string,
  players: PlayerForm[],
  t: Translate,
): Record<string, string> {
  const errors: Record<string, string> = {};
  if (name.trim().length === 0) errors.name = t('enterGameName');
  if (!isPositive(starting)) errors.startingBalance = t('enterPositiveInteger');
  if (!isPositive(reward)) errors.passGoReward = t('enterPositiveInteger');
  if (players.length < 1 || players.length > 6) errors.players = t('invalidLobbyPlayerCount');
  for (const player of players)
    if (player.name.trim().length === 0) errors[`player-${player.key}`] = t('enterPlayerName');
  return errors;
}
