import { useEffect, useId, useRef, useState } from 'react';
import type { GameSummary } from '../../shared/contracts/api';
import { monopolyBankApi } from '../api/monopoly-bank-api';
import { apiErrorMessage } from '../i18n/api-errors';
import { useLanguage } from '../i18n/language-context';

interface Props {
  onCreateGame: () => void;
  onOpenGame: (gameId: string) => void;
}

export function SavedGamesPage({ onCreateGame, onOpenGame }: Props) {
  const { locale, t } = useLanguage();
  const [games, setGames] = useState<GameSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown | null>(null);
  const [gameToRemove, setGameToRemove] = useState<GameSummary | null>(null);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState<unknown | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [duplicating, setDuplicating] = useState<string | null>(null);

  const loadGames = () => {
    setLoading(true);
    setError(null);
    void monopolyBankApi.listGames()
      .then(setGames, setError)
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    let active = true;
    void monopolyBankApi.listGames()
      .then((result) => {
        if (active) setGames(result);
      }, (caught: unknown) => {
        if (active) setError(caught);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => { active = false; };
  }, []);

  const requestRemoval = (game: GameSummary) => {
    setGameToRemove(game);
    setRemoveError(null);
  };

  const removeGame = async () => {
    if (gameToRemove === null) {
      return;
    }

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
  const duplicateGame = async (game: GameSummary) => {
    setDuplicating(game.game.id);
    try { onOpenGame((await monopolyBankApi.duplicateGame(game.game.id)).game.id); } finally { setDuplicating(null); }
  };

  return <main className="page saved-games-page">
    <section className="page-heading hero-heading">
      <div>
        <p className="eyebrow">{t('appName')}</p>
        <h1>{t('savedGames')}</h1>
        <p className="lede">{t('savedGamesLede')}</p>
      </div>
      <button className="button button-primary" type="button" onClick={onCreateGame}>{t('createNewGame')}</button>
    </section>

    {notice !== null && <section className="notice notice-success" role="status">
      <p>{t('gameRemoved', { name: notice })}</p>
      <button className="button button-quiet" type="button" onClick={() => setNotice(null)}>{t('dismiss')}</button>
    </section>}
    {loading && <p className="status" role="status">{t('loadingSavedGames')}</p>}
    {error !== null && <section className="notice notice-error" role="alert">
      <p>{apiErrorMessage(error, t, 'unableLoadSavedGames')}</p>
      <button className="button button-secondary" type="button" onClick={loadGames}>{t('tryAgain')}</button>
    </section>}
    {!loading && error === null && games.length === 0 && <section className="empty-state banknote-panel">
      <span className="empty-state-token" aria-hidden="true">MB</span>
      <h2>{t('noSavedGames')}</h2>
      <p>{t('noSavedGamesDescription')}</p>
      <button className="button button-primary" type="button" onClick={onCreateGame}>{t('createNewGame')}</button>
    </section>}
    {!loading && error === null && games.length > 0 && <section className="game-grid" aria-label={t('savedGames')}>
      {games.map((summary) => <article className="game-card" key={summary.game.id}>
        <div className="game-card-copy">
          <span className="game-card-seal" aria-hidden="true">MB</span>
          <div>
            <h2>{summary.game.name}</h2>
            <p>{t('playersCount', { count: summary.playerCount })}</p>
            <p className="muted">{t('updated', { date: formatDate(summary.game.updatedAt, locale) })}</p>
          </div>
        </div>
        <div className="game-card-actions">
          <button className="button button-secondary" type="button" onClick={() => onOpenGame(summary.game.id)}>{t('openGame')}</button>
          <button className="button button-quiet" type="button" disabled={duplicating === summary.game.id} onClick={() => void duplicateGame(summary)}>{duplicating === summary.game.id ? 'Copying…' : 'Duplicate'}</button>
          <button className="button button-danger-quiet" type="button" aria-label={t('removeGameAria', { name: summary.game.name })} onClick={() => requestRemoval(summary)}>{t('removeGame')}</button>
        </div>
      </article>)}
    </section>}

    {gameToRemove !== null && <RemoveGameDialog
      game={gameToRemove}
      error={removeError}
      removing={removing}
      onCancel={() => setGameToRemove(null)}
      onConfirm={() => void removeGame()}
    />}
  </main>;
}

function RemoveGameDialog({ game, error, removing, onCancel, onConfirm }: {
  game: GameSummary;
  error: unknown | null;
  removing: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { t } = useLanguage();
  const titleId = useId();
  const dialog = useRef<HTMLElement>(null);

  useEffect(() => {
    dialog.current?.focus();
  }, []);

  return <div className="dialog-backdrop" role="presentation" onMouseDown={() => { if (!removing) onCancel(); }}>
    <section
      ref={dialog}
      className="dialog remove-game-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      tabIndex={-1}
      onKeyDown={(event) => { if (event.key === 'Escape' && !removing) onCancel(); }}
      onMouseDown={(event) => event.stopPropagation()}
    >
      <header>
        <div>
          <p className="eyebrow">{t('closeTable')}</p>
          <h2 id={titleId}>{t('removeGameTitle', { name: game.game.name })}</h2>
        </div>
      </header>
      <p>{t('removeGameWarning', { count: game.playerCount })}</p>
      {error !== null && <p className="notice notice-error" role="alert">{apiErrorMessage(error, t, 'unableRemoveGame')}</p>}
      <div className="dialog-actions">
        <button className="button button-secondary" type="button" disabled={removing} onClick={onCancel}>{t('cancel')}</button>
        <button className="button button-danger" type="button" disabled={removing} onClick={onConfirm}>{removing ? t('removing') : t('removeGame')}</button>
      </div>
    </section>
  </div>;
}

function formatDate(value: string, locale: string): string {
  const date = new Date(value);
  return Number.isNaN(date.valueOf())
    ? value
    : new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(date);
}
