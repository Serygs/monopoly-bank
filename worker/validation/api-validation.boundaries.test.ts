import { describe, expect, it } from 'vitest';
import {
  ApiValidationError,
  normalizeJoinCode,
  parseAddAccountEmailRequest,
  parseAuthTokenRequest,
  parseBankruptcyRequest,
  parseCreateGameRequest,
  parseCreateTradeRequest,
  parseCreateTransactionRequest,
  parseDuplicateGameRequest,
  parseFinishGameRequest,
  parseGuestJoinGameRequest,
  parseJoinGameRequest,
  parseLoginRequest,
  parsePasswordResetConfirmationRequest,
  parsePasswordResetRequest,
  parsePlaceBidRequest,
  parseRecordDiceRollRequest,
  parseRegisterRequest,
  parseResourceId,
  parseStartAuctionRequest,
  parseUpdateProfileRequest,
  parseUpgradeGuestRequest,
  readTileId,
} from './api-validation.js';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const [a, b, c] = [id(1), id(2), id(3)];

const json = (body: unknown): Request =>
  new Request('https://example.test/api', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

const reason = async (run: () => Promise<unknown>): Promise<string | undefined> => {
  try {
    await run();
  } catch (error) {
    expect(error).toBeInstanceOf(ApiValidationError);
    expect(error).toMatchObject({ code: 'VALIDATION_ERROR', status: 400 });
    return (error as ApiValidationError).message;
  }
  return undefined;
};

const token = (length: number, fill = 'a') => fill.repeat(length);

describe('resource ids', () => {
  it('accepts a UUID of any case', () => {
    expect(parseResourceId(a, 'gameId')).toBe(a);
    expect(parseResourceId(a.toUpperCase(), 'gameId')).toBe(a.toUpperCase());
  });

  it.each([
    '',
    'not-a-uuid',
    a.replace(/-/gu, ''),
    `${a}0`,
    `0${a}`,
    `${a}\n`,
    a.replace('4000', '400g'),
    a.slice(1),
  ])('rejects %j and names the field', (value) => {
    expect(() => parseResourceId(value, 'gameId')).toThrow('gameId must be a UUID.');
  });
});

describe('request bodies', () => {
  it('rejects text that is not JSON, and JSON that is not an object', async () => {
    const text = new Request('https://example.test/api', { method: 'POST', body: 'nope' });
    expect(await reason(() => parseBankruptcyRequest(text))).toBe(
      'Request body must be valid JSON.',
    );
    for (const body of [null, [], 'text', 5])
      expect(await reason(() => parseBankruptcyRequest(json(body)))).toBe(
        'body must be an object.',
      );
  });
});

describe('lobby creation', () => {
  const lobby = {
    name: ' Table ',
    startingBalance: 1500,
    passGoReward: 200,
    currency: 'EUR',
    players: [{ name: ' Ann ', color: ' #fff ' }],
  };
  const parse = (patch: Record<string, unknown>) =>
    parseCreateGameRequest(json({ ...lobby, ...patch }));

  it('trims names and colours', async () => {
    await expect(parse({})).resolves.toEqual({
      name: 'Table',
      startingBalance: 1500,
      passGoReward: 200,
      currency: 'EUR',
      players: [{ name: 'Ann', color: '#fff' }],
    });
  });

  it('accepts one to six players and refuses none or seven, naming the count', async () => {
    const some = (count: number) =>
      Array.from({ length: count }, (_, index) => ({ name: `P${index}`, color: `#00000${index}` }));
    await expect(parse({ players: some(1) })).resolves.toBeDefined();
    await expect(parse({ players: some(6) })).resolves.toBeDefined();
    for (const count of [0, 7]) {
      await expect(parse({ players: some(count) })).rejects.toMatchObject({
        message: 'A lobby must have between 1 and 6 players.',
        details: { playerCount: count },
      });
    }
  });

  it('refuses two players with the same colour, whatever its case', async () => {
    await expect(
      parse({
        players: [
          { name: 'Ann', color: '#d83f55' },
          { name: 'Bob', color: '#D83F55' },
        ],
      }),
    ).rejects.toMatchObject({
      message: 'Every player must have a different color.',
      details: { color: '#D83F55' },
    });
  });

  it.each([
    [{ players: 'x' }, 'players must be an array.'],
    [{ players: ['x'] }, 'players[0] must be an object.'],
    [{ players: [{ color: '#fff' }] }, 'players[0].name is required.'],
    [{ players: [{ name: '   ', color: '#fff' }] }, 'players[0].name is required.'],
    [{ players: [{ name: 'Ann' }] }, 'players[0].color is required.'],
    [{ name: '' }, 'name is required.'],
    [{ name: 5 }, 'name is required.'],
    [{ startingBalance: 0 }, 'startingBalance must be a positive integer.'],
    [{ startingBalance: -1 }, 'startingBalance must be a positive integer.'],
    [{ startingBalance: 1.5 }, 'startingBalance must be a positive integer.'],
    [{ startingBalance: '1500' }, 'startingBalance must be a positive integer.'],
    [
      { startingBalance: Number.MAX_SAFE_INTEGER + 1 },
      'startingBalance must be a positive integer.',
    ],
    [{ passGoReward: 0 }, 'passGoReward must be a positive integer.'],
    [{ currency: 'K' }, 'currency must be one of USD, EUR, or UAH.'],
    [{ currency: 5 }, 'currency must be one of USD, EUR, or UAH.'],
    [{ paymentMode: 'SLOW' }, 'paymentMode must be FAST or CONFIRMATION.'],
    [{ paymentMode: 1 }, 'paymentMode must be FAST or CONFIRMATION.'],
    [{ rules: 'on' }, 'rules must be an object.'],
    [{ rules: { magic: true } }, 'rules.magic is not a rule.'],
    [{ rules: { auctions: 'yes' } }, 'rules.auctions must be true or false.'],
    [{ board: 'chess' }, 'board must be one of none or monopoly-ru-2012.'],
    [{ isPublic: 'yes' }, 'isPublic must be a boolean.'],
    [
      { isPublic: true, gameAccessPassword: 'secret' },
      'A public lobby cannot have a table password.',
    ],
    [{ gameAccessPassword: 'abc' }, 'gameAccessPassword must be between 4 and 256 characters.'],
    [
      { gameAccessPassword: token(257) },
      'gameAccessPassword must be between 4 and 256 characters.',
    ],
  ])('rejects %j', async (patch, message) => {
    expect(await reason(() => parse(patch))).toBe(message);
  });

  it('keeps the optional settings it is given and leaves out the ones it is not', async () => {
    await expect(
      parse({
        paymentMode: 'CONFIRMATION',
        rules: { auctions: true },
        board: 'monopoly-ru-2012',
        isPublic: true,
        gameAccessPassword: undefined,
      }),
    ).resolves.toMatchObject({
      paymentMode: 'CONFIRMATION',
      rules: {
        auctions: true,
        playerLoans: false,
        bankLoans: false,
        freeParkingJackpot: false,
        doubleRewardOnExactGo: false,
      },
      board: 'monopoly-ru-2012',
      isPublic: true,
    });
    const plain = await parse({ isPublic: false });
    expect(plain).not.toHaveProperty('isPublic');
    expect(plain).not.toHaveProperty('paymentMode');
    expect(plain).not.toHaveProperty('rules');
    expect(plain).not.toHaveProperty('board');
    expect(plain).not.toHaveProperty('gameAccessPassword');
  });

  it('accepts a table password of exactly 4 and exactly 256 characters', async () => {
    await expect(parse({ gameAccessPassword: token(4) })).resolves.toMatchObject({
      gameAccessPassword: token(4),
    });
    await expect(parse({ gameAccessPassword: token(256) })).resolves.toBeDefined();
  });
});

describe('accounts', () => {
  const register = (patch: Record<string, unknown>) =>
    parseRegisterRequest(json({ nickname: 'Ann', avatar: '🙂', password: 'secret1', ...patch }));

  it('trims what it reads', async () => {
    await expect(register({ nickname: '  Ann  ', password: ' secret1 ' })).resolves.toEqual({
      nickname: 'Ann',
      avatar: '🙂',
      password: 'secret1',
    });
  });

  it('keeps nicknames of 2 to 40 characters', async () => {
    await expect(register({ nickname: token(2) })).resolves.toBeDefined();
    await expect(register({ nickname: token(40) })).resolves.toBeDefined();
    for (const nickname of [token(1), token(41)])
      expect(await reason(() => register({ nickname }))).toBe(
        'nickname must be between 2 and 40 characters.',
      );
    expect(await reason(() => register({ nickname: undefined }))).toBe('nickname is required.');
  });

  it('keeps passwords of 6 to 256 characters', async () => {
    await expect(register({ password: token(6) })).resolves.toBeDefined();
    await expect(register({ password: token(256) })).resolves.toBeDefined();
    for (const password of [token(5), token(257)])
      expect(await reason(() => register({ password }))).toBe(
        'password must be between 6 and 256 characters.',
      );
  });

  it('accepts a short emoji or a small base64 image and refuses everything else', async () => {
    const dataUrl = (type: string, payload: string) => `data:image/${type};base64,${payload}`;
    await expect(register({ avatar: token(32, 'x') })).resolves.toBeDefined();
    for (const type of ['jpeg', 'png', 'webp'])
      await expect(register({ avatar: dataUrl(type, 'SGVsbG8gd29ybGQ=') })).resolves.toBeDefined();
    await expect(register({ avatar: dataUrl('png', 'SGVsbG8gd29ybA==') })).resolves.toBeDefined();
    await expect(
      register({ avatar: dataUrl('png', token(100_000 - 'data:image/png;base64,'.length)) }),
    ).resolves.toBeDefined();
    const message = 'avatar must be an emoji or a JPG, PNG, or WebP image smaller than 100 KB.';
    const payload = 'SGVsbG8gd29ybGQ=';
    for (const avatar of [
      token(33, 'x'),
      dataUrl('gif', payload),
      dataUrl('svg+xml', payload),
      dataUrl('png', 'SGVsbG8gd29y$GQ='),
      dataUrl('png', `${payload}==`),
      `${dataUrl('png', payload)}!`,
      `x${dataUrl('png', payload)}`,
      dataUrl('png', token(100_000 - 'data:image/png;base64,'.length + 1)),
    ])
      expect(await reason(() => register({ avatar }))).toBe(message);
  });

  it('reads a login by email, lowercased, or by nickname', async () => {
    await expect(
      parseLoginRequest(json({ email: ' Ann@Example.COM ', password: 'secret1' })),
    ).resolves.toEqual({ email: 'ann@example.com', password: 'secret1' });
    await expect(
      parseLoginRequest(json({ nickname: 'Ann', password: 'secret1' })),
    ).resolves.toEqual({ nickname: 'Ann', password: 'secret1' });
    expect(await reason(() => parseLoginRequest(json({ nickname: 'Ann' })))).toBe(
      'password is required.',
    );
  });

  it('accepts emails up to 254 characters with one @ and a dotted domain', async () => {
    const email = (value: string) => parsePasswordResetRequest(json({ email: value }));
    await expect(email(`${token(242)}@example.com`)).resolves.toBeDefined();
    for (const value of [
      `${token(243)}@example.com`,
      'plain',
      'a@b',
      'a b@c.d',
      '@c.d',
      'a@.d',
      'a@b.',
      'a@b.co x',
    ])
      expect(await reason(() => email(value))).toBe('email must be a valid email address.');
    expect(await reason(() => email(''))).toBe('email is required.');
  });

  it('requires an avatar and an invitation token to be present', async () => {
    expect(await reason(() => register({ avatar: undefined }))).toBe('avatar is required.');
    expect(await reason(() => parseJoinGameRequest(json({ invitationToken: '' })))).toBe(
      'invitationToken is required.',
    );
  });

  it('reads the other account bodies', async () => {
    await expect(
      parseUpgradeGuestRequest(json({ email: 'A@b.co', password: 'secret1' })),
    ).resolves.toEqual({ email: 'a@b.co', password: 'secret1' });
    await expect(parseAddAccountEmailRequest(json({ email: 'A@b.co' }))).resolves.toEqual({
      email: 'a@b.co',
    });
    await expect(
      parseUpdateProfileRequest(json({ nickname: 'Ann', avatar: '🙂' })),
    ).resolves.toEqual({ nickname: 'Ann', avatar: '🙂' });
    await expect(
      parsePasswordResetConfirmationRequest(json({ token: token(32), password: 'secret1' })),
    ).resolves.toEqual({ token: token(32), password: 'secret1' });
    await expect(parseDuplicateGameRequest(json({ gameAccessPassword: 'abcd' }))).resolves.toEqual({
      gameAccessPassword: 'abcd',
    });
    expect(await reason(() => parseDuplicateGameRequest(json({})))).toBe(
      'gameAccessPassword is required.',
    );
  });

  it('accepts tokens of 32 to 128 URL-safe characters', async () => {
    for (const length of [32, 128])
      await expect(parseAuthTokenRequest(json({ token: token(length, 'A') }))).resolves.toEqual({
        token: token(length, 'A'),
      });
    await expect(
      parseAuthTokenRequest(json({ token: `${token(16)}-_${token(16, '9')}` })),
    ).resolves.toBeDefined();
    for (const value of [
      token(31),
      token(129),
      `${token(31)}+`,
      `${token(31)}=`,
      `${token(31)} `,
      `${token(31)}!`,
    ])
      expect(await reason(() => parseAuthTokenRequest(json({ token: value })))).toBe(
        'token is invalid.',
      );
    expect(await reason(() => parseAuthTokenRequest(json({})))).toBe('token is required.');
  });
});

describe('joining a game', () => {
  it('reads an invitation token of 32 to 128 characters', async () => {
    for (const length of [32, 128])
      await expect(parseJoinGameRequest(json({ invitationToken: token(length) }))).resolves.toEqual(
        { invitationToken: token(length) },
      );
    for (const value of [token(31), token(129), `${token(31)}+`, `${token(31)}!`])
      expect(await reason(() => parseJoinGameRequest(json({ invitationToken: value })))).toBe(
        'invitationToken is invalid.',
      );
  });

  it('reads a join code of 4 to 12 letters or digits in upper case', async () => {
    await expect(parseJoinGameRequest(json({ joinCode: ' ab12 ' }))).resolves.toEqual({
      joinCode: 'AB12',
    });
    await expect(parseJoinGameRequest(json({ joinCode: token(12) }))).resolves.toEqual({
      joinCode: token(12, 'A'),
    });
    for (const value of ['abc', token(13), 'ab-12', 'ab 12', 'ab12\n!'])
      expect(await reason(() => parseJoinGameRequest(json({ joinCode: value })))).toBe(
        'joinCode must contain 4 to 12 letters or digits.',
      );
    expect(await reason(() => parseJoinGameRequest(json({})))).toBe('joinCode is required.');
    expect(normalizeJoinCode('  ab1 ')).toBe('AB1');
  });

  it('passes a game password on, ignores an empty one and checks its length', async () => {
    await expect(
      parseJoinGameRequest(json({ joinCode: 'AB12', gameAccessPassword: 'abcd' })),
    ).resolves.toEqual({ joinCode: 'AB12', gameAccessPassword: 'abcd' });
    await expect(
      parseJoinGameRequest(json({ joinCode: 'AB12', gameAccessPassword: '' })),
    ).resolves.toEqual({ joinCode: 'AB12' });
    expect(
      await reason(() =>
        parseJoinGameRequest(json({ joinCode: 'AB12', gameAccessPassword: 'abc' })),
      ),
    ).toBe('gameAccessPassword must be between 4 and 256 characters.');
  });

  it('adds the nickname and avatar for a guest, and keeps the same join rules', async () => {
    await expect(
      parseGuestJoinGameRequest(json({ nickname: 'Ann', avatar: '🙂', joinCode: 'ab12' })),
    ).resolves.toEqual({ nickname: 'Ann', avatar: '🙂', joinCode: 'AB12' });
    await expect(
      parseGuestJoinGameRequest(
        json({ nickname: 'Ann', avatar: '🙂', joinCode: 'ab12', gameAccessPassword: '' }),
      ),
    ).resolves.toStrictEqual({ nickname: 'Ann', avatar: '🙂', joinCode: 'AB12' });
    await expect(
      parseGuestJoinGameRequest(
        json({ nickname: 'Ann', avatar: '🙂', joinCode: 'ab12', gameAccessPassword: 'abcd' }),
      ),
    ).resolves.toEqual({
      nickname: 'Ann',
      avatar: '🙂',
      joinCode: 'AB12',
      gameAccessPassword: 'abcd',
    });
    expect(
      await reason(() =>
        parseGuestJoinGameRequest(
          json({ nickname: 'Ann', avatar: '🙂', joinCode: 'ab12', gameAccessPassword: 'abc' }),
        ),
      ),
    ).toBe('gameAccessPassword must be between 4 and 256 characters.');
    await expect(
      parseGuestJoinGameRequest(
        json({ nickname: 'Ann', avatar: '🙂', invitationToken: token(32) }),
      ),
    ).resolves.toEqual({ nickname: 'Ann', avatar: '🙂', invitationToken: token(32) });
    expect(
      await reason(() => parseGuestJoinGameRequest(json({ nickname: 'Ann', avatar: '🙂' }))),
    ).toBe('joinCode is required.');
  });
});

describe('game flow bodies', () => {
  it('reads a bankruptcy with or without a creditor', async () => {
    expect(await parseBankruptcyRequest(json({ playerId: a }))).toStrictEqual({ playerId: a });
    await expect(
      parseBankruptcyRequest(json({ playerId: a, creditorPlayerId: b })),
    ).resolves.toEqual({ playerId: a, creditorPlayerId: b });
    expect(
      await reason(() => parseBankruptcyRequest(json({ playerId: a, creditorPlayerId: 'x' }))),
    ).toBe('creditorPlayerId must be a UUID.');
    expect(await reason(() => parseBankruptcyRequest(json({})))).toBe('playerId is required.');
  });

  it('reads the winners of a finished game', async () => {
    await expect(parseFinishGameRequest(json({ winnerPlayerIds: [] }))).resolves.toEqual({
      winnerPlayerIds: [],
    });
    await expect(parseFinishGameRequest(json({ winnerPlayerIds: [a, b] }))).resolves.toEqual({
      winnerPlayerIds: [a, b],
    });
    expect(await reason(() => parseFinishGameRequest(json({ winnerPlayerIds: [a, a] })))).toBe(
      'winnerPlayerIds must not contain duplicates.',
    );
    expect(await reason(() => parseFinishGameRequest(json({ winnerPlayerIds: ['x'] })))).toBe(
      'winnerPlayerIds[0] must be a UUID.',
    );
    expect(await reason(() => parseFinishGameRequest(json({ winnerPlayerIds: [a, 5] })))).toBe(
      'winnerPlayerIds[1] is required.',
    );
    expect(await reason(() => parseFinishGameRequest(json({})))).toBe(
      'winnerPlayerIds must be an array.',
    );
  });

  it('reads a dice roll of two dice from 1 to 6', async () => {
    await expect(
      parseRecordDiceRollRequest(json({ id: a, dieOne: 1, dieTwo: 6 })),
    ).resolves.toEqual({ id: a, dieOne: 1, dieTwo: 6 });
    for (const bad of [0, 7, 1.5, '3', null, Number.NaN]) {
      expect(
        await reason(() => parseRecordDiceRollRequest(json({ id: a, dieOne: bad, dieTwo: 3 }))),
      ).toBe('dieOne must be an integer from 1 to 6.');
      expect(
        await reason(() => parseRecordDiceRollRequest(json({ id: a, dieOne: 3, dieTwo: bad }))),
      ).toBe('dieTwo must be an integer from 1 to 6.');
    }
  });
});

describe('auctions', () => {
  it('names a board tile after its id when no lot name is sent', async () => {
    await expect(
      parseStartAuctionRequest(json({ initiatorPlayerId: a, tileId: 'zhitna' })),
    ).resolves.toEqual({ initiatorPlayerId: a, lotName: 'zhitna', tileId: 'zhitna' });
    await expect(
      parseStartAuctionRequest(
        json({ initiatorPlayerId: a, tileId: 'zhitna', lotName: ' Brown ' }),
      ),
    ).resolves.toEqual({ initiatorPlayerId: a, lotName: 'Brown', tileId: 'zhitna' });
    const free = await parseStartAuctionRequest(json({ initiatorPlayerId: a, lotName: 'Lot' }));
    expect(free).toEqual({ initiatorPlayerId: a, lotName: 'Lot' });
    expect(free).not.toHaveProperty('tileId');
  });

  it('refuses a missing, empty, over-long or non-text lot name', async () => {
    const message = 'lotName must be 1 to 60 characters without control characters.';
    for (const lotName of [undefined, '', '   ', 'x'.repeat(61), 5, 'bad\u0007name'])
      expect(
        await reason(() => parseStartAuctionRequest(json({ initiatorPlayerId: a, lotName }))),
      ).toBe(message);
    await expect(
      parseStartAuctionRequest(json({ initiatorPlayerId: a, lotName: 'x'.repeat(60) })),
    ).resolves.toBeDefined();
  });

  it('refuses a tile id that is not a board tile id', async () => {
    expect(
      await reason(() =>
        parseStartAuctionRequest(json({ initiatorPlayerId: a, tileId: 'Zhitna' })),
      ),
    ).toBe('tileId must be a board tile id.');
  });

  it('reads a bid and its positive integers', async () => {
    await expect(
      parsePlaceBidRequest(json({ bidderPlayerId: a, expectedVersion: 1, step: 25 }), b),
    ).resolves.toEqual({ bidderPlayerId: a, auctionId: b, expectedVersion: 1, step: 25 });
    for (const field of ['expectedVersion', 'step'])
      for (const bad of [0, -1, 1.5, '1', undefined])
        expect(
          await reason(() =>
            parsePlaceBidRequest(
              json({ bidderPlayerId: a, expectedVersion: 1, step: 25, [field]: bad }),
              b,
            ),
          ),
        ).toBe(`${field} must be a positive integer.`);
    expect(
      await reason(() =>
        parsePlaceBidRequest(json({ bidderPlayerId: a, expectedVersion: 1, step: 25 }), 'x'),
      ),
    ).toBe('auctionId must be a UUID.');
  });
});

describe('tile ids', () => {
  it.each(['a', 'zhitna', 'power_plant', 'a1', `a${'b'.repeat(63)}`])('accepts %s', (value) => {
    expect(readTileId({ tileId: value })).toBe(value);
  });

  it.each([
    '',
    'Zhitna',
    '1abc',
    '_abc',
    'a-b',
    'abc!',
    'abc\n',
    '\nabc',
    'ab c',
    `a${'b'.repeat(64)}`,
    5,
    undefined,
  ])('rejects %j', (value) => {
    expect(() => readTileId({ tileId: value })).toThrow('tileId must be a board tile id.');
  });
});

describe('trades', () => {
  const trade = {
    id: a,
    playerId: b,
    counterpartyPlayerId: c,
    giveTileIds: ['zhitna'],
    takeTileIds: [],
  };
  const parse = (patch: Record<string, unknown>) =>
    parseCreateTradeRequest(json({ ...trade, ...patch }));

  it('keeps the tile lists and the cash it is given', async () => {
    await expect(parse({ cashGive: 0, cashTake: 5 })).resolves.toEqual({
      id: a,
      playerId: b,
      counterpartyPlayerId: c,
      giveTileIds: ['zhitna'],
      takeTileIds: [],
      cashGive: 0,
      cashTake: 5,
    });
    const plain = await parse({});
    expect(plain).not.toHaveProperty('cashGive');
    expect(plain).not.toHaveProperty('cashTake');
  });

  it('accepts a list of 28 tiles and refuses 29', async () => {
    const tiles = (count: number) => Array.from({ length: count }, (_, index) => `tile_${index}`);
    await expect(parse({ giveTileIds: tiles(28) })).resolves.toBeDefined();
    expect(await reason(() => parse({ giveTileIds: tiles(29) }))).toBe(
      'giveTileIds must be a list of board tile ids.',
    );
  });

  it.each([
    [{ giveTileIds: 'zhitna' }, 'giveTileIds must be a list of board tile ids.'],
    [{ giveTileIds: [5] }, 'giveTileIds must be a list of board tile ids.'],
    [{ giveTileIds: ['Zhitna'] }, 'giveTileIds must be a list of board tile ids.'],
    [{ giveTileIds: ['zhitna!'] }, 'giveTileIds must be a list of board tile ids.'],
    [{ takeTileIds: undefined }, 'takeTileIds must be a list of board tile ids.'],
    [{ takeTileIds: ['nagatinska', 'Bad'] }, 'takeTileIds must be a list of board tile ids.'],
    [{ takeTileIds: ['zhitna'] }, 'A property can only be traded once.'],
    [{ giveTileIds: ['zhitna', 'zhitna'] }, 'A property can only be traded once.'],
    [{ giveTileIds: [], takeTileIds: [] }, 'A trade needs at least one property.'],
    [{ counterpartyPlayerId: b }, 'counterpartyPlayerId must be another player.'],
    [{ cashGive: -1 }, 'cashGive must be zero or a positive integer.'],
    [{ cashTake: 1.5 }, 'cashTake must be zero or a positive integer.'],
    [{ cashGive: '5' }, 'cashGive must be zero or a positive integer.'],
    [{ cashTake: Number.MAX_SAFE_INTEGER + 1 }, 'cashTake must be zero or a positive integer.'],
  ])('rejects %j', async (patch, message) => {
    expect(await reason(() => parse(patch))).toBe(message);
  });

  it('accepts a trade of one tile taken and none given', async () => {
    await expect(parse({ giveTileIds: [], takeTileIds: ['nagatinska'] })).resolves.toBeDefined();
  });
});

describe('transactions', () => {
  const create = (body: Record<string, unknown>) => parseCreateTransactionRequest(json(body));

  it.each([[undefined], [5], ['NOPE'], ['BANKRUPTCY_TRANSFER'], ['AUCTION_PAYMENT']])(
    'refuses the type %j',
    async (type) => {
      expect(await reason(() => create({ type }))).toBe(
        'type must be a supported transaction type.',
      );
    },
  );

  it.each([
    ['PLAYER_TO_PLAYER', { sourcePlayerId: a, destinationPlayerId: b, amount: 5 }],
    ['PLAYER_TO_BANK', { playerId: a, amount: 5 }],
    ['BANK_TO_PLAYER', { playerId: a, amount: 5 }],
    ['PLAYER_TO_ALL', { payerPlayerId: a, amountPerPlayer: 5 }],
    ['ALL_TO_PLAYER', { recipientPlayerId: a, amountPerPlayer: 5 }],
    ['TO_JACKPOT', { playerId: a, amount: 5 }],
    ['REVERSAL', { transactionId: a }],
    ['PASS_GO', { playerId: a }],
  ] as const)(
    '%s trims a comment, keeps an empty one and omits a missing one',
    async (type, fields) => {
      const base = { type, ...fields };
      await expect(create({ ...base, comment: '  rent  ' })).resolves.toEqual({
        ...base,
        comment: 'rent',
      });
      await expect(create({ ...base, comment: '   ' })).resolves.toEqual({ ...base, comment: '' });
      const without = await create(base);
      expect(without).toEqual(base);
      expect(without).not.toHaveProperty('comment');
      expect(await reason(() => create({ ...base, comment: 5 }))).toBe('comment must be a string.');
    },
  );

  it.each([
    ['PLAYER_TO_PLAYER', { sourcePlayerId: a, destinationPlayerId: b, amount: 5 }],
    ['PLAYER_TO_BANK', { playerId: a, amount: 5 }],
    ['BANK_TO_PLAYER', { playerId: a, amount: 5 }],
    ['PLAYER_TO_ALL', { payerPlayerId: a, amountPerPlayer: 5 }],
    ['ALL_TO_PLAYER', { recipientPlayerId: a, amountPerPlayer: 5 }],
    ['TO_JACKPOT', { playerId: a, amount: 5 }],
    ['LOAN_REPAYMENT', { playerId: a, loanId: b, amount: 5 }],
    ['MORTGAGE', { playerId: a, propertyName: 'Boardwalk', amount: 5 }],
    ['JACKPOT_PAYOUT', { playerId: a, expectedAmount: 5 }],
  ] as const)('%s needs every id and a positive whole amount', async (type, fields) => {
    const base = { type, ...fields };
    for (const [key, value] of Object.entries(fields)) {
      if (typeof value === 'number') {
        for (const bad of [0, -1, 1.5, '5', undefined, Number.MAX_SAFE_INTEGER + 1])
          expect(await reason(() => create({ ...base, [key]: bad }))).toBe(
            `${key} must be a positive integer.`,
          );
      } else if (key.endsWith('Id')) {
        expect(await reason(() => create({ ...base, [key]: 'x' }))).toBe(`${key} must be a UUID.`);
        expect(await reason(() => create({ ...base, [key]: undefined }))).toBe(
          `${key} is required.`,
        );
      }
    }
  });

  it('reads a mortgage by tile id or by free-text name', async () => {
    await expect(create({ type: 'MORTGAGE', playerId: a, tileId: 'zhitna' })).resolves.toEqual({
      type: 'MORTGAGE',
      playerId: a,
      tileId: 'zhitna',
    });
    expect(await reason(() => create({ type: 'MORTGAGE', playerId: a, tileId: 'Zhitna' }))).toBe(
      'tileId must be a board tile id.',
    );
    await expect(
      create({ type: 'MORTGAGE', playerId: a, propertyName: '  Boardwalk  ', amount: 5 }),
    ).resolves.toEqual({ type: 'MORTGAGE', playerId: a, propertyName: 'Boardwalk', amount: 5 });
    const message = 'propertyName must be 1 to 60 characters without control characters.';
    for (const propertyName of [undefined, '', '  ', 'x'.repeat(61), 5])
      expect(
        await reason(() => create({ type: 'MORTGAGE', playerId: a, propertyName, amount: 5 })),
      ).toBe(message);
  });

  it('reads a purchase with an optional price override', async () => {
    const base = { type: 'PROPERTY_PURCHASE', playerId: a, tileId: 'zhitna' };
    const plain = await create(base);
    expect(plain).toEqual(base);
    expect(plain).not.toHaveProperty('priceOverride');
    await expect(create({ ...base, priceOverride: 5 })).resolves.toEqual({
      ...base,
      priceOverride: 5,
    });
    for (const bad of [0, -1, 1.5, '5'])
      expect(await reason(() => create({ ...base, priceOverride: bad }))).toBe(
        'priceOverride must be a positive integer.',
      );
    expect(await reason(() => create({ ...base, tileId: undefined }))).toBe(
      'tileId must be a board tile id.',
    );
  });

  it.each(['PROPERTY_BUILD', 'PROPERTY_SELL_BUILDING'] as const)(
    '%s reads a tile or targets',
    async (type) => {
      await expect(create({ type, playerId: a, tileId: 'zhitna' })).resolves.toEqual({
        type,
        playerId: a,
        tileId: 'zhitna',
      });
      await expect(
        create({ type, playerId: a, targets: { zhitna: 0, nagatinska: 5 } }),
      ).resolves.toEqual({ type, playerId: a, targets: { zhitna: 0, nagatinska: 5 } });
      expect(await reason(() => create({ type, playerId: a }))).toBe(
        'tileId must be a board tile id.',
      );
      expect(
        await reason(() => create({ type, playerId: a, tileId: 'zhitna', targets: { zhitna: 1 } })),
      ).toBe('Send either tileId or targets, not both.');
      for (const targets of [null, [], 'x', 5])
        expect(await reason(() => create({ type, playerId: a, targets }))).toBe(
          'targets must be an object of tile ids and levels.',
        );
      const many = (count: number) =>
        Object.fromEntries(Array.from({ length: count }, (_, index) => [`street_${index}`, 1]));
      for (const targets of [{}, many(5)])
        expect(await reason(() => create({ type, playerId: a, targets }))).toBe(
          'targets must name between 1 and 4 streets.',
        );
      await expect(create({ type, playerId: a, targets: many(4) })).resolves.toBeDefined();
      expect(await reason(() => create({ type, playerId: a, targets: { Zhitna: 1 } }))).toBe(
        'tileId must be a board tile id.',
      );
      for (const level of [-1, 6, 1.5, '1', null])
        expect(await reason(() => create({ type, playerId: a, targets: { zhitna: level } }))).toBe(
          'A target level must be a whole number from 0 to 5.',
        );
    },
  );

  it('reads a rent payment with an optional dice sum from 2 to 12', async () => {
    const base = { type: 'PAY_RENT', payerPlayerId: a, tileId: 'power_plant' };
    const plain = await create(base);
    expect(plain).toEqual(base);
    expect(plain).not.toHaveProperty('diceSum');
    for (const diceSum of [2, 7, 12])
      await expect(create({ ...base, diceSum })).resolves.toEqual({ ...base, diceSum });
    for (const diceSum of [1, 13])
      expect(await reason(() => create({ ...base, diceSum }))).toBe(
        'diceSum must be between 2 and 12.',
      );
    for (const diceSum of [0, -3, 2.5, '7'])
      expect(await reason(() => create({ ...base, diceSum }))).toBe(
        'diceSum must be a positive integer.',
      );
  });

  it('reads a redemption', async () => {
    await expect(
      create({ type: 'MORTGAGE_REDEMPTION', playerId: a, mortgageId: b }),
    ).resolves.toEqual({ type: 'MORTGAGE_REDEMPTION', playerId: a, mortgageId: b });
    expect(await reason(() => create({ type: 'MORTGAGE_REDEMPTION', playerId: a }))).toBe(
      'mortgageId is required.',
    );
  });

  it('reads a player loan, with or without lenderKind', async () => {
    const base = { type: 'LOAN_ISSUE', borrowerPlayerId: a, lenderPlayerId: b, amount: 5 };
    await expect(create(base)).resolves.toEqual(base);
    await expect(create({ ...base, lenderKind: 'PLAYER' })).resolves.toEqual(base);
    expect(await reason(() => create({ ...base, lenderKind: 'ALIEN' }))).toBe(
      'lenderKind must be PLAYER or BANK.',
    );
    expect(await reason(() => create({ ...base, lenderKind: 5 }))).toBe(
      'lenderKind must be PLAYER or BANK.',
    );
    expect(await reason(() => create({ ...base, lenderPlayerId: undefined }))).toBe(
      'lenderPlayerId is required.',
    );
  });

  it('reads a bank loan and its cooldown acknowledgement', async () => {
    const base = { type: 'LOAN_ISSUE', lenderKind: 'BANK', playerId: a, amount: 5 };
    const plain = await create(base);
    expect(plain).toEqual(base);
    expect(plain).not.toHaveProperty('acknowledgeCooldown');
    await expect(create({ ...base, acknowledgeCooldown: true })).resolves.toEqual({
      ...base,
      acknowledgeCooldown: true,
    });
    const refused = await create({ ...base, acknowledgeCooldown: false });
    expect(refused).not.toHaveProperty('acknowledgeCooldown');
    expect(await reason(() => create({ ...base, acknowledgeCooldown: 'yes' }))).toBe(
      'acknowledgeCooldown must be true or false.',
    );
  });

  it('reads a repayment with an optional interest rate of 0, 10 or 20', async () => {
    const base = { type: 'LOAN_REPAYMENT', playerId: a, loanId: b, amount: 5 };
    const plain = await create(base);
    expect(plain).not.toHaveProperty('interestRatePercent');
    for (const interestRatePercent of [0, 10, 20])
      await expect(create({ ...base, interestRatePercent })).resolves.toEqual({
        ...base,
        interestRatePercent,
      });
    for (const interestRatePercent of [5, -10, '10', null, 30])
      expect(await reason(() => create({ ...base, interestRatePercent }))).toBe(
        'interestRatePercent must be 0, 10 or 20.',
      );
  });

  it('reads the pot collection without an amount', async () => {
    await expect(
      create({ type: 'JACKPOT_PAYOUT', playerId: a, expectedAmount: 5, amount: 99 }),
    ).resolves.toEqual({ type: 'JACKPOT_PAYOUT', playerId: a, expectedAmount: 5 });
  });

  it('reads Pass GO with the exact-landing flag only when it is true', async () => {
    await expect(create({ type: 'PASS_GO', playerId: a, exactLanding: true })).resolves.toEqual({
      type: 'PASS_GO',
      playerId: a,
      exactLanding: true,
    });
    const flat = await create({ type: 'PASS_GO', playerId: a, exactLanding: false });
    expect(flat).not.toHaveProperty('exactLanding');
    expect(await reason(() => create({ type: 'PASS_GO', playerId: a, exactLanding: 1 }))).toBe(
      'exactLanding must be true or false.',
    );
  });
});
