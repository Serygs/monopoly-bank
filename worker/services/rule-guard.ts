import { isGameRuleEnabled } from '../../shared/domain/game-rules.js';
import type { Game, GameRuleKey } from '../../shared/types/monopoly.js';
import { RuleDisabledError } from './errors.js';

/** Every service method behind an optional house rule calls this first, so the UI is never the only gate. */
export function assertRuleEnabled(game: Pick<Game, 'rules'>, rule: GameRuleKey): void {
  if (!isGameRuleEnabled(game, rule)) throw new RuleDisabledError(rule);
}
