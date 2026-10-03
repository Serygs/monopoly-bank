import { Radio, RadioGroup } from '@headlessui/react';
import {
  Fragment,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type ReactNode,
} from 'react';
import { monopolyBankApi } from '../api/monopoly-bank-api';
import { apiErrorMessage } from '../i18n/api-errors';
import { useLanguage } from '../i18n/language-context';
import { AmountInput } from '../components/AmountInput';
import { useAmountInput } from '../components/amount-input-state';
import { PageHeader } from '../components/PageHeader';
import { Button, Field, FieldError, FieldHint, Notice, PageShell, Toolbar } from '../components/ui';
import { cx } from '../components/ui/class-names';
import { keepEnterInRadio } from '../components/ui/radio-keys';
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
  { value: '#d83f55', token: '--mb-color-player-red', nameKey: 'playerColorRed' },
  { value: '#2878d0', token: '--mb-color-player-blue', nameKey: 'playerColorBlue' },
  { value: '#238b57', token: '--mb-color-player-green', nameKey: 'playerColorGreen' },
  { value: '#d97721', token: '--mb-color-player-orange', nameKey: 'playerColorOrange' },
  { value: '#8b4cc5', token: '--mb-color-player-purple', nameKey: 'playerColorPurple' },
  { value: '#087f78', token: '--mb-color-player-teal', nameKey: 'playerColorTeal' },
] as const;
/* `!` outranks the unlayered `.game-form` gap in `primitives.css`. */
const formClass = cx(
  'game-form items-start',
  'md:grid-cols-2 md:gap-(--mb-layout-gap-medium)! lg:gap-(--mb-layout-gap-wide)!',
);
/* Each child is one player editor; consecutive editors are ruled off. */
const playerListClass = cx(
  'grid gap-(--mb-space-4) *:grid *:gap-(--mb-space-4)',
  '[&>*+*]:border-t [&>*+*]:border-border [&>*+*]:pt-(--mb-space-5)',
);
const ownerListClass = cx(
  playerListClass,
  'md:*:grid-cols-[minmax(14rem,1fr)_minmax(18rem,1.2fr)] md:*:items-start lg:*:grid-cols-[1fr]',
);
const sectionTitleClass = cx(
  'flex min-w-0 items-center justify-between gap-(--mb-space-3) [&_.field-hint]:m-0 [&_.field-hint]:min-w-0',
  'max-md:flex-col max-md:items-stretch max-md:[&_.button]:w-full',
);
const actionsClass = 'pt-(--mb-space-2) md:col-span-full [&_.button]:min-w-[min(100%,15rem)]';
/* `!` outranks the unlayered `.game-form fieldset` / `.game-form legend` rules in `primitives.css`. */
const colorPickerClass = cx(
  'border-0! bg-transparent! p-0! shadow-none!',
  '[&_legend]:mb-(--mb-space-3) [&_legend]:p-0! [&_legend]:text-[1rem]! [&_legend]:font-semibold',
);
const colorOptionClass = cx(
  'grid size-12 place-items-center rounded-full border-3 border-surface-elevated bg-(--player-color) p-0',
  'font-ui text-[1.1rem] leading-none font-bold text-on-player',
  'transition-[transform,box-shadow] duration-(--mb-duration-fast) ease-standard',
  '*:grid *:size-6 *:place-items-center *:rounded-full focus-visible:outline-offset-5',
  'disabled:opacity-30 disabled:grayscale-[0.72]',
  'fine-pointer:enabled:hover:transform-[translateY(-2px)] fine-pointer:enabled:hover:[box-shadow:0_0_0_3px_var(--mb-color-highlight),var(--mb-shadow-player-inset)]',
  'motion-reduce:transform-none!',
);
const colorOptionStateClass = {
  selected: cx(
    '[box-shadow:0_0_0_3px_var(--mb-color-surface-elevated),0_0_0_6px_var(--mb-color-accent),var(--mb-shadow-player-inset)]',
    '*:bg-[color-mix(in_srgb,var(--mb-color-surface-inverse)_62%,transparent)]',
  ),
  idle: '[box-shadow:0_0_0_1px_var(--mb-color-border-strong),var(--mb-shadow-player-inset)]',
};
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
    <PageShell>
      <PageHeader
        eyebrow={t('newBank')}
        title={t('createLobby')}
        description={t('lobbyLede')}
        backAction={
          <Button variant="quiet" onClick={onCancel}>
            {t('cancel')}
          </Button>
        }
      />
      <form className={formClass} onSubmit={(event) => void submit(event)} noValidate>
        <fieldset>
          <legend>{t('gameBasics')}</legend>
          <FieldStack>
            <div className="game-name-field grid gap-[7px] font-medium text-primary">
              <label htmlFor={gameNameInputId}>{t('gameName')}</label>
              <div className="game-name-control relative" ref={suggestionsRootRef}>
                <input
                  ref={gameNameInputRef}
                  id={gameNameInputId}
                  className="pr-[8.75rem]! max-[24rem]:pr-[4rem]!"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  aria-invalid={errors.name !== undefined}
                  aria-errormessage={
                    errors.name === undefined ? undefined : `${gameNameInputId}-error`
                  }
                />
                <Button
                  className="game-name-suggest-trigger absolute min-h-11 justify-center inset-[2px_2px_auto_auto] gap-(--mb-space-2) rounded-[calc(var(--mb-radius-control)_-_2px)] border-0 bg-accent-soft px-(--mb-space-3) text-small text-accent enabled:active:text-accent-pressed fine-pointer:enabled:hover:text-accent-hover max-[24rem]:w-11 max-[24rem]:px-0"
                  aria-haspopup="dialog"
                  aria-expanded={suggestionsOpen}
                  aria-controls={suggestionsId}
                  onClick={toggleSuggestions}
                >
                  <SparklesIcon />
                  <span className="max-[24rem]:sr-only">{t('suggestGameName')}</span>
                </Button>
                {suggestionsOpen && (
                  <div
                    className="game-name-suggestions absolute z-20 inset-[calc(100%_+_var(--mb-space-2))_0_auto_auto] w-[min(22rem,100%)] rounded-card border border-border bg-surface-elevated p-(--mb-space-2) text-primary shadow-lg"
                    id={suggestionsId}
                    role="dialog"
                    aria-label={t('suggestedGameNames')}
                  >
                    <div className="flex min-h-10 items-center gap-(--mb-space-2) px-(--mb-space-3) text-small font-semibold text-secondary [&_svg]:text-highlight">
                      <SparklesIcon />
                      <span>{t('suggestedGameNames')}</span>
                    </div>
                    <div className="grid" role="group">
                      {suggestions.map((suggestion) => (
                        <Button
                          className="game-name-suggestion grid! min-h-(--mb-control-height-md) grid-cols-[1.5rem_minmax(0,1fr)] justify-start gap-(--mb-space-2) rounded-[calc(var(--mb-radius-control)_-_3px)] border-0 bg-transparent px-(--mb-space-3) text-start text-small font-medium text-primary active:bg-accent-soft fine-pointer:hover:bg-surface-subtle"
                          key={suggestion.name}
                          onClick={() => {
                            setName(suggestion.name);
                            setSuggestionsOpen(false);
                            gameNameInputRef.current?.focus();
                          }}
                        >
                          <span aria-hidden="true">{suggestion.icon}</span>
                          <span>{suggestion.name}</span>
                        </Button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              {errors.name !== undefined && (
                <FieldError id={`${gameNameInputId}-error`}>{errors.name}</FieldError>
              )}
            </div>
            <Field label={t('currency')}>
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
            </Field>
          </FieldStack>
        </fieldset>
        <fieldset>
          <legend>{t('bankingRules')}</legend>
          <FieldStack>
            <Field label={t('paymentMode')} hint={t('paymentModeLocked')}>
              <select
                value={paymentMode}
                onChange={(event) => setPaymentMode(event.target.value as PaymentMode)}
              >
                <option value="FAST">{t('paymentModeFast')}</option>
                <option value="CONFIRMATION">{t('paymentModeConfirmation')}</option>
              </select>
            </Field>
            <Field
              label={t('optionalPassword')}
              hint={t('optionalPasswordHint')}
              error={errors.gameAccessPassword}
            >
              <input
                type="password"
                autoComplete="new-password"
                value={gameAccessPassword}
                onChange={(event) => setGameAccessPassword(event.target.value)}
                aria-invalid={errors.gameAccessPassword !== undefined}
              />
            </Field>
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
          </FieldStack>
        </fieldset>
        <PlayersFieldset column={1} legend={t('ownerPlayer')}>
          {players.slice(0, 1).map((player) => (
            <section key={player.key}>
              <Field label={t('playerName', { number: 1 })} error={errors[`player-${player.key}`]}>
                <input
                  value={player.name}
                  onChange={(event) => updatePlayer(player.key, { name: event.target.value })}
                  aria-invalid={errors[`player-${player.key}`] !== undefined}
                />
              </Field>
              <ColorPicker
                player={player}
                players={players}
                onChange={(color) => updatePlayer(player.key, { color })}
              />
            </section>
          ))}
        </PlayersFieldset>
        <PlayersFieldset
          column={2}
          legend={t('localPlayers')}
          intro={
            <>
              <div className={sectionTitleClass}>
                <FieldHint as="p">{t('localPlayersHint')}</FieldHint>
                <Button variant="secondary" onClick={addPlayer} disabled={players.length >= 6}>
                  {t('addPlayer')}
                </Button>
              </div>
              {errors.players !== undefined && <FieldError>{errors.players}</FieldError>}
            </>
          }
        >
          {players.slice(1).map((player, index) => (
            <section key={player.key}>
              <Field
                label={t('playerName', { number: index + 2 })}
                error={errors[`player-${player.key}`]}
              >
                <input
                  value={player.name}
                  onChange={(event) => updatePlayer(player.key, { name: event.target.value })}
                  aria-invalid={errors[`player-${player.key}`] !== undefined}
                />
              </Field>
              <ColorPicker
                player={player}
                players={players}
                onChange={(color) => updatePlayer(player.key, { color })}
              />
              <Button
                variant="quiet"
                className="justify-self-start"
                onClick={() =>
                  setPlayers(players.filter((candidate) => candidate.key !== player.key))
                }
              >
                {t('remove')}
              </Button>
            </section>
          ))}
        </PlayersFieldset>
        {submitError !== null && (
          <Notice tone="error" className="md:col-span-full">
            {apiErrorMessage(submitError, t, 'unableCreateGame')}
          </Notice>
        )}
        <Toolbar variant="form" className={actionsClass}>
          <Button variant="primary" type="submit" disabled={submitting}>
            {submitting ? t('startingLobby') : t('createLobby')}
          </Button>
        </Toolbar>
      </form>
    </PageShell>
  );
}

/** The vertical field rhythm inside the game-basics and banking-rules fieldsets. */
function FieldStack({ children }: { children: ReactNode }) {
  return <div className="grid gap-(--mb-space-4)">{children}</div>;
}

/*
 * Both player fieldsets span the form from `md`; from `lg` they sit in their own column. The owner
 * editor lays its name and colour side by side from `md` until the `lg` column narrows it again.
 */
const playersFieldsetClass = {
  1: { fieldset: 'md:col-span-full lg:col-[1]', list: ownerListClass },
  2: { fieldset: 'md:col-span-full lg:col-[2]', list: playerListClass },
};

/** A players fieldset: legend, optional intro row, then the list of player editors. */
function PlayersFieldset({
  column,
  legend,
  intro,
  children,
}: {
  column: 1 | 2;
  legend: string;
  intro?: ReactNode;
  children: ReactNode;
}) {
  const classes = playersFieldsetClass[column];
  return (
    <fieldset className={classes.fieldset}>
      <legend>{legend}</legend>
      {intro}
      <div className={classes.list}>{children}</div>
    </fieldset>
  );
}

function SparklesIcon() {
  return (
    <svg
      className="sparkles-icon size-[18px] shrink-0 fill-current"
      viewBox="0 0 20 20"
      aria-hidden="true"
    >
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
  return (
    <fieldset className={colorPickerClass}>
      <legend>{t('color')}</legend>
      <RadioGroup
        className="flex flex-wrap gap-(--mb-space-3)"
        aria-label={t('color')}
        value={player.color}
        onChange={onChange}
      >
        {colors.map((color) => {
          const taken = players.some(
            (candidate) => candidate.key !== player.key && candidate.color === color.value,
          );
          const selected = player.color === color.value;
          return (
            // `as={Fragment}` keeps the native `disabled` the `disabled:` utilities need.
            <Radio as={Fragment} key={color.value} value={color.value} disabled={taken}>
              <button
                className={cx(
                  colorOptionClass,
                  colorOptionStateClass[selected ? 'selected' : 'idle'],
                )}
                type="button"
                style={{ '--player-color': `var(${color.token})` } as CSSProperties}
                aria-label={t('selectColor', { color: t(color.nameKey) })}
                disabled={taken}
                onKeyDown={keepEnterInRadio}
              >
                <span aria-hidden="true">{selected ? '✓' : ''}</span>
              </button>
            </Radio>
          );
        })}
      </RadioGroup>
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
      <FieldHint>{t('displayedAs', { amount })}</FieldHint>
      {error !== undefined && <FieldError>{error}</FieldError>}
    </div>
  );
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
