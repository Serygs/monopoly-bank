export interface DiceRoll {
  first: number;
  second: number;
  total: number;
  isDouble: boolean;
}

export function rollDie(random: () => number = Math.random): number {
  return Math.floor(random() * 6) + 1;
}

export function rollDice(random: () => number = Math.random): DiceRoll {
  const first = rollDie(random);
  const second = rollDie(random);
  return { first, second, total: first + second, isDouble: first === second };
}

export interface DoublesState {
  consecutiveDoubles: number;
  isInJail: boolean;
  thirdDouble: boolean;
}

export function applyDiceResult(currentDoubles: number, roll: DiceRoll): DoublesState {
  if (!roll.isDouble) return { consecutiveDoubles: 0, isInJail: false, thirdDouble: false };
  const next = currentDoubles + 1;
  if (next >= 3) return { consecutiveDoubles: 0, isInJail: true, thirdDouble: true };
  return { consecutiveDoubles: next, isInJail: false, thirdDouble: false };
}
