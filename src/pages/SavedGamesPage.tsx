import { useEffect, useMemo, useState } from 'react';
import type { GameSummary } from '../../shared/contracts/api';
import { monopolyBankApi } from '../api/monopoly-bank-api';
import { Dialog } from '../components/Dialog';
import { GameCard } from '../components/game/GameCard';
import { PageHeader } from '../components/PageHeader';
import {
  Button,
  DialogActions,
  DialogBody,
  EmptyState,
  Field,
  Notice,
  PageShell,
  SegmentedControl,
  StatPill,
  useFeedback,
} from '../components/ui';
import { apiErrorMessage } from '../i18n/api-errors';
import { useLanguage } from '../i18n/language-context';
import { cx } from '../components/ui/class-names';

/*
 * `page-header--hero` stays as the hook for `liquid-glass-effects.ts`; its pointer tilt and
 * highlight stay in `liquid-glass.css`. Classic Bank hides the `::after` glow.
 */
const heroClass = cx(
  'page-header--hero relative overflow-hidden rounded-xl border border-[color:color-mix(in_srgb,var(--mb-color-highlight)_45%,transparent)]',
  'text-on-inverse shadow-md [background:var(--mb-background-hero)]',
  'min-h-[clamp(230px,20vw,280px)] p-(--mb-space-6) pb-[clamp(var(--mb-space-6),5vw,var(--mb-space-9))]',
  'lg:p-[clamp(var(--mb-space-7),4vw,var(--mb-space-9))] lg:pb-[clamp(var(--mb-space-6),5vw,var(--mb-space-9))]',
  'after:pointer-events-none after:absolute after:inset-y-0 after:right-0 after:z-0 *:relative *:z-1',
  '[&_h1]:text-inherit [&_.lede]:text-inherit [&_.eyebrow]:text-[color:color-mix(in_srgb,var(--mb-color-highlight)_82%,white)]',
  'max-md:[&_h1]:text-[length:clamp(2.125rem,10vw,2.875rem)]',
  // Only the dark Classic hero needs the inverse ring; Liquid Glass light keeps the default.
  'classic:light:[&_button:focus-visible]:outline-text-on-inverse',
  // `!` outranks PageHeader's own `lg:` columns.
  'lg:grid-cols-[minmax(0,62%)_minmax(0,38%)]! lg:items-center',
  'max-md:[&_.page-header-actions]:grid-cols-1 max-md:[&_.page-header-actions_.button]:w-full max-md:[&_.button-primary]:-order-1',
  'lg:[&_.page-header-actions]:col-[1] lg:[&_.page-header-actions]:max-w-[28rem]',
  'classic:after:hidden classic:max-md:bg-[position:62%_center] classic:max-md:bg-[size:auto_100%]',
  'glass:isolate glass:border-[rgb(255_255_255/0.6)] glass:text-primary glass:shadow-lg',
  'glass:[&_.eyebrow]:text-[color:color-mix(in_srgb,var(--mb-color-accent-hover)_88%,var(--mb-color-text-primary))]',
  'glass:after:w-[42%] glass:after:opacity-82',
  'glass:after:[background:radial-gradient(circle_at_70%_34%,rgb(255_244_232/0.9),transparent_13%),radial-gradient(circle_at_45%_65%,rgb(201_220_244/0.92),transparent_22%),radial-gradient(circle_at_80%_72%,rgb(231_226_244/0.84),transparent_26%)]',
);
/* The search field and sort select share each style's control skin. */
const controlsClass = cx(
  'mb-(--mb-layout-section-gap-compact) grid gap-(--mb-space-3)',
  'md:grid-cols-[minmax(0,1fr)_auto] md:items-center lg:grid-cols-[minmax(18rem,1fr)_auto_auto]',
  'classic:[&_:is(input,select)]:border-border classic:[&_:is(input,select)]:bg-[#fffcf3] classic:[&_:is(input,select)]:shadow-[0_5px_16px_rgb(42_52_39/0.05)]',
  'classic:dark:[&_:is(input,select)]:bg-surface-elevated',
  'glass:[&_:is(input,select)]:border-[rgb(255_255_255/0.58)] glass:[&_:is(input,select)]:bg-[rgb(255_255_255/0.42)]',
  'glass:[&_:is(input,select)]:shadow-[inset_0_1px_0_rgb(255_255_255/0.62),0_8px_24px_rgb(40_60_90/0.07)]',
  'glass:[&_:is(input,select)]:backdrop-blur-[18px] glass:[&_:is(input,select)]:backdrop-saturate-[1.25]',
);
/* `saved-games-search` and its icon stay as e2e hooks. */
const searchClass = cx(
  'saved-games-search relative block md:col-span-full lg:col-auto',
  '[&_input]:block [&_input]:w-full [&_input]:ps-12',
);
const searchIconClass =
  'saved-games-search-icon pointer-events-none absolute top-1/2 left-4 z-1 block size-5 -translate-y-1/2 text-muted';
const sortClass =
  'flex items-center gap-(--mb-space-2) text-small font-semibold text-secondary md:justify-self-end [&_select]:min-h-(--mb-control-height-md)';
const gridClass = cx(
  'grid grid-cols-[1fr] gap-(--mb-layout-gap-compact)',
  'md:grid-cols-2 md:gap-(--mb-layout-gap-medium) lg:gap-(--mb-layout-gap-wide)',
);

interface Props {
  onCreateGame: () => void;
  onJoinGame: (joinCode?: string) => void;
  onOpenGame: (gameId: string) => void;
}

export function SavedGamesPage({ onCreateGame, onJoinGame, onOpenGame }: Props) {
  const { locale, t } = useLanguage();
  const [games, setGames] = useState<GameSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown | null>(null);
  const [gameToRemove, setGameToRemove] = useState<GameSummary | null>(null);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<unknown | null>(null);
  const notify = useFeedback();
  const [duplicating, setDuplicating] = useState<string | null>(null);
  const [gameToDuplicate, setGameToDuplicate] = useState<GameSummary | null>(null);
  const [duplicatePassword, setDuplicatePassword] = useState('');
  const [duplicateError, setDuplicateError] = useState<unknown | null>(null);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'LOBBY' | 'ACTIVE' | 'FINISHED'>('ALL');
  const [sortOrder, setSortOrder] = useState<'updated' | 'name'>('updated');

  const visibleGames = useMemo(
    () =>
      games
        .filter((summary) => statusFilter === 'ALL' || summary.game.status === statusFilter)
        .filter((summary) =>
          summary.game.name
            .toLocaleLowerCase(locale)
            .includes(query.trim().toLocaleLowerCase(locale)),
        )
        .sort((first, second) =>
          sortOrder === 'name'
            ? first.game.name.localeCompare(second.game.name, locale)
            : second.game.updatedAt.localeCompare(first.game.updatedAt),
        ),
    [games, locale, query, sortOrder, statusFilter],
  );

  const loadGames = () => {
    setLoading(true);
    setError(null);
    void monopolyBankApi
      .listGames()
      .then(setGames, setError)
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    let active = true;
    void monopolyBankApi
      .listGames()
      .then(
        (result) => {
          if (active) setGames(result);
        },
        (caught: unknown) => {
          if (active) setError(caught);
        },
      )
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const requestRemoval = (game: GameSummary) => {
    setGameToRemove(game);
    setRemoveError(null);
  };

  const removeGame = async () => {
    if (gameToRemove === null) return;
    setRemoving(true);
    setRemoveError(null);
    try {
      const removed = await monopolyBankApi.deleteGame(gameToRemove.game.id);
      setGames((current) => current.filter(({ game }) => game.id !== removed.gameId));
      notify({ tone: 'success', message: t('gameRemoved', { name: gameToRemove.game.name }) });
      setGameToRemove(null);
    } catch (caught) {
      setRemoveError(caught);
    } finally {
      setRemoving(false);
    }
  };

  const requestDuplicate = (game: GameSummary) => {
    setGameToDuplicate(game);
    setDuplicatePassword('');
    setDuplicateError(null);
  };

  const duplicateGame = async () => {
    if (gameToDuplicate === null) return;
    if (duplicatePassword.length < 4) {
      setDuplicateError(new Error(t('gamePasswordMinLength')));
      return;
    }
    setDuplicating(gameToDuplicate.game.id);
    setDuplicateError(null);
    try {
      const result = await monopolyBankApi.duplicateGame(
        gameToDuplicate.game.id,
        duplicatePassword,
      );
      setGameToDuplicate(null);
      onOpenGame(result.game.id);
    } catch (caught) {
      setDuplicateError(caught);
    } finally {
      setDuplicating(null);
    }
  };

  return (
    <PageShell>
      <PageHeader
        className={heroClass}
        eyebrow={t('appName')}
        title={t('savedGames')}
        description={t('savedGamesLede')}
        actions={
          <>
            <Button variant="primary" onClick={onCreateGame}>
              {t('createNewGame')}
            </Button>
            <Button variant="secondary" onClick={() => onJoinGame()}>
              {t('joinGame')}
            </Button>
          </>
        }
      />

      {loading && (
        <StatPill variant="status" live>
          {t('loadingSavedGames')}
        </StatPill>
      )}
      {error !== null && (
        <Notice tone="error" as="section">
          <p>{apiErrorMessage(error, t, 'unableLoadSavedGames')}</p>
          <Button variant="secondary" onClick={loadGames}>
            {t('tryAgain')}
          </Button>
        </Notice>
      )}
      {!loading && error === null && games.length === 0 && (
        <EmptyState
          title={t('noSavedGames')}
          description={t('noSavedGamesDescription')}
          action={
            <Button variant="primary" onClick={onCreateGame}>
              {t('createNewGame')}
            </Button>
          }
        />
      )}
      {!loading && error === null && games.length > 0 && (
        <>
          <section className={controlsClass} aria-label={t('savedGamesControls')}>
            <label className={searchClass}>
              <span className="sr-only">{t('searchGames')}</span>
              <svg
                className={searchIconClass}
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                aria-hidden="true"
              >
                <circle cx="10.75" cy="10.75" r="5.75" />
                <path d="m15 15 4 4" />
              </svg>
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t('searchGames')}
              />
            </label>
            <SegmentedControl
              variant="filter"
              className="flex flex-wrap gap-(--mb-space-2)"
              label={t('filterGames')}
              options={(['ALL', 'ACTIVE', 'LOBBY', 'FINISHED'] as const).map((status) => ({
                value: status,
                label: t(
                  status === 'ALL'
                    ? 'allGames'
                    : (`gameStatus${status[0]}${status.slice(1).toLowerCase()}` as 'gameStatusLobby'),
                ),
              }))}
              value={statusFilter}
              onChange={setStatusFilter}
            />
            <label className={sortClass}>
              <span>{t('sortGames')}</span>
              <select
                value={sortOrder}
                onChange={(event) => setSortOrder(event.target.value as 'updated' | 'name')}
              >
                <option value="updated">{t('sortUpdated')}</option>
                <option value="name">{t('sortName')}</option>
              </select>
            </label>
          </section>
          {visibleGames.length === 0 ? (
            <StatPill variant="status">{t('noMatchingGames')}</StatPill>
          ) : (
            <section className={gridClass} aria-label={t('savedGames')}>
              {visibleGames.map((summary) => (
                <GameCard
                  key={summary.game.id}
                  summary={summary}
                  duplicating={duplicating === summary.game.id}
                  onJoinGame={onJoinGame}
                  onOpenGame={onOpenGame}
                  onDuplicate={() => requestDuplicate(summary)}
                  onRemove={() => requestRemoval(summary)}
                />
              ))}
            </section>
          )}
        </>
      )}

      {gameToRemove !== null && (
        <RemoveGameDialog
          game={gameToRemove}
          error={removeError}
          removing={removing}
          onCancel={() => setGameToRemove(null)}
          onConfirm={() => void removeGame()}
        />
      )}
      {gameToDuplicate !== null && (
        <DuplicateGameDialog
          password={duplicatePassword}
          error={duplicateError}
          duplicating={duplicating === gameToDuplicate.game.id}
          onPasswordChange={setDuplicatePassword}
          onCancel={() => setGameToDuplicate(null)}
          onConfirm={() => void duplicateGame()}
        />
      )}
    </PageShell>
  );
}

function RemoveGameDialog({
  game,
  error,
  removing,
  onCancel,
  onConfirm,
}: {
  game: GameSummary;
  error: unknown | null;
  removing: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { t } = useLanguage();
  const title = t('removeGameTitle', { name: game.game.name });
  return (
    <Dialog
      title={title}
      eyebrow={t('closeTable')}
      closeLabel={t('closeDialog', { title })}
      closeDisabled={removing}
      onClose={onCancel}
    >
      <p>{t('removeGameWarning', { count: game.playerCount })}</p>
      {error !== null && (
        <Notice tone="error">{apiErrorMessage(error, t, 'unableRemoveGame')}</Notice>
      )}
      <DialogActions>
        <Button variant="secondary" disabled={removing} onClick={onCancel}>
          {t('cancel')}
        </Button>
        <Button variant="danger" disabled={removing} onClick={onConfirm}>
          {removing ? t('removing') : t('removeGame')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function DuplicateGameDialog({
  password,
  error,
  duplicating,
  onPasswordChange,
  onCancel,
  onConfirm,
}: {
  password: string;
  error: unknown | null;
  duplicating: boolean;
  onPasswordChange: (password: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { t } = useLanguage();
  const title = t('duplicateGame');
  const passwordId = 'duplicate-game-password';
  return (
    <Dialog
      title={title}
      closeLabel={t('closeDialog', { title })}
      closeDisabled={duplicating}
      onClose={onCancel}
    >
      <DialogBody>{t('duplicateGameDescription')}</DialogBody>
      <Field
        variant="dialog"
        wrapLabel
        label={t('copyGamePassword')}
        hint={t('copyGamePasswordHint')}
        hintElement="small"
      >
        <input
          id={passwordId}
          type="password"
          autoComplete="new-password"
          minLength={4}
          value={password}
          onChange={(event) => onPasswordChange(event.target.value)}
        />
      </Field>
      {error !== null && (
        <Notice tone="error">
          {error instanceof Error && error.message === t('gamePasswordMinLength')
            ? error.message
            : apiErrorMessage(error, t, 'unableDuplicateGame')}
        </Notice>
      )}
      <DialogActions>
        <Button variant="secondary" disabled={duplicating} onClick={onCancel}>
          {t('cancel')}
        </Button>
        <Button variant="primary" disabled={duplicating} onClick={onConfirm}>
          {duplicating ? t('duplicating') : t('duplicateGame')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
