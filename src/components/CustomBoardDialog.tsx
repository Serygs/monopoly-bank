import { useEffect, useState } from 'react';
import type { BoardDetails } from '../../shared/contracts/api';
import { monopolyBankApi } from '../api/monopoly-bank-api';
import { apiErrorMessage } from '../i18n/api-errors';
import { useLanguage } from '../i18n/language-context';
import type { Translate } from '../i18n/translations';
import { boardNameMaxLength, boardSpaceNameMaxLength, hasBoardFormErrors, validateBoardForm, type BoardFormErrors } from '../utils/board-form';
import { boardSpaceName } from '../utils/board-space-name';
import { groupSpaces } from '../utils/property-view';
import { Dialog } from './Dialog';
import { GroupBadge } from './SpacePicker';

interface CustomBoardDialogProps {
  /** The board to copy; prices, groups and rents come from it verbatim, only names change. */
  sourceBoardId: string;
  onClose: () => void;
  onCreated: (board: BoardDetails) => void;
}

/** Name the board, rename its 28 deeds (prefilled with the classic names), save. */
export function CustomBoardDialog({ sourceBoardId, onClose, onCreated }: CustomBoardDialogProps) {
  const { t } = useLanguage();
  const [source, setSource] = useState<BoardDetails | null>(null);
  const [loadError, setLoadError] = useState<unknown | null>(null);
  const [name, setName] = useState('');
  const [names, setNames] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<BoardFormErrors>({ spaces: {} });
  const [saving, setSaving] = useState(false);
  const [submitError, setSubmitError] = useState<unknown | null>(null);

  useEffect(() => {
    let active = true;
    void monopolyBankApi.getBoard(sourceBoardId).then(
      (board) => { if (!active) return; setSource(board); setNames(classicNames(board, t)); },
      (caught: unknown) => { if (active) setLoadError(caught); },
    );
    return () => { active = false; };
    // The prefill is a one-off; renaming afterwards must not be undone by a language switch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceBoardId]);

  const changeName = (spaceId: string, value: string) => { setNames((current) => ({ ...current, [spaceId]: value })); setErrors((current) => ({ ...current, spaces: Object.fromEntries(Object.entries(current.spaces).filter(([id]) => id !== spaceId)) })); };
  const reset = () => { if (source !== null) { setNames(classicNames(source, t)); setErrors({ spaces: {} }); } };
  const submit = async () => {
    if (source === null || saving) return;
    const nextErrors = validateBoardForm(name, names, source.spaces.map((space) => space.id), t);
    setErrors(nextErrors);
    setSubmitError(null);
    if (hasBoardFormErrors(nextErrors)) return;
    setSaving(true);
    try {
      onCreated(await monopolyBankApi.createBoard({ name: name.trim(), sourceBoardId, spaceNames: Object.fromEntries(source.spaces.map((space) => [space.id, names[space.id].trim()])) }));
    } catch (caught) {
      setSubmitError(caught);
    } finally {
      setSaving(false);
    }
  };

  const title = t('customBoardTitle');
  return <Dialog title={title} closeLabel={t('closeDialog', { title })} onClose={onClose} className="custom-board-dialog" closeDisabled={saving}>
    <p className="dialog-intro">{t('customBoardDescription')}</p>
    {loadError !== null && <p className="notice notice-error" role="alert">{apiErrorMessage(loadError, t, 'unableLoadBoards')}</p>}
    {source === null && loadError === null && <p className="status" role="status">{t('loadingBoards')}</p>}
    {source !== null && <>
      <label className="dialog-field">{t('boardName')}<input value={name} maxLength={boardNameMaxLength + 1} placeholder={t('boardNamePlaceholder')} aria-invalid={errors.name !== undefined} onChange={(event) => { setName(event.target.value); setErrors((current) => ({ ...current, name: undefined })); }} />{errors.name !== undefined && <span className="field-error">{errors.name}</span>}</label>
      <div className="section-title"><h3>{t('spaceNames')}</h3><button className="button button-quiet" type="button" onClick={reset}>{t('resetToClassicNames')}</button></div>
      <div className="custom-board-groups">
        {groupSpaces(source.spaces).map(({ group, spaces }) => <section className="custom-board-group" key={group}><GroupBadge group={group} />{spaces.map((space) => <label className="dialog-field" key={space.id}><span className="field-note">{t('spaceNameField', { index: space.boardIndex, name: boardSpaceName(space, t) })}</span><input value={names[space.id] ?? ''} maxLength={boardSpaceNameMaxLength + 1} aria-invalid={errors.spaces[space.id] !== undefined} onChange={(event) => changeName(space.id, event.target.value)} />{errors.spaces[space.id] !== undefined && <span className="field-error">{errors.spaces[space.id]}</span>}</label>)}</section>)}
      </div>
      {submitError !== null && <p className="notice notice-error" role="alert">{apiErrorMessage(submitError, t, 'unableCreateBoard')}</p>}
      <div className="dialog-actions"><button className="button button-secondary" type="button" disabled={saving} onClick={onClose}>{t('cancel')}</button><button className="button button-primary" type="button" disabled={saving} onClick={() => void submit()}>{saving ? t('savingBoard') : t('saveBoard')}</button></div>
    </>}
  </Dialog>;
}

function classicNames(board: BoardDetails, t: Translate): Record<string, string> {
  return Object.fromEntries(board.spaces.map((space) => [space.id, boardSpaceName(space, t)]));
}
