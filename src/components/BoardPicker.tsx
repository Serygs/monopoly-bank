import type { BoardSummary } from '../../shared/contracts/api';
import { apiErrorMessage } from '../i18n/api-errors';
import { useLanguage } from '../i18n/language-context';

interface BoardPickerProps {
  boards: BoardSummary[];
  loading: boolean;
  error: unknown | null;
  /** `null` is “no board”, the default and the behaviour every game had before boards existed. */
  value: string | null;
  onChange: (boardId: string | null) => void;
  onCreateCustom: () => void;
}

/** No board · the canonical boards · the creator's own copies · a button to make a new copy. */
export function BoardPicker({ boards, loading, error, value, onChange, onCreateCustom }: BoardPickerProps) {
  const { t } = useLanguage();
  const canonical = boards.filter((entry) => entry.isCanonical);
  const own = boards.filter((entry) => !entry.isCanonical);
  const option = (id: string | null, title: string, hint: string) => <button key={id ?? 'none'} className={`board-option${value === id ? ' selected' : ''}`} type="button" role="radio" aria-checked={value === id} onClick={() => onChange(id)}><strong>{title}</strong><small>{hint}</small></button>;
  return <div className="board-picker" data-testid="board-picker">
    <p className="field-hint">{t('boardPickerHint')}</p>
    <div className="board-options" role="radiogroup" aria-label={t('boardSection')}>
      {option(null, t('boardNone'), t('boardNoneHint'))}
      {canonical.map((entry) => option(entry.board.id, t('boardClassic'), t('boardClassicHint')))}
    </div>
    {loading && <p className="status" role="status">{t('loadingBoards')}</p>}
    {error !== null && <p className="notice notice-error" role="alert">{apiErrorMessage(error, t, 'unableLoadBoards')}</p>}
    {own.length > 0 && <div className="board-own"><p className="board-own-title">{t('myBoards')}</p><div className="board-options" role="radiogroup" aria-label={t('myBoards')}>{own.map((entry) => option(entry.board.id, entry.board.name, t('customBoardHint')))}</div></div>}
    <button className="button button-secondary" type="button" disabled={loading || canonical.length === 0} onClick={onCreateCustom}>{t('createCustomBoard')}</button>
  </div>;
}
