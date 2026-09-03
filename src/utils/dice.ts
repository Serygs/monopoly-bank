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
