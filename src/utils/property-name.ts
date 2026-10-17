import type { BoardSnapshot } from '../../shared/board';
import type { TranslationKey } from '../i18n/translations';

type Translate = (key: TranslationKey) => string;

export function tileDisplayName(
  board: BoardSnapshot | null | undefined,
  id: string,
  t: Translate,
): string {
  return board?.tiles.find((tile) => tile.id === id)?.name ?? t('propertyUnknown');
}

export function tileDisplayNames(
  board: BoardSnapshot | null | undefined,
  ids: readonly string[],
  t: Translate,
): string {
  return ids.map((id) => tileDisplayName(board, id, t)).join(', ');
}
