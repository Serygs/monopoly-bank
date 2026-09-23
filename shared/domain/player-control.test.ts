import { describe, expect, it } from 'vitest';

import { controlledPlayerIdForBankingCommand, rentBankingCommand } from './player-control.js';
import type { PropertyRentRequest } from '../contracts/api.js';

describe('controlledPlayerIdForBankingCommand', () => {
  it.each([
    [{ type: 'PLAYER_TO_PLAYER', sourcePlayerId: 'source', destinationPlayerId: 'destination', amount: 10 }, 'source'],
    [{ type: 'PLAYER_TO_BANK', playerId: 'player', amount: 10 }, 'player'],
    [{ type: 'BANK_TO_PLAYER', playerId: 'player', amount: 10 }, 'player'],
    [{ type: 'PLAYER_TO_ALL', payerPlayerId: 'payer', amountPerPlayer: 10 }, 'payer'],
    [{ type: 'ALL_TO_PLAYER', recipientPlayerId: 'recipient', amountPerPlayer: 10 }, 'recipient'],
    [{ type: 'PASS_GO', playerId: 'player' }, 'player'],
    [{ playerId: 'bankrupt-player' }, 'bankrupt-player'],
  ] as const)('requires the actor to control %o', (request, expectedPlayerId) => {
    expect(controlledPlayerIdForBankingCommand(request)).toBe(expectedPlayerId);
  });

  it.each([
    [{ boardSpaceId: 'space-01', playerId: 'buyer' }, 'buyer'],
    [{ boardSpaceId: 'space-01', payerPlayerId: 'payer' }, 'payer'],
    [{ boardSpaceId: 'space-01', payerPlayerId: 'payer', ownerPlayerId: 'owner' }, 'owner'],
    [{ boardSpaceId: 'space-01', playerId: 'builder', count: 2 }, 'builder'],
    [{ boardSpaceId: 'space-01', playerId: 'seller', count: 1 }, 'seller'],
    [{ boardSpaceId: 'space-01', playerId: 'mortgagor' }, 'mortgagor'],
    [{ boardSpaceId: 'space-01', winnerPlayerId: 'bidder', price: 250 }, 'bidder'],
    [{ proposerPlayerId: 'proposer', responderPlayerId: 'responder' }, 'proposer'],
    [{ playerId: 'jailed' }, 'jailed'],
  ] as const)('requires the actor to control the wallet behind %o', (request, expectedPlayerId) => {
    expect(controlledPlayerIdForBankingCommand(request)).toBe(expectedPlayerId);
  });
});

describe('rentBankingCommand', () => {
  // A body a hostile client could post: it names a player the attacker controls
  // as the owner of a space that player does not own, hoping to authorize a
  // debit on the payer's wallet with the attacker's own controller.
  const forgedBody = (chargedByOwner: boolean): PropertyRentRequest =>
    JSON.parse(
      JSON.stringify({ boardSpaceId: 'space-01', payerPlayerId: 'victim', chargedByOwner, ownerPlayerId: 'attacker' }),
    ) as PropertyRentRequest;

  it('authorizes against the owner resolved from the deed, never the one the request names', () => {
    const command = rentBankingCommand(forgedBody(true), 'real-owner');

    expect(command.ownerPlayerId).toBe('real-owner');
    expect(controlledPlayerIdForBankingCommand(command)).toBe('real-owner');
  });

  it('leaves the payer as the authorizing wallet when the owner is not the one charging', () => {
    const command = rentBankingCommand(forgedBody(false), 'real-owner');

    expect(command.ownerPlayerId).toBeUndefined();
    expect(controlledPlayerIdForBankingCommand(command)).toBe('victim');
  });
});
