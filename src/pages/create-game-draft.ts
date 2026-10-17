import { isBoardMode, type BoardMode } from '../../shared/board';
import {
  defaultGameRules,
  selectableCurrencies,
  type GameRules,
  type PaymentMode,
  type SelectableCurrency,
} from '../../shared/types/monopoly';

export const DRAFT_STORAGE_KEY = 'mb.createGameDraft.v1';
export const defaultStartingBalance = 15_000_000;
export const defaultPassGoReward = 2_000_000;
export const firstPlayerColor = '#d83f55';

export interface DraftPlayer {
  key: number;
  name: string;
  color: string;
}

/** The new-lobby form. The access password is never part of it, so it is never stored. */
export interface CreateGameDraft {
  userId: string;
  step: number;
  name: string;
  currency: SelectableCurrency;
  paymentMode: PaymentMode;
  isPublic: boolean;
  startingBalance: string;
  passGoReward: string;
  rules: GameRules;
  board: BoardMode;
  players: DraftPlayer[];
}

export function defaultDraft(userId: string, nickname: string): CreateGameDraft {
  return {
    userId,
    step: 0,
    name: '',
    currency: 'USD',
    paymentMode: 'FAST',
    isPublic: false,
    startingBalance: String(defaultStartingBalance),
    passGoReward: String(defaultPassGoReward),
    rules: defaultGameRules,
    board: 'none',
    players: [{ key: 1, name: nickname, color: firstPlayerColor }],
  };
}

function isDraft(value: unknown, userId: string): value is CreateGameDraft {
  if (typeof value !== 'object' || value === null) return false;
  const draft = value as Partial<CreateGameDraft>;
  return (
    draft.userId === userId &&
    typeof draft.step === 'number' &&
    typeof draft.name === 'string' &&
    typeof draft.startingBalance === 'string' &&
    typeof draft.passGoReward === 'string' &&
    typeof draft.isPublic === 'boolean' &&
    (draft.paymentMode === 'FAST' || draft.paymentMode === 'CONFIRMATION') &&
    selectableCurrencies.includes(draft.currency as SelectableCurrency) &&
    typeof draft.rules === 'object' &&
    draft.rules !== null &&
    Array.isArray(draft.players) &&
    draft.players.length >= 1 &&
    draft.players.length <= 6 &&
    draft.players.every(
      (player) =>
        typeof player?.key === 'number' &&
        typeof player.name === 'string' &&
        typeof player.color === 'string',
    )
  );
}

/** The saved draft of this user, or the defaults when there is none or it is unreadable. */
export function readDraft(userId: string, nickname: string): CreateGameDraft {
  const fallback = defaultDraft(userId, nickname);
  try {
    const stored: unknown = JSON.parse(sessionStorage.getItem(DRAFT_STORAGE_KEY) ?? 'null');
    if (!isDraft(stored, userId)) return fallback;
    return {
      ...stored,
      step: Math.min(Math.max(Math.trunc(stored.step), 0), 2),
      rules: { ...defaultGameRules, ...stored.rules },
      board: isBoardMode(stored.board) ? stored.board : 'none',
    };
  } catch {
    return fallback;
  }
}

export function writeDraft(draft: CreateGameDraft): void {
  try {
    sessionStorage.setItem(DRAFT_STORAGE_KEY, JSON.stringify(draft));
  } catch {
    // Private mode or a full quota: the form still works, it just cannot survive a reload.
  }
}

export function clearDraft(): void {
  try {
    sessionStorage.removeItem(DRAFT_STORAGE_KEY);
  } catch {
    // Nothing to clear when storage is unavailable.
  }
}

/** Whether anything differs from a fresh form, so leaving needs a confirmation. */
export function isDraftDirty(draft: CreateGameDraft, password: string, nickname: string): boolean {
  const fresh = defaultDraft(draft.userId, nickname);
  const fields = (value: CreateGameDraft) => JSON.stringify({ ...value, step: 0 });
  return password !== '' || fields(draft) !== fields(fresh);
}
