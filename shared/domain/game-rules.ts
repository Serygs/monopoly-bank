import {
  defaultGameRules,
  gameRuleKeys,
  type Game,
  type GameRuleKey,
  type GameRules,
  type GameSettings,
} from '../types/monopoly.js';
import { buildBoardSnapshot, getBoardPreset, type BoardMode } from '../board/index.js';

/** Games per unit: one unit is the starting balance divided by this many. */
const UNITS_PER_STARTING_BALANCE = 150;
/** Keeps every derived amount, including the 2.5-unit bid step, a whole number. */
const MINIMUM_UNIT = 10;
const ROUND_MANTISSAS = [1, 2, 5] as const;

/**
 * The money unit for a starting balance: `startingBalance / 150` rounded to the nearest value of
 * the 1-2-5 series (10, 20, 50, 100, ...), never below 10. 15M gives 100K, 1.5M gives 10K.
 */
export function deriveMoneyUnit(startingBalance: number): number {
  if (!Number.isSafeInteger(startingBalance) || startingBalance <= 0)
    throw new RangeError('The starting balance must be a positive safe integer.');
  const raw = startingBalance / UNITS_PER_STARTING_BALANCE;
  let best = MINIMUM_UNIT;
  for (let power = 1; power <= 12; power += 1) {
    for (const mantissa of ROUND_MANTISSAS) {
      const candidate = mantissa * 10 ** power;
      if (candidate >= MINIMUM_UNIT && Math.abs(candidate - raw) < Math.abs(best - raw))
        best = candidate;
    }
  }
  return best;
}

/** Every amount is a whole multiple of the unit; the half step uses `unit * 5 / 2`, which is whole. */
export function buildGameSettings(
  startingBalance: number,
  board: BoardMode = 'none',
): GameSettings {
  const unit = deriveMoneyUnit(startingBalance);
  const snapshot = board === 'none' ? null : buildBoardSnapshot(getBoardPreset(board), unit);
  return {
    unit,
    incomeTax: snapshot?.incomeTax ?? unit * 20,
    luxuryTax: snapshot?.luxuryTax ?? unit * 10,
    jailFine: unit * 5,
    bankLoanMax: unit * 20,
    auctionMinBid: unit,
    auctionBidSteps: [unit, (unit * 5) / 2, unit * 5, unit * 10],
    ...(snapshot ? { board: snapshot } : {}),
  };
}

export function isGameRuleEnabled(game: Pick<Game, 'rules'>, rule: GameRuleKey): boolean {
  return game.rules[rule];
}

/** Fills in missing rules as off; unknown keys are ignored. */
export function normalizeGameRules(value: Partial<Record<string, unknown>> | null): GameRules {
  const rules = { ...defaultGameRules };
  if (value === null) return rules;
  for (const key of gameRuleKeys) rules[key] = value[key] === true;
  return rules;
}
