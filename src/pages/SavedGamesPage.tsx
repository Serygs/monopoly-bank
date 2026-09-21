import { useEffect, useState } from 'react';
import type { GameSummary } from '../../shared/contracts/api';
import { monopolyBankApi } from '../api/monopoly-bank-api';
import { Dialog } from '../components/Dialog';
import { PageHeader } from '../components/PageHeader';
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

  const loadGames = () => {
    setLoading(true);
    setError(null);
    void monopolyBankApi.listGames().then(setGames, setError).finally(() => setLoading(false));
  };

  useEffect(() => {
    let active = true;
    void monopolyBankApi.listGames()
      .then((result) => { if (active) setGames(result); }, (caught: unknown) => { if (active) setError(caught); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
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
      const result = await monopolyBankApi.duplicateGame(gameToDuplicate.game.id, duplicatePassword);
      setGameToDuplicate(null);
      onOpenGame(result.game.id);
    } catch (caught) {
      setDuplicateError(caught);
    } finally {
      setDuplicating(null);
    }
  };

  return <main className="page saved-games-page">
    <PageHeader className="page-header--hero" eyebrow={t('appName')} title={t('savedGames')} description={t('savedGamesLede')} actions={<>
        <button className="button button-secondary" type="button" onClick={() => onJoinGame()}>{t('joinGame')}</button>
        <button className="button button-primary" type="button" onClick={onCreateGame}>{t('createNewGame')}</button>
      </>} />

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
          {summary.isPublicLobby && summary.joinCode !== undefined
            ? <button className="button button-secondary" type="button" onClick={() => onJoinGame(summary.joinCode)}>{t('joinOpenLobby')}</button>
            : <button className="button button-secondary" type="button" onClick={() => onOpenGame(summary.game.id)}>{t('openGame')}</button>}
          <button className="button button-quiet" type="button" disabled={duplicating === summary.game.id} onClick={() => requestDuplicate(summary)}>{duplicating === summary.game.id ? t('duplicating') : t('duplicate')}</button>
          <button className="button button-danger-quiet" type="button" aria-label={t('removeGameAria', { name: summary.game.name })} onClick={() => requestRemoval(summary)}>{t('removeGame')}</button>
        </div>
      </article>)}
    </section>}

    {gameToRemove !== null && <RemoveGameDialog game={gameToRemove} error={removeError} removing={removing} onCancel={() => setGameToRemove(null)} onConfirm={() => void removeGame()} />}
    {gameToDuplicate !== null && <DuplicateGameDialog password={duplicatePassword} error={duplicateError} duplicating={duplicating === gameToDuplicate.game.id} onPasswordChange={setDuplicatePassword} onCancel={() => setGameToDuplicate(null)} onConfirm={() => void duplicateGame()} />}
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
  const title = t('removeGameTitle', { name: game.game.name });
  return <Dialog title={title} eyebrow={t('closeTable')} closeLabel={t('closeDialog', { title })} closeDisabled={removing} onClose={onCancel} className="remove-game-dialog">
    <p>{t('removeGameWarning', { count: game.playerCount })}</p>
    {error !== null && <p className="notice notice-error" role="alert">{apiErrorMessage(error, t, 'unableRemoveGame')}</p>}
    <div className="dialog-actions">
      <button className="button button-secondary" type="button" disabled={removing} onClick={onCancel}>{t('cancel')}</button>
      <button className="button button-danger" type="button" disabled={removing} onClick={onConfirm}>{removing ? t('removing') : t('removeGame')}</button>
    </div>
  </Dialog>;
}

function DuplicateGameDialog({ password, error, duplicating, onPasswordChange, onCancel, onConfirm }: {
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
  return <Dialog title={title} closeLabel={t('closeDialog', { title })} closeDisabled={duplicating} onClose={onCancel}>
    <p className="dialog-intro">{t('duplicateGameDescription')}</p>
    <label className="dialog-field" htmlFor={passwordId}>
      <span>{t('copyGamePassword')}</span>
      <input id={passwordId} type="password" autoComplete="new-password" minLength={4} value={password} onChange={(event) => onPasswordChange(event.target.value)} />
      <small>{t('copyGamePasswordHint')}</small>
    </label>
    {error !== null && <p className="notice notice-error" role="alert">{error instanceof Error && error.message === t('gamePasswordMinLength') ? error.message : apiErrorMessage(error, t, 'unableDuplicateGame')}</p>}
    <div className="dialog-actions">
      <button className="button button-secondary" type="button" disabled={duplicating} onClick={onCancel}>{t('cancel')}</button>
      <button className="button button-primary" type="button" disabled={duplicating} onClick={onConfirm}>{duplicating ? t('duplicating') : t('duplicateGame')}</button>
    </div>
  </Dialog>;
}

function formatDate(value: string, locale: string): string {
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : new Intl.DateTimeFormat(locale, { dateStyle: 'medium' }).format(date);
}
