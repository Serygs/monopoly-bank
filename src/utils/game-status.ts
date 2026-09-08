import type { GameStatus } from '../../shared/types/monopoly.js';
import type { TranslationKey } from '../i18n/translations.js';

const gameStatusTranslationKeys = {
  LOBBY: 'gameStatusLobby',
  ACTIVE: 'gameStatusActive',
  FINISHED: 'gameStatusFinished',
} as const satisfies Record<GameStatus, TranslationKey>;

export function gameStatusTranslationKey(status: GameStatus): TranslationKey {
  return gameStatusTranslationKeys[status];
}
