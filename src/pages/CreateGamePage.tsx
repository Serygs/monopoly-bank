import { Radio, RadioGroup } from '@headlessui/react';
import {
  Fragment,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type FormEvent,
  type ReactNode,
} from 'react';
import { monopolyBankApi } from '../api/monopoly-bank-api';
import type { BoardMode } from '../../shared/board';
import { apiErrorMessage } from '../i18n/api-errors';
import { useLanguage } from '../i18n/language-context';
import { AmountInput } from '../components/AmountInput';
import { useAmountInput } from '../components/amount-input-state';
import {
  Button,
  AnchoredPopover,
  Field,
  FieldError,
  FieldHint,
  FormSection,
  Lede,
  Notice,
  PageShell,
  SegmentedControl,
  StepperBar,
  Toggle,
} from '../components/ui';
import { cx } from '../components/ui/class-names';
import { keepEnterInRadio } from '../components/ui/radio-keys';
import type { Translate, TranslationKey } from '../i18n/translations';
import { buildRulesValues, ruleSummaries } from '../content/game-rules';
import { formatMoney } from '../utils/money';
import {
  clearDraft,
  defaultPassGoReward,
  defaultStartingBalance,
  isDraftDirty,
  readDraft,
  writeDraft,
  type CreateGameDraft,
} from './create-game-draft';
import { getGameNameSuggestions, randomSuggestionStart } from '../utils/game-name-suggestions';
import {
  selectableCurrencies,
  type Currency,
  type GameRuleKey,
  type GameRules,
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
/** The optional rules offered with a new game, in the order they are listed. */
const houseRuleOptions: { key: GameRuleKey; label: TranslationKey }[] = [
  { key: 'doubleRewardOnExactGo', label: 'ruleDoubleGo' },
  { key: 'playerLoans', label: 'rulePlayerLoans' },
  { key: 'bankLoans', label: 'ruleBankLoans' },
  { key: 'freeParkingJackpot', label: 'ruleFreeParkingJackpot' },
  { key: 'auctions', label: 'ruleAuctions' },
];
type PlayerForm = CreateGameDraft['players'][number];
const stepCount = 3;
interface Props {
  profile: UserProfile;
  /** The header's X; the shell decides whether leaving needs a confirmation. */
  onClose: () => void;
  /** Tells the shell whether the draft holds input, so it can guard leaving the screen. */
  onDirtyChange?: (dirty: boolean) => void;
  onCreated: (gameId: string) => void;
}

export function CreateGamePage({ profile, onClose, onDirtyChange, onCreated }: Props) {
  const { language, t } = useLanguage();
  const [initial] = useState(() => readDraft(profile.id, profile.nickname));
  const nextKey = useRef(Math.max(2, ...initial.players.map((player) => player.key + 1)));
  const gameNameInputRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const suggestionsRootRef = useRef<HTMLDivElement>(null);
  const gameNameInputId = useId();
  const suggestionsId = useId();
  const [step, setStep] = useState(initial.step);
  const [name, setName] = useState(initial.name);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);
  const [suggestionStart, setSuggestionStart] = useState(0);
  const [startingBalance, setStartingBalance] = useState(initial.startingBalance);
  const [passGoReward, setPassGoReward] = useState(initial.passGoReward);
  const [currency, setCurrency] = useState<SelectableCurrency>(initial.currency);
  const [paymentMode, setPaymentMode] = useState<PaymentMode>(initial.paymentMode);
  const [rules, setRules] = useState<GameRules>(initial.rules);
  const [board, setBoard] = useState<BoardMode>(initial.board);
  const [gameAccessPassword, setGameAccessPassword] = useState('');
  const [isPublic, setIsPublic] = useState(initial.isPublic);
  const [players, setPlayers] = useState<PlayerForm[]>(initial.players);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<unknown | null>(null);
  const suggestions = getGameNameSuggestions(language, suggestionStart);
  const closeSuggestions = useCallback(() => {
    setSuggestionsOpen(false);
    gameNameInputRef.current?.focus();
  }, []);
  const summaries = ruleSummaries(
    language,
    buildRulesValues(
      Number(startingBalance) > 0 ? Number(startingBalance) : defaultStartingBalance,
      Number(passGoReward) > 0 ? Number(passGoReward) : defaultPassGoReward,
      currency,
    ),
  );

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
  const draft: CreateGameDraft = {
    userId: profile.id,
    step,
    name,
    currency,
    paymentMode,
    isPublic,
    startingBalance,
    passGoReward,
    rules,
    board,
    players,
  };
  /* The password is not part of the draft, but it still counts as input worth confirming. */
  const dirty = isDraftDirty(draft, gameAccessPassword, profile.nickname);
  useEffect(() => {
    writeDraft(draft);
    // `draft` is rebuilt every render from the fields below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    step,
    name,
    currency,
    paymentMode,
    isPublic,
    startingBalance,
    passGoReward,
    rules,
    board,
    players,
  ]);
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);
  useEffect(() => () => onDirtyChange?.(false), [onDirtyChange]);
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [step]);
  const goTo = (target: number) => {
    setSubmitError(null);
    setStep(target);
  };
  /** Validates one step; the first failing step is where a final submit sends the user back. */
  const errorsForStep = (target: number) => {
    const found = validateStep(target, { name, startingBalance, passGoReward, players }, t);
    if (target === 0 && !isPublic && gameAccessPassword !== '' && gameAccessPassword.length < 4)
      found.gameAccessPassword = t('gamePasswordMinLength');
    return found;
  };
  const next = () => {
    const found = errorsForStep(step);
    setErrors(found);
    if (Object.keys(found).length === 0) goTo(Math.min(step + 1, stepCount - 1));
  };
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (step < stepCount - 1) {
      next();
      return;
    }
    for (let target = 0; target < stepCount; target += 1) {
      const found = errorsForStep(target);
      if (Object.keys(found).length > 0) {
        setErrors(found);
        goTo(target);
        return;
      }
    }
    setErrors({});
    setSubmitError(null);
    setSubmitting(true);
    try {
      const details = await monopolyBankApi.createGame({
        name: name.trim(),
        startingBalance: Number(startingBalance),
        passGoReward: Number(passGoReward),
        currency,
        paymentMode,
        rules,
        ...(board === 'none' ? {} : { board }),
        ...(isPublic ? { isPublic } : {}),
        ...(isPublic || gameAccessPassword === '' ? {} : { gameAccessPassword }),
        players: players.map((player) => ({ name: player.name.trim(), color: player.color })),
      });
      clearDraft();
      onCreated(details.game.id);
    } catch (caught) {
      setSubmitError(caught);
    } finally {
      setSubmitting(false);
    }
  };
  const stepTitles = [t('stepBasics'), t('houseRules'), t('stepPlayers')];
  const stepSubtitles = [t('lobbyLede'), t('houseRulesHint'), t('localPlayersHint')];
  return (
    <PageShell>
      <header className="mb-(--mb-layout-section-gap-compact) flex items-start justify-between gap-(--mb-space-4)">
        <div className="min-w-0 pt-(--mb-space-1)">
          <h1 className="m-0 font-display text-display leading-tight font-bold tracking-display text-primary wrap-anywhere">
            {stepTitles[step]}
          </h1>
          <Lede as="p">{stepSubtitles[step]}</Lede>
        </div>
        <Button
          variant="quiet"
          className="icon-button min-h-11 min-w-11 shrink-0 justify-center rounded-pill p-0"
          aria-label={t('closeCreateLobby')}
          onClick={onClose}
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            aria-hidden="true"
          >
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </Button>
      </header>
      <form ref={formRef} className={formClass} onSubmit={(event) => void submit(event)} noValidate>
        {step === 0 && (
          <>
            <FormSection legend={t('gameBasics')} className="[&>legend]:sr-only">
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
                      <AnchoredPopover
                        anchorRef={suggestionsRootRef}
                        id={suggestionsId}
                        label={t('suggestedGameNames')}
                        onClose={closeSuggestions}
                        className="game-name-suggestions"
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
                                closeSuggestions();
                              }}
                            >
                              <span aria-hidden="true">{suggestion.icon}</span>
                              <span>{suggestion.name}</span>
                            </Button>
                          ))}
                        </div>
                      </AnchoredPopover>
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
            </FormSection>
            <FormSection legend={t('boardSection')}>
              <SegmentedControl
                label={t('boardPlayChoice')}
                value={board}
                onChange={setBoard}
                options={[
                  { value: 'none', label: t('boardNone') },
                  { value: 'monopoly-ru-2012', label: t('boardMonopolyRu2012') },
                ]}
              />
              <FieldHint as="p">{t('boardHint')}</FieldHint>
            </FormSection>
            <FormSection legend={t('bankingRules')}>
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
                  label={t('lobbyAccess')}
                  hint={isPublic ? t('lobbyAccessPublicHint') : undefined}
                >
                  <select
                    value={isPublic ? 'public' : 'private'}
                    onChange={(event) => setIsPublic(event.target.value === 'public')}
                  >
                    <option value="private">{t('lobbyAccessPrivate')}</option>
                    <option value="public">{t('lobbyAccessPublic')}</option>
                  </select>
                </Field>
                {!isPublic && (
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
                )}
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
            </FormSection>
          </>
        )}
        {step === 1 && (
          <FormSection legend={t('houseRules')} className="md:col-span-full [&>legend]:sr-only">
            <FieldStack>
              <div>
                {houseRuleOptions.map(({ key, label }) => (
                  <Toggle
                    key={key}
                    variant="row"
                    label={t(label)}
                    description={summaries[key]}
                    checked={rules[key]}
                    onChange={(checked) => setRules((current) => ({ ...current, [key]: checked }))}
                  />
                ))}
              </div>
            </FieldStack>
          </FormSection>
        )}
        {step === 2 && (
          <>
            <PlayersFieldset column={1} legend={t('ownerPlayer')}>
              {players.slice(0, 1).map((player) => (
                <section key={player.key}>
                  <Field
                    label={t('playerName', { number: 1 })}
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
                </section>
              ))}
            </PlayersFieldset>
            <PlayersFieldset
              column={2}
              legend={t('localPlayers')}
              intro={
                <>
                  <div className={sectionTitleClass}>
                    <Button variant="secondary" onClick={addPlayer} disabled={players.length >= 6}>
                      {t('addPlayer')}
                    </Button>
                  </div>
                  {errors.players !== undefined && <FieldError>{errors.players}</FieldError>}
                </>
              }
            >
              {players.slice(1).map((player, index) => (
                <section
                  key={player.key}
                  className="grid gap-(--mb-space-3) rounded-surface border border-border bg-surface-subtle p-(--mb-space-4)"
                >
                  <div className="flex items-end gap-(--mb-space-2)">
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
                    <Button
                      variant="quiet"
                      className="icon-button min-h-11 min-w-11 shrink-0 justify-center rounded-pill p-0"
                      aria-label={t('removePlayer', {
                        name: player.name.trim() || t('playerName', { number: index + 2 }),
                      })}
                      onClick={() =>
                        setPlayers(players.filter((candidate) => candidate.key !== player.key))
                      }
                    >
                      <svg
                        width="20"
                        height="20"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        aria-hidden="true"
                      >
                        <path d="M4 7h16M10 11v6M14 11v6M6 7l1 12h10l1-12M9 7V4h6v3" />
                      </svg>
                    </Button>
                  </div>
                  <ColorPicker
                    player={player}
                    players={players}
                    onChange={(color) => updatePlayer(player.key, { color })}
                  />
                </section>
              ))}
            </PlayersFieldset>
            {submitError !== null && (
              <Notice tone="error" className="md:col-span-full">
                {apiErrorMessage(submitError, t, 'unableCreateGame')}
              </Notice>
            )}
            <FormSection legend={t('reviewLobby')} className="md:col-span-full">
              <dl className="m-0 grid grid-cols-[auto_minmax(0,1fr)] gap-x-(--mb-space-4) gap-y-(--mb-space-2) [&_dd]:m-0 [&_dd]:text-end [&_dd]:font-semibold [&_dt]:text-secondary">
                <dt>{t('gameName')}</dt>
                <dd>{name.trim()}</dd>
                <dt>{t('startingBalance')}</dt>
                <dd>{formatMoney(Number(startingBalance), currency)}</dd>
                <dt>{t('passGoReward')}</dt>
                <dd>{formatMoney(Number(passGoReward), currency)}</dd>
                <dt>{t('boardSection')}</dt>
                <dd>{board === 'none' ? t('boardNone') : t('boardMonopolyRu2012')}</dd>
                <dt>{t('houseRules')}</dt>
                <dd>
                  {houseRuleOptions
                    .filter(({ key }) => rules[key])
                    .map(({ label }) => t(label))
                    .join(', ') || t('noneEnabled')}
                </dd>
                <dt>{t('stepPlayers')}</dt>
                <dd>{players.length}</dd>
              </dl>
            </FormSection>
          </>
        )}
      </form>
      <StepperBar
        label={t('createLobbySteps')}
        step={step}
        total={stepCount}
        indicator={t('stepIndicator', { current: step + 1, total: stepCount })}
        backLabel={t('back')}
        nextLabel={
          step < stepCount - 1 ? t('stepNext') : submitting ? t('startingLobby') : t('createLobby')
        }
        busy={submitting}
        onBack={() => goTo(Math.max(step - 1, 0))}
        onNext={() => (step < stepCount - 1 ? next() : formRef.current?.requestSubmit())}
      />
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
    <FormSection legend={legend} className={classes.fieldset}>
      {intro}
      <div className={classes.list}>{children}</div>
    </FormSection>
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
function validateStep(
  step: number,
  values: { name: string; startingBalance: string; passGoReward: string; players: PlayerForm[] },
  t: Translate,
): Record<string, string> {
  const errors: Record<string, string> = {};
  if (step === 0) {
    if (values.name.trim().length === 0) errors.name = t('enterGameName');
    if (!isPositive(values.startingBalance)) errors.startingBalance = t('enterPositiveInteger');
    if (!isPositive(values.passGoReward)) errors.passGoReward = t('enterPositiveInteger');
  }
  if (step === 2) {
    if (values.players.length < 1 || values.players.length > 6)
      errors.players = t('invalidLobbyPlayerCount');
    for (const player of values.players)
      if (player.name.trim().length === 0) errors[`player-${player.key}`] = t('enterPlayerName');
  }
  return errors;
}
