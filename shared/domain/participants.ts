import type { Transaction } from '../types/monopoly.js';

export type ParticipantSide = 'DEBIT' | 'CREDIT';

export function soleParticipant(
  participants: Transaction['participants'],
  side: ParticipantSide,
): string | null {
  const matching = participants.filter((participant) =>
    side === 'DEBIT' ? participant.balanceDelta < 0 : participant.balanceDelta > 0,
  );
  return matching.length === 1 ? (matching[0]?.playerId ?? null) : null;
}
