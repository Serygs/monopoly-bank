import { describe, expect, it } from 'vitest';
import {
  ApiValidationError,
  parseCreateGameRequest,
  parseCreateTransactionRequest,
  parseJoinGameRequest,
  parsePlaceBidRequest,
  parseStartAuctionRequest,
  parseRegisterRequest,
  parseUpdateProfileRequest,
} from './api-validation.js';

describe('profile avatar validation', () => {
  it('accepts a compact JPEG data URL for an uploaded avatar', async () => {
    const avatar = 'data:image/jpeg;base64,SGVsbG8=';
    await expect(
      parseUpdateProfileRequest(jsonRequest({ nickname: 'Player', avatar })),
    ).resolves.toEqual({ nickname: 'Player', avatar });
  });

  it('rejects unsafe or unsupported data URLs', async () => {
    await expect(
      parseUpdateProfileRequest(
        jsonRequest({ nickname: 'Player', avatar: 'data:image/svg+xml;base64,PHN2Zy8+' }),
      ),
    ).rejects.toBeInstanceOf(ApiValidationError);
  });
});

describe('lobby request validation', () => {
  it('accepts a public lobby with its account owner as the only initial player', async () => {
    await expect(
      parseCreateGameRequest(
        jsonRequest({
          name: 'Friday table',
          startingBalance: 1500,
          passGoReward: 200,
          currency: 'USD',
          players: [{ name: 'Owner', color: '#e05263' }],
        }),
      ),
    ).resolves.toEqual({
      name: 'Friday table',
      startingBalance: 1500,
      passGoReward: 200,
      currency: 'USD',
      players: [{ name: 'Owner', color: '#e05263' }],
    });
  });

  it('rejects the legacy K currency and unknown currencies for new games', async () => {
    const request = {
      name: 'Friday table',
      startingBalance: 1500,
      passGoReward: 200,
      players: [{ name: 'Owner', color: '#e05263' }],
    };
    await expect(
      parseCreateGameRequest(jsonRequest({ ...request, currency: 'K' })),
    ).rejects.toBeInstanceOf(ApiValidationError);
    await expect(
      parseCreateGameRequest(jsonRequest({ ...request, currency: 'GBP' })),
    ).rejects.toBeInstanceOf(ApiValidationError);
    await expect(
      parseCreateGameRequest(jsonRequest({ ...request, currency: 'UAH' })),
    ).resolves.toMatchObject({ currency: 'UAH' });
  });

  it('normalizes a four-character join code and rejects a shorter or malformed one', async () => {
    await expect(parseJoinGameRequest(jsonRequest({ joinCode: '  k7p2 ' }))).resolves.toEqual({
      joinCode: 'K7P2',
    });
    for (const joinCode of ['K7P', 'K7 P2', 'K7-P2', ''])
      await expect(parseJoinGameRequest(jsonRequest({ joinCode }))).rejects.toBeInstanceOf(
        ApiValidationError,
      );
  });

  it('accepts a public lobby without a password and rejects one with a password', async () => {
    const request = {
      name: 'Friday table',
      startingBalance: 1500,
      passGoReward: 200,
      currency: 'USD',
      players: [{ name: 'Owner', color: '#e05263' }],
    };
    await expect(
      parseCreateGameRequest(jsonRequest({ ...request, isPublic: true })),
    ).resolves.toMatchObject({ isPublic: true });
    await expect(
      parseCreateGameRequest(
        jsonRequest({ ...request, isPublic: true, gameAccessPassword: 'abcd' }),
      ),
    ).rejects.toBeInstanceOf(ApiValidationError);
    await expect(
      parseCreateGameRequest(jsonRequest({ ...request, isPublic: 'yes' })),
    ).rejects.toBeInstanceOf(ApiValidationError);
  });

  it('accepts joining a public lobby without a password', async () => {
    await expect(parseJoinGameRequest(jsonRequest({ joinCode: 'TABLE42' }))).resolves.toEqual({
      joinCode: 'TABLE42',
    });
  });

  it('accepts a four-character game password and rejects a shorter one', async () => {
    const request = {
      name: 'Friday table',
      startingBalance: 1500,
      passGoReward: 200,
      currency: 'USD',
      players: [{ name: 'Owner', color: '#e05263' }],
    };
    await expect(
      parseCreateGameRequest(jsonRequest({ ...request, gameAccessPassword: '1234' })),
    ).resolves.toMatchObject({ gameAccessPassword: '1234' });
    await expect(
      parseCreateGameRequest(jsonRequest({ ...request, gameAccessPassword: '123' })),
    ).rejects.toBeInstanceOf(ApiValidationError);
  });

  it('accepts six-character account passwords and invitation tokens', async () => {
    await expect(
      parseRegisterRequest(jsonRequest({ nickname: 'Player', avatar: '🎩', password: '123456' })),
    ).resolves.toMatchObject({ nickname: 'Player', password: '123456' });
    await expect(
      parseJoinGameRequest(jsonRequest({ invitationToken: 'A'.repeat(43) })),
    ).resolves.toEqual({ invitationToken: 'A'.repeat(43) });
  });
});

function jsonRequest(body: object): Request {
  return new Request('https://example.test/api/profile', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('game rules validation', () => {
  const lobby = {
    name: 'Friday table',
    startingBalance: 1500,
    passGoReward: 200,
    currency: 'USD',
    players: [{ name: 'Owner', color: '#e05263' }],
  };

  it('leaves rules out when the client sends none, so every rule is off', async () => {
    await expect(parseCreateGameRequest(jsonRequest(lobby))).resolves.not.toHaveProperty('rules');
  });

  it('fills missing rules as off and keeps the chosen ones', async () => {
    const parsed = await parseCreateGameRequest(
      jsonRequest({ ...lobby, rules: { playerLoans: true, auctions: true } }),
    );
    expect(parsed.rules).toEqual({
      doubleRewardOnExactGo: false,
      playerLoans: true,
      bankLoans: false,
      freeParkingJackpot: false,
      auctions: true,
    });
  });

  it.each([
    ['an unknown rule', { houseRule: true }],
    ['a non-boolean flag', { playerLoans: 'yes' }],
    ['a numeric flag', { auctions: 1 }],
  ])('rejects %s', async (_name, rules) => {
    await expect(parseCreateGameRequest(jsonRequest({ ...lobby, rules }))).rejects.toBeInstanceOf(
      ApiValidationError,
    );
  });

  it.each([null, [], 'all', 3])('rejects rules that are not an object: %j', async (rules) => {
    await expect(parseCreateGameRequest(jsonRequest({ ...lobby, rules }))).rejects.toBeInstanceOf(
      ApiValidationError,
    );
  });
});

describe('board validation', () => {
  const lobby = {
    name: 'Friday table',
    startingBalance: 1500,
    passGoReward: 200,
    currency: 'USD',
    players: [{ name: 'Owner', color: '#e05263' }],
  };

  it('leaves board out when the client sends none', async () => {
    await expect(parseCreateGameRequest(jsonRequest(lobby))).resolves.not.toHaveProperty('board');
  });

  it.each(['none', 'monopoly-ru-2012'])('accepts board %s', async (board) => {
    await expect(parseCreateGameRequest(jsonRequest({ ...lobby, board }))).resolves.toMatchObject({
      board,
    });
  });

  it.each(['custom', 'classic', '', null, 3, true])('rejects board %j', async (board) => {
    await expect(parseCreateGameRequest(jsonRequest({ ...lobby, board }))).rejects.toBeInstanceOf(
      ApiValidationError,
    );
  });
});

describe('Pass GO validation', () => {
  const playerId = '11111111-1111-4111-8111-111111111111';

  it('accepts the exact-landing flag and drops it when false', async () => {
    await expect(
      parseCreateTransactionRequest(jsonRequest({ type: 'PASS_GO', playerId, exactLanding: true })),
    ).resolves.toEqual({ type: 'PASS_GO', playerId, exactLanding: true });
    await expect(
      parseCreateTransactionRequest(
        jsonRequest({ type: 'PASS_GO', playerId, exactLanding: false }),
      ),
    ).resolves.toEqual({ type: 'PASS_GO', playerId });
  });

  it('rejects a flag that is not a boolean', async () => {
    await expect(
      parseCreateTransactionRequest(
        jsonRequest({ type: 'PASS_GO', playerId, exactLanding: 'true' }),
      ),
    ).rejects.toBeInstanceOf(ApiValidationError);
  });
});

describe('reversal validation', () => {
  const transactionId = '33333333-3333-4333-8333-333333333333';

  it('accepts a reversal of a transaction with an optional comment', async () => {
    await expect(
      parseCreateTransactionRequest(
        jsonRequest({ type: 'REVERSAL', transactionId, comment: ' Wrong player ' }),
      ),
    ).resolves.toEqual({ type: 'REVERSAL', transactionId, comment: 'Wrong player' });
    await expect(
      parseCreateTransactionRequest(jsonRequest({ type: 'REVERSAL', transactionId })),
    ).resolves.toEqual({ type: 'REVERSAL', transactionId });
  });

  it('rejects a missing or malformed transaction id', async () => {
    await expect(
      parseCreateTransactionRequest(jsonRequest({ type: 'REVERSAL' })),
    ).rejects.toBeInstanceOf(ApiValidationError);
    await expect(
      parseCreateTransactionRequest(jsonRequest({ type: 'REVERSAL', transactionId: 'nope' })),
    ).rejects.toBeInstanceOf(ApiValidationError);
  });
});

describe('mortgage validation', () => {
  const playerId = '11111111-1111-4111-8111-111111111111';
  const mortgageId = '33333333-3333-4333-8333-333333333333';

  it('accepts a mortgage and stores the tidied property name', async () => {
    await expect(
      parseCreateTransactionRequest(
        jsonRequest({ type: 'MORTGAGE', playerId, propertyName: '  Park   Place ', amount: 350 }),
      ),
    ).resolves.toEqual({ type: 'MORTGAGE', playerId, propertyName: 'Park Place', amount: 350 });
  });

  it.each([
    ['a missing name', { amount: 10 }],
    ['an empty name', { propertyName: '   ', amount: 10 }],
    ['a too long name', { propertyName: 'x'.repeat(61), amount: 10 }],
    ['a name that is not text', { propertyName: 5, amount: 10 }],
    ['a control character', { propertyName: 'Bad', amount: 10 }],
    ['a missing amount', { propertyName: 'Boardwalk' }],
    ['a zero amount', { propertyName: 'Boardwalk', amount: 0 }],
    ['a fractional amount', { propertyName: 'Boardwalk', amount: 1.5 }],
  ])('rejects a mortgage with %s', async (_label, fields) => {
    await expect(
      parseCreateTransactionRequest(jsonRequest({ type: 'MORTGAGE', playerId, ...fields })),
    ).rejects.toBeInstanceOf(ApiValidationError);
  });

  it('accepts a redemption by mortgage id and rejects a malformed one', async () => {
    await expect(
      parseCreateTransactionRequest(
        jsonRequest({ type: 'MORTGAGE_REDEMPTION', playerId, mortgageId }),
      ),
    ).resolves.toEqual({ type: 'MORTGAGE_REDEMPTION', playerId, mortgageId });
    for (const bad of [undefined, 'nope'])
      await expect(
        parseCreateTransactionRequest(
          jsonRequest({ type: 'MORTGAGE_REDEMPTION', playerId, mortgageId: bad }),
        ),
      ).rejects.toBeInstanceOf(ApiValidationError);
  });
});

describe('loan validation', () => {
  const borrowerPlayerId = '11111111-1111-4111-8111-111111111111';
  const lenderPlayerId = '22222222-2222-4222-8222-222222222222';
  const loanId = '44444444-4444-4444-8444-444444444444';

  it('accepts a loan request and a repayment', async () => {
    await expect(
      parseCreateTransactionRequest(
        jsonRequest({ type: 'LOAN_ISSUE', borrowerPlayerId, lenderPlayerId, amount: 200 }),
      ),
    ).resolves.toEqual({ type: 'LOAN_ISSUE', borrowerPlayerId, lenderPlayerId, amount: 200 });
    await expect(
      parseCreateTransactionRequest(
        jsonRequest({ type: 'LOAN_REPAYMENT', playerId: borrowerPlayerId, loanId, amount: 50 }),
      ),
    ).resolves.toEqual({ type: 'LOAN_REPAYMENT', playerId: borrowerPlayerId, loanId, amount: 50 });
  });

  it.each([
    ['a missing lender', { borrowerPlayerId, amount: 10 }],
    ['a malformed borrower', { borrowerPlayerId: 'nope', lenderPlayerId, amount: 10 }],
    ['a zero amount', { borrowerPlayerId, lenderPlayerId, amount: 0 }],
    ['a fractional amount', { borrowerPlayerId, lenderPlayerId, amount: 1.5 }],
    ['an unsafe amount', { borrowerPlayerId, lenderPlayerId, amount: 2 ** 60 }],
  ])('rejects a loan request with %s', async (_label, fields) => {
    await expect(
      parseCreateTransactionRequest(jsonRequest({ type: 'LOAN_ISSUE', ...fields })),
    ).rejects.toBeInstanceOf(ApiValidationError);
  });

  it.each([
    ['a missing loan id', { playerId: borrowerPlayerId, amount: 10 }],
    ['a malformed loan id', { playerId: borrowerPlayerId, loanId: 'x', amount: 10 }],
    ['a missing player', { loanId, amount: 10 }],
    ['a negative amount', { playerId: borrowerPlayerId, loanId, amount: -5 }],
    ['a missing amount', { playerId: borrowerPlayerId, loanId }],
  ])('rejects a repayment with %s', async (_label, fields) => {
    await expect(
      parseCreateTransactionRequest(jsonRequest({ type: 'LOAN_REPAYMENT', ...fields })),
    ).rejects.toBeInstanceOf(ApiValidationError);
  });
});

describe('bank loan validation', () => {
  const playerId = '11111111-1111-4111-8111-111111111111';
  const lenderPlayerId = '22222222-2222-4222-8222-222222222222';
  const loanId = '44444444-4444-4444-8444-444444444444';

  it('accepts a bank loan request, with or without the cooldown acknowledgement', async () => {
    await expect(
      parseCreateTransactionRequest(
        jsonRequest({ type: 'LOAN_ISSUE', lenderKind: 'BANK', playerId, amount: 100 }),
      ),
    ).resolves.toEqual({ type: 'LOAN_ISSUE', lenderKind: 'BANK', playerId, amount: 100 });
    await expect(
      parseCreateTransactionRequest(
        jsonRequest({
          type: 'LOAN_ISSUE',
          lenderKind: 'BANK',
          playerId,
          amount: 100,
          acknowledgeCooldown: true,
        }),
      ),
    ).resolves.toEqual({
      type: 'LOAN_ISSUE',
      lenderKind: 'BANK',
      playerId,
      amount: 100,
      acknowledgeCooldown: true,
    });
  });

  it('still reads a player loan with an explicit lenderKind PLAYER', async () => {
    await expect(
      parseCreateTransactionRequest(
        jsonRequest({
          type: 'LOAN_ISSUE',
          lenderKind: 'PLAYER',
          borrowerPlayerId: playerId,
          lenderPlayerId,
          amount: 50,
        }),
      ),
    ).resolves.toEqual({
      type: 'LOAN_ISSUE',
      borrowerPlayerId: playerId,
      lenderPlayerId,
      amount: 50,
    });
  });

  it.each([
    ['an unknown lender kind', { lenderKind: 'BOT', playerId, amount: 10 }],
    ['a missing player', { lenderKind: 'BANK', amount: 10 }],
    ['a malformed player', { lenderKind: 'BANK', playerId: 'x', amount: 10 }],
    ['a zero amount', { lenderKind: 'BANK', playerId, amount: 0 }],
    ['a fractional amount', { lenderKind: 'BANK', playerId, amount: 1.5 }],
    ['an unsafe amount', { lenderKind: 'BANK', playerId, amount: 2 ** 60 }],
    [
      'a non-boolean acknowledgement',
      { lenderKind: 'BANK', playerId, amount: 10, acknowledgeCooldown: 'yes' },
    ],
  ])('rejects a bank loan request with %s', async (_label, fields) => {
    await expect(
      parseCreateTransactionRequest(jsonRequest({ type: 'LOAN_ISSUE', ...fields })),
    ).rejects.toBeInstanceOf(ApiValidationError);
  });

  it.each([0, 10, 20])('accepts a repayment at %i%% interest', async (interestRatePercent) => {
    await expect(
      parseCreateTransactionRequest(
        jsonRequest({ type: 'LOAN_REPAYMENT', playerId, loanId, amount: 50, interestRatePercent }),
      ),
    ).resolves.toEqual({
      type: 'LOAN_REPAYMENT',
      playerId,
      loanId,
      amount: 50,
      interestRatePercent,
    });
  });

  it.each([5, 15, -10, 100, '10', null, 10.5, true])(
    'rejects the interest rate %j',
    async (interestRatePercent) => {
      await expect(
        parseCreateTransactionRequest(
          jsonRequest({
            type: 'LOAN_REPAYMENT',
            playerId,
            loanId,
            amount: 50,
            interestRatePercent,
          }),
        ),
      ).rejects.toBeInstanceOf(ApiValidationError);
    },
  );
});

describe('Free Parking jackpot validation', () => {
  const playerId = '11111111-1111-4111-8111-111111111111';

  it('accepts a payment into the pot, with or without a comment', async () => {
    await expect(
      parseCreateTransactionRequest(
        jsonRequest({ type: 'TO_JACKPOT', playerId, amount: 200, comment: 'Income tax' }),
      ),
    ).resolves.toEqual({ type: 'TO_JACKPOT', playerId, amount: 200, comment: 'Income tax' });
    await expect(
      parseCreateTransactionRequest(jsonRequest({ type: 'TO_JACKPOT', playerId, amount: 75 })),
    ).resolves.toEqual({ type: 'TO_JACKPOT', playerId, amount: 75 });
  });

  it.each([
    ['a missing player', { amount: 10 }],
    ['a malformed player', { playerId: 'nope', amount: 10 }],
    ['a missing amount', { playerId }],
    ['a zero amount', { playerId, amount: 0 }],
    ['a negative amount', { playerId, amount: -5 }],
    ['a fractional amount', { playerId, amount: 1.5 }],
    ['an unsafe amount', { playerId, amount: 2 ** 60 }],
    ['an amount string', { playerId, amount: '10' }],
    ['a non-string comment', { playerId, amount: 10, comment: 5 }],
  ])('rejects a pot payment with %s', async (_label, fields) => {
    await expect(
      parseCreateTransactionRequest(jsonRequest({ type: 'TO_JACKPOT', ...fields })),
    ).rejects.toBeInstanceOf(ApiValidationError);
  });

  it('accepts a collection with the reviewed pot and ignores any amount or comment', async () => {
    await expect(
      parseCreateTransactionRequest(
        jsonRequest({
          type: 'JACKPOT_PAYOUT',
          playerId,
          expectedAmount: 275,
          amount: 999999,
          comment: 'x',
        }),
      ),
    ).resolves.toEqual({ type: 'JACKPOT_PAYOUT', playerId, expectedAmount: 275 });
  });

  it.each([
    ['a missing player', { expectedAmount: 10 }],
    ['a malformed player', { playerId: 'nope', expectedAmount: 10 }],
    ['a missing expected pot', { playerId }],
    ['a zero expected pot', { playerId, expectedAmount: 0 }],
    ['a negative expected pot', { playerId, expectedAmount: -5 }],
    ['a fractional expected pot', { playerId, expectedAmount: 1.5 }],
    ['an unsafe expected pot', { playerId, expectedAmount: 2 ** 60 }],
    ['a string expected pot', { playerId, expectedAmount: '10' }],
    ['only an amount', { playerId, amount: 10 }],
  ])('rejects a collection with %s', async (_label, fields) => {
    await expect(
      parseCreateTransactionRequest(jsonRequest({ type: 'JACKPOT_PAYOUT', ...fields })),
    ).rejects.toBeInstanceOf(ApiValidationError);
  });
});

describe('auction validation', () => {
  const playerId = '11111111-1111-4111-8111-111111111111';
  const auctionId = '22222222-2222-4222-8222-222222222222';

  it('normalises the lot name and requires an initiator', async () => {
    await expect(
      parseStartAuctionRequest(
        jsonRequest({ initiatorPlayerId: playerId, lotName: '  Park   Place ' }),
      ),
    ).resolves.toEqual({ initiatorPlayerId: playerId, lotName: 'Park Place' });
  });

  it.each([
    ['a missing lot', { initiatorPlayerId: playerId }],
    ['a blank lot', { initiatorPlayerId: playerId, lotName: '   ' }],
    ['a too long lot', { initiatorPlayerId: playerId, lotName: 'x'.repeat(61) }],
    ['a control character', { initiatorPlayerId: playerId, lotName: 'a\u0000b' }],
    ['a malformed initiator', { initiatorPlayerId: 'nope', lotName: 'Lot' }],
  ])('rejects %s when starting', async (_name, body) => {
    await expect(parseStartAuctionRequest(jsonRequest(body))).rejects.toBeInstanceOf(
      ApiValidationError,
    );
  });

  it('takes the auction from the URL and reads the bid', async () => {
    await expect(
      parsePlaceBidRequest(
        jsonRequest({ bidderPlayerId: playerId, expectedVersion: 3, step: 25 }),
        auctionId,
      ),
    ).resolves.toEqual({ bidderPlayerId: playerId, auctionId, expectedVersion: 3, step: 25 });
  });

  it.each([
    ['a missing bidder', { expectedVersion: 1, step: 10 }],
    ['a missing version', { bidderPlayerId: playerId, step: 10 }],
    ['a zero version', { bidderPlayerId: playerId, expectedVersion: 0, step: 10 }],
    ['a fractional step', { bidderPlayerId: playerId, expectedVersion: 1, step: 2.5 }],
    ['a negative step', { bidderPlayerId: playerId, expectedVersion: 1, step: -10 }],
    ['a string step', { bidderPlayerId: playerId, expectedVersion: 1, step: '10' }],
  ])('rejects %s when bidding', async (_name, body) => {
    await expect(parsePlaceBidRequest(jsonRequest(body), auctionId)).rejects.toBeInstanceOf(
      ApiValidationError,
    );
  });

  it('rejects a malformed auction id and a client-sent AUCTION_PAYMENT', async () => {
    await expect(
      parsePlaceBidRequest(
        jsonRequest({ bidderPlayerId: playerId, expectedVersion: 1, step: 10 }),
        'nope',
      ),
    ).rejects.toBeInstanceOf(ApiValidationError);
    await expect(
      parseCreateTransactionRequest(jsonRequest({ type: 'AUCTION_PAYMENT', playerId, amount: 10 })),
    ).rejects.toBeInstanceOf(ApiValidationError);
  });
});
