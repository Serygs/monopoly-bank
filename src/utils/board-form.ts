import type { Translate } from '../i18n/translations';

/** Mirrors `boardNameMaxLength` / `boardSpaceNameMaxLength` in worker/validation/api-validation.ts, so the form rejects what the Worker would. */
export const boardNameMaxLength = 40;
export const boardSpaceNameMaxLength = 32;

export interface BoardFormErrors {
  name?: string;
  spaces: Record<string, string>;
}

/** Client-side check of a custom board before it is sent: every name present and within the Worker's limits. */
export function validateBoardForm(name: string, spaceNames: Record<string, string>, spaceIds: readonly string[], t: Translate): BoardFormErrors {
  const errors: BoardFormErrors = { spaces: {} };
  const trimmedName = name.trim();
  if (trimmedName === '') errors.name = t('enterBoardName');
  else if (trimmedName.length > boardNameMaxLength) errors.name = t('nameTooLong', { max: boardNameMaxLength });
  for (const spaceId of spaceIds) {
    const value = (spaceNames[spaceId] ?? '').trim();
    if (value === '') errors.spaces[spaceId] = t('enterSpaceName');
    else if (value.length > boardSpaceNameMaxLength) errors.spaces[spaceId] = t('nameTooLong', { max: boardSpaceNameMaxLength });
  }
  return errors;
}

export function hasBoardFormErrors(errors: BoardFormErrors): boolean {
  return errors.name !== undefined || Object.keys(errors.spaces).length > 0;
}
