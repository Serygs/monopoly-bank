import type { DiceRoll } from '../../shared/domain/jail.js';

/**
 * Rolling is client-side randomness and stays here. The three-doubles rule that
 * reads the roll is a table rule, so it lives in `shared/domain/jail.ts`; it is
 * re-exported below under its original name so there is one copy of the rule and
 * every existing caller keeps its import.
 */
export { applyDiceRoll as applyDiceResult } from '../../shared/domain/jail.js';
export type { DiceRoll, DoublesState } from '../../shared/domain/jail.js';

export function rollDie(random: () => number = Math.random): number {
  return Math.floor(random() * 6) + 1;
}

export function rollDice(random: () => number = Math.random): DiceRoll {
  const first = rollDie(random);
  const second = rollDie(random);
  return { first, second, total: first + second, isDouble: first === second };
}
