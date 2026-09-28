import { useEffect, useMemo, useState } from 'react';
import type { GameSummary } from '../../shared/contracts/api';
import { monopolyBankApi } from '../api/monopoly-bank-api';
import { Dialog } from '../components/Dialog';
import { OverflowMenu } from '../components/OverflowMenu';
import { PageHeader } from '../components/PageHeader';
import {
  Button,
  Card,
  DialogActions,
  DialogBody,
  EmptyState,
  Field,
  Notice,
  PageShell,
  SegmentedControl,
  StatPill,
  Toolbar,
} from '../components/ui';
import { apiErrorMessage } from '../i18n/api-errors';
import { useLanguage } from '../i18n/language-context';

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
  const [notice, setNotice] = useState<string | null>(null);
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
      setNotice(gameToRemove.game.name);
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
    <PageShell className="saved-games-page">
      <PageHeader
        className="page-header--hero"
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

      {notice !== null && (
        <Notice tone="success" as="section">
          <p>{t('gameRemoved', { name: notice })}</p>
          <Button variant="quiet" onClick={() => setNotice(null)}>
            {t('dismiss')}
          </Button>
        </Notice>
      )}
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
          <section className="saved-games-controls" aria-label={t('savedGamesControls')}>
            <label className="saved-games-search">
              <span className="sr-only">{t('searchGames')}</span>
              <svg
                className="saved-games-search-icon"
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
              className="saved-games-filters"
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
            <label className="saved-games-sort">
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
            <section className="game-grid" aria-label={t('savedGames')}>
              {visibleGames.map((summary) => (
                <Card as="article" variant="game" key={summary.game.id}>
                  <div className="game-card-copy">
                    <span className="game-card-seal" aria-hidden="true">
                      MB
                    </span>
                    <div className="game-card-details">
                      <span
                        className={`game-card-status game-card-status--${summary.game.status.toLowerCase()}`}
                      >
                        {t(
                          `gameStatus${summary.game.status[0]}${summary.game.status.slice(1).toLowerCase()}` as 'gameStatusLobby',
                        )}
                      </span>
                      <h2 title={summary.game.name}>{summary.game.name}</h2>
                      <div className="game-card-meta">
                        <span>{t('playersCount', { count: summary.playerCount })}</span>
                        <span>
                          {t('updated', { date: formatDate(summary.game.updatedAt, locale) })}
                        </span>
                      </div>
                    </div>
                  </div>
                  <Toolbar variant="game-card">
                    {summary.isPublicLobby && summary.joinCode !== undefined ? (
                      <Button
                        variant="primary"
                        className="game-card-primary-action"
                        onClick={() => onJoinGame(summary.joinCode)}
                      >
                        {t('joinOpenLobby')}
                      </Button>
                    ) : (
                      <Button
                        variant="primary"
                        className="game-card-primary-action"
                        onClick={() => onOpenGame(summary.game.id)}
                      >
                        {t('openGame')}
                      </Button>
                    )}
                    <OverflowMenu
                      label={t('gameActions', { name: summary.game.name })}
                      items={[
                        {
                          label:
                            duplicating === summary.game.id ? t('duplicating') : t('duplicate'),
                          disabled: duplicating === summary.game.id,
                          onSelect: () => requestDuplicate(summary),
                        },
                        {
                          label: t('removeGame'),
                          tone: 'danger',
                          onSelect: () => requestRemoval(summary),
                        },
                      ]}
                    />
                  </Toolbar>
                </Card>
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
      className="remove-game-dialog"
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

function formatDate(value: string, locale: string): string {
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? value
    : new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(date);
}
