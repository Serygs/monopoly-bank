import { describe, expect, it } from 'vitest';
import { translate } from '../i18n/translations';
import { boardNameMaxLength, boardSpaceNameMaxLength, hasBoardFormErrors, validateBoardForm } from './board-form';

const t = (key: Parameters<typeof translate>[1], values?: Parameters<typeof translate>[2]) => translate('uk', key, values);
const spaceIds = ['space-1', 'space-2'];

describe('custom board form validation', () => {
  it('accepts a complete form', () => {
    const errors = validateBoardForm(' Наше місто ', { 'space-1': 'Хрещатик', 'space-2': 'Поділ' }, spaceIds, t);
    expect(hasBoardFormErrors(errors)).toBe(false);
  });

  it('reports an empty or overlong board name in the table language before anything is sent', () => {
    expect(validateBoardForm('   ', { 'space-1': 'a', 'space-2': 'b' }, spaceIds, t).name).toBe('Введіть назву дошки.');
    expect(validateBoardForm('x'.repeat(boardNameMaxLength + 1), { 'space-1': 'a', 'space-2': 'b' }, spaceIds, t).name).toBe(`Не більше ${boardNameMaxLength} символів.`);
    expect(validateBoardForm('x'.repeat(boardNameMaxLength), { 'space-1': 'a', 'space-2': 'b' }, spaceIds, t).name).toBeUndefined();
  });

  it('reports every space whose name is missing or too long', () => {
    const errors = validateBoardForm('Board', { 'space-1': '', 'space-2': 'y'.repeat(boardSpaceNameMaxLength + 1) }, spaceIds, t);
    expect(errors.spaces).toEqual({ 'space-1': 'Введіть назву поля.', 'space-2': `Не більше ${boardSpaceNameMaxLength} символів.` });
    expect(hasBoardFormErrors(errors)).toBe(true);
  });

  it('treats a space with no entry at all as missing', () => {
    expect(validateBoardForm('Board', {}, spaceIds, t).spaces).toEqual({ 'space-1': 'Введіть назву поля.', 'space-2': 'Введіть назву поля.' });
  });
});
