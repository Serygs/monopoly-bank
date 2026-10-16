import { isGameRuleEnabled } from '../../shared/domain/game-rules.js';
import type { BoardSnapshot } from '../../shared/board/types.js';
import type { Game, GameRuleKey } from '../../shared/types/monopoly.js';
import { BoardDisabledError, RuleDisabledError } from './errors.js';

/** Every service method behind an optional house rule calls this first, so the UI is never the only gate. */
export function assertRuleEnabled(game: Pick<Game, 'rules'>, rule: GameRuleKey): void {
  if (!isGameRuleEnabled(game, rule)) throw new RuleDisabledError(rule);
}

/** Tile requests need the board snapshot taken at creation; returns it. */
export function assertBoardEnabled(game: Pick<Game, 'settings'>): BoardSnapshot {
  const board = game.settings?.board;
  if (board == null) throw new BoardDisabledError();
  return board;
}
