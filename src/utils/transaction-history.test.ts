import { describe, expect, it } from 'vitest';
import type { Player, Transaction } from '../../shared/types/monopoly';
import {
  playerTransactionAmount,
  transactionAmount,
  transactionDescription,
} from './transaction-history';

const players: Player[] = [
  { id: 'john', gameId: 'game', name: 'John', color: '#111', balance: 800, createdAt: '' },
  { id: 'alex', gameId: 'game', name: 'Alex', color: '#222', balance: 1200, createdAt: '' },
];
const rent: Transaction = {
  id: 'transaction',
  gameId: 'game',
  type: 'PAY_RENT',
  amount: 120,
  totalAmount: 120,
  comment: null,
  createdAt: '',
  participants: [
    { playerId: 'john', balanceDelta: -120 },
    { playerId: 'alex', balanceDelta: 120 },
  ],
};

describe('transaction history formatting', () => {
  it('formats a rent payment with both player names', () => {
    expect(transactionDescription(rent, players)).toBe('John → Alex · Rent');
  });
  it('formats transaction descriptions in Ukrainian', () => {
    expect(transactionDescription(rent, players, 'uk')).toBe('John → Alex · Оренда');
  });
  it('formats multi-player amounts and player-relative values', () => {
    const transaction: Transaction = {
      ...rent,
      type: 'PLAYER_TO_ALL',
      amount: 50,
      totalAmount: 200,
    };
    expect(transactionAmount(transaction, 'K')).toBe('50k each · 200k total');
    expect(playerTransactionAmount(rent, 'john', 'K')).toBe('\u2212120k');
    expect(playerTransactionAmount(rent, 'alex', 'K')).toBe('+120k');
  });
});

describe('reversal formatting', () => {
  const reversal = (participants: Transaction['participants']): Transaction => ({
    ...rent,
    id: 'reversal',
    type: 'REVERSAL',
    reversesTransactionId: 'transaction',
    participants,
  });

  it('names who pays whom in the correction', () => {
    expect(
      transactionDescription(
        reversal([
          { playerId: 'alex', balanceDelta: -120 },
          { playerId: 'john', balanceDelta: 120 },
        ]),
        players,
      ),
    ).toBe('Reversal · Alex → John');
  });

  it('reads one-sided and many-sided reversals as the bank and everyone', () => {
    expect(
      transactionDescription(reversal([{ playerId: 'john', balanceDelta: -200 }]), players),
    ).toBe('Reversal · John → Bank');
    expect(
      transactionDescription(
        reversal([
          { playerId: 'john', balanceDelta: 200 },
          { playerId: 'alex', balanceDelta: -100 },
          { playerId: 'sam', balanceDelta: -100 },
        ]),
        players,
      ),
    ).toBe('Reversal · Everyone → John');
  });

  it('shows the amount moved back', () => {
    expect(transactionAmount({ ...reversal([]), totalAmount: 120 }, 'USD')).toBe('$120');
  });
});

describe('mortgage formatting', () => {
  const mortgage: Transaction = {
    ...rent,
    id: 'mortgage',
    type: 'MORTGAGE',
    amount: 400,
    totalAmount: 400,
    comment: 'Boardwalk',
    participants: [{ playerId: 'john', balanceDelta: 400 }],
  };

  it('names the player and the kind of operation', () => {
    expect(transactionDescription(mortgage, players)).toBe('John · Mortgage');
    expect(
      transactionDescription(
        {
          ...mortgage,
          type: 'MORTGAGE_REDEMPTION',
          participants: [{ playerId: 'john', balanceDelta: -440 }],
        },
        players,
      ),
    ).toBe('John · Mortgage redeemed');
  });

  it('shows a mortgage as money received', () => {
    expect(transactionAmount(mortgage, 'USD')).toBe('+$400');
  });
});

describe('loan transactions', () => {
  const issue: Transaction = {
    ...rent,
    type: 'LOAN_ISSUE',
    participants: [
      { playerId: 'john', balanceDelta: -120 },
      { playerId: 'alex', balanceDelta: 120 },
    ],
  };
  it('names the lender and the borrower', () => {
    expect(transactionDescription(issue, players)).toBe('John lent to Alex');
    expect(transactionDescription({ ...issue, type: 'LOAN_REPAYMENT' }, players)).toBe(
      'John repaid Alex',
    );
  });
});

describe('bank loan transactions', () => {
  it('words a loan from the bank and its repayment without a counterpart', () => {
    const issue: Transaction = {
      ...rent,
      type: 'LOAN_ISSUE',
      participants: [{ playerId: 'alex', balanceDelta: 120 }],
    };
    const repayment: Transaction = {
      ...rent,
      type: 'LOAN_REPAYMENT',
      participants: [{ playerId: 'alex', balanceDelta: -132 }],
    };
    expect(transactionDescription(issue, players)).toBe('Alex borrowed from the bank');
    expect(transactionDescription(repayment, players)).toBe('Alex repaid the bank loan');
  });
});

describe('Free Parking jackpot transactions', () => {
  const payment: Transaction = {
    ...rent,
    type: 'TO_JACKPOT',
    comment: 'Income tax',
    participants: [{ playerId: 'alex', balanceDelta: -200 }],
  };
  const payout: Transaction = {
    ...rent,
    type: 'JACKPOT_PAYOUT',
    comment: null,
    participants: [{ playerId: 'alex', balanceDelta: 500 }],
  };

  it('names the payer and what was paid, or the collector', () => {
    expect(transactionDescription(payment, players)).toBe('Alex paid Income tax to Free Parking');
    expect(transactionDescription({ ...payment, comment: null }, players)).toBe(
      'Alex paid to Free Parking',
    );
    expect(transactionDescription(payout, players)).toBe('Alex collected the Free Parking pot');
    expect(transactionDescription(payout, players, 'uk')).toContain('Безкоштовної стоянки');
  });

  it('shows a collection as money received', () => {
    expect(transactionAmount(payout, 'USD')).toMatch(/^\+/);
    expect(transactionAmount(payment, 'USD')).not.toMatch(/^\+/);
  });
});

describe('auction payments', () => {
  const payment: Transaction = {
    ...rent,
    type: 'AUCTION_PAYMENT',
    comment: 'Park Place',
    participants: [{ playerId: 'alex', balanceDelta: -120 }],
  };

  it('names the winner and the lot', () => {
    expect(transactionDescription(payment, players)).toBe('Alex won the auction for Park Place');
    expect(transactionDescription({ ...payment, comment: null }, players)).toBe(
      'Alex won an auction',
    );
    expect(transactionDescription(payment, players, 'uk')).toContain('Park Place');
  });
});

describe('building transactions in the history', () => {
  const base = { id: 't', gameId: 'game', comment: null, createdAt: '' };
  it('names the player and the tile, and shows a sale as income', () => {
    const built: Transaction = {
      ...base,
      type: 'PROPERTY_BUILD',
      amount: 500,
      totalAmount: 500,
      participants: [{ playerId: 'john', balanceDelta: -500 }],
    };
    const sold: Transaction = {
      ...base,
      type: 'PROPERTY_SELL_BUILDING',
      amount: 250,
      totalAmount: 250,
      participants: [{ playerId: 'john', balanceDelta: 250 }],
    };
    expect(transactionDescription(built, players, 'en', 'Zhitna')).toBe('John · Building · Zhitna');
    expect(transactionDescription(sold, players, 'en', 'Zhitna')).toBe(
      'John · Building sold · Zhitna',
    );
    expect(transactionAmount(sold, 'K', 'en').startsWith('+')).toBe(true);
    expect(transactionAmount(built, 'K', 'en').startsWith('+')).toBe(false);
  });
});

describe('trades in the history', () => {
  it('shows who traded with whom and which tiles changed hands', () => {
    const trade: Transaction = {
      id: 't',
      gameId: 'game',
      type: 'PROPERTY_TRANSFER',
      amount: 0,
      totalAmount: 0,
      comment: null,
      createdAt: '',
      initiatorPlayerId: 'alex',
      tileIds: ['zhitna', 'riga_rail'],
      participants: [
        { playerId: 'john', balanceDelta: 0 },
        { playerId: 'alex', balanceDelta: 0 },
      ],
    };
    expect(transactionDescription(trade, players, 'en', 'Zhitna, Riga')).toBe(
      'Alex ⇄ John · Trade · Zhitna, Riga',
    );
  });
});

describe('every transaction type in the history', () => {
  const ledgerPlayers: Player[] = ['ann', 'bob', 'cat'].map((id) => ({
    id,
    gameId: 'game',
    name: id.charAt(0).toUpperCase() + id.slice(1),
    color: '#000',
    balance: 0,
    createdAt: '',
  }));
  const make = (
    type: Transaction['type'],
    participants: Transaction['participants'],
    extra: Partial<Transaction> = {},
  ): Transaction => ({
    id: 't',
    gameId: 'game',
    type,
    amount: 10,
    totalAmount: 30,
    comment: null,
    createdAt: '',
    participants,
    ...extra,
  });
  const payment: Transaction['participants'] = [
    { playerId: 'ann', balanceDelta: -10 },
    { playerId: 'bob', balanceDelta: 10 },
  ];
  const payerOnly: Transaction['participants'] = [{ playerId: 'ann', balanceDelta: -10 }];
  const receiverOnly: Transaction['participants'] = [{ playerId: 'bob', balanceDelta: 10 }];

  it.each([
    ['PLAYER_TO_PLAYER', payment, 'Ann → Bob', 'Ann → Bob', '$10'],
    ['PAY_RENT', payment, 'Ann → Bob · Rent', 'Ann → Bob · Rent · Zhitna', '$10'],
    [
      'PROPERTY_PURCHASE',
      payerOnly,
      'Ann · Property purchase',
      'Ann · Property purchase · Zhitna',
      '$10',
    ],
    ['PROPERTY_BUILD', payerOnly, 'Ann · Building', 'Ann · Building · Zhitna', '$10'],
    [
      'PROPERTY_SELL_BUILDING',
      receiverOnly,
      'Bob · Building sold',
      'Bob · Building sold · Zhitna',
      '+$10',
    ],
    ['PLAYER_TO_BANK', payerOnly, 'Ann → Bank', 'Ann → Bank', '$10'],
    ['BANK_TO_PLAYER', receiverOnly, 'Bank → Bob', 'Bank → Bob', '$10'],
    ['PLAYER_TO_ALL', payerOnly, 'Ann → Everyone', 'Ann → Everyone', '$10 each · $30 total'],
    ['ALL_TO_PLAYER', receiverOnly, 'Everyone → Bob', 'Everyone → Bob', '$10 each · $30 total'],
    ['PASS_GO', receiverOnly, 'Bob · Passed GO', 'Bob · Passed GO', '+$10'],
    ['MORTGAGE', receiverOnly, 'Bob · Mortgage', 'Bob · Mortgage · Zhitna', '+$10'],
    [
      'MORTGAGE_REDEMPTION',
      payerOnly,
      'Ann · Mortgage redeemed',
      'Ann · Mortgage redeemed · Zhitna',
      '$10',
    ],
    ['LOAN_ISSUE', payment, 'Ann lent to Bob', 'Ann lent to Bob', '$10'],
    ['LOAN_REPAYMENT', payment, 'Ann repaid Bob', 'Ann repaid Bob', '$10'],
    ['TO_JACKPOT', payerOnly, 'Ann paid to Free Parking', 'Ann paid to Free Parking', '$10'],
    [
      'JACKPOT_PAYOUT',
      receiverOnly,
      'Bob collected the Free Parking pot',
      'Bob collected the Free Parking pot',
      '+$10',
    ],
    ['AUCTION_PAYMENT', payerOnly, 'Ann won an auction', 'Ann won the auction for Zhitna', '$10'],
    [
      'BANKRUPTCY_TRANSFER',
      payment,
      'Ann declared bankruptcy to Bob',
      'Ann declared bankruptcy to Bob',
      '$10',
    ],
    ['REVERSAL', payment, 'Reversal · Ann → Bob', 'Reversal · Ann → Bob', '$30'],
    ['PROPERTY_TRANSFER', payment, 'Ann ⇄ Bob · Trade', 'Ann ⇄ Bob · Trade · Zhitna', '$10'],
  ] as const)(
    '%s reads %j without and with a tile',
    (type, participants, plain, withTile, amount) => {
      const item = make(type, [...participants]);
      expect(transactionDescription(item, ledgerPlayers)).toBe(plain);
      expect(transactionDescription(item, ledgerPlayers, 'en', 'Zhitna')).toBe(withTile);
      expect(transactionAmount(item, 'USD')).toBe(amount);
    },
  );

  it('words the other language for the same types', () => {
    expect(transactionDescription(make('PLAYER_TO_BANK', payerOnly), ledgerPlayers, 'uk')).toBe(
      'Ann → Банк',
    );
    expect(transactionDescription(make('BANK_TO_PLAYER', receiverOnly), ledgerPlayers, 'uk')).toBe(
      'Банк → Bob',
    );
    expect(transactionDescription(make('PLAYER_TO_ALL', payerOnly), ledgerPlayers, 'uk')).toBe(
      'Ann → Усі',
    );
    expect(transactionDescription(make('ALL_TO_PLAYER', receiverOnly), ledgerPlayers, 'uk')).toBe(
      'Усі → Bob',
    );
    expect(transactionDescription(make('PASS_GO', receiverOnly), ledgerPlayers, 'uk')).toBe(
      'Bob · Проходження СТАРТУ',
    );
    expect(transactionAmount(make('PLAYER_TO_ALL', payerOnly), 'USD', 'uk')).toBe(
      '$10 кожен · $30 загалом',
    );
  });

  it('uses the stand-in name for a participant who is not at the table or is missing', () => {
    const stranger = [
      { playerId: 'ghost', balanceDelta: -10 },
      { playerId: 'nobody', balanceDelta: 10 },
    ];
    expect(transactionDescription(make('PLAYER_TO_PLAYER', stranger), ledgerPlayers)).toBe(
      'Player → Player',
    );
    expect(transactionDescription(make('PLAYER_TO_PLAYER', []), ledgerPlayers)).toBe(
      'Player → Player',
    );
    expect(transactionDescription(make('PLAYER_TO_BANK', []), ledgerPlayers)).toBe('Player → Bank');
    expect(transactionDescription(make('BANK_TO_PLAYER', []), ledgerPlayers)).toBe('Bank → Player');
    expect(transactionDescription(make('PLAYER_TO_ALL', []), ledgerPlayers)).toBe(
      'Player → Everyone',
    );
    expect(transactionDescription(make('ALL_TO_PLAYER', []), ledgerPlayers)).toBe(
      'Everyone → Player',
    );
    expect(transactionDescription(make('PASS_GO', []), ledgerPlayers)).toBe('Player · Passed GO');
    expect(transactionDescription(make('PAY_RENT', []), ledgerPlayers)).toBe(
      'Player → Player · Rent',
    );
    expect(transactionDescription(make('PROPERTY_PURCHASE', []), ledgerPlayers)).toBe(
      'Player · Property purchase',
    );
    expect(transactionDescription(make('PROPERTY_BUILD', []), ledgerPlayers)).toBe(
      'Player · Building',
    );
    expect(transactionDescription(make('PROPERTY_SELL_BUILDING', []), ledgerPlayers)).toBe(
      'Player · Building sold',
    );
    expect(transactionDescription(make('MORTGAGE', []), ledgerPlayers)).toBe('Player · Mortgage');
    expect(transactionDescription(make('MORTGAGE_REDEMPTION', []), ledgerPlayers)).toBe(
      'Player · Mortgage redeemed',
    );
    expect(transactionDescription(make('JACKPOT_PAYOUT', []), ledgerPlayers)).toBe(
      'Player collected the Free Parking pot',
    );
    expect(transactionDescription(make('BANKRUPTCY_TRANSFER', []), ledgerPlayers)).toBe(
      'Player declared bankruptcy to Player',
    );
  });

  it('does not take a participant with no change for the payer or the receiver', () => {
    const withZero = [{ playerId: 'cat', balanceDelta: 0 }, ...payment];
    expect(transactionDescription(make('PLAYER_TO_PLAYER', withZero), ledgerPlayers)).toBe(
      'Ann → Bob',
    );
    expect(transactionDescription(make('PAY_RENT', withZero), ledgerPlayers)).toBe(
      'Ann → Bob · Rent',
    );
    expect(transactionDescription(make('LOAN_ISSUE', withZero), ledgerPlayers)).toBe(
      'Ann lent to Bob',
    );
    expect(
      transactionDescription(
        make('REVERSAL', [{ playerId: 'cat', balanceDelta: 0 }, ...payment]),
        ledgerPlayers,
      ),
    ).toBe('Reversal · Ann → Bob');
  });

  it('names a loan from the bank and a repayment to the bank without a counterpart', () => {
    expect(transactionDescription(make('LOAN_ISSUE', receiverOnly), ledgerPlayers)).toBe(
      'Bob borrowed from the bank',
    );
    expect(transactionDescription(make('LOAN_REPAYMENT', payerOnly), ledgerPlayers)).toBe(
      'Ann repaid the bank loan',
    );
    expect(transactionDescription(make('LOAN_ISSUE', payerOnly), ledgerPlayers)).toBe(
      'Ann lent to Player',
    );
    expect(transactionDescription(make('LOAN_REPAYMENT', receiverOnly), ledgerPlayers)).toBe(
      'Player repaid Bob',
    );
  });

  it('names the pot payment after its trimmed comment, or leaves it unnamed', () => {
    expect(
      transactionDescription(
        make('TO_JACKPOT', payerOnly, { comment: '  Income tax  ' }),
        ledgerPlayers,
      ),
    ).toBe('Ann paid Income tax to Free Parking');
    for (const comment of [null, '', '   '])
      expect(
        transactionDescription(make('TO_JACKPOT', payerOnly, { comment }), ledgerPlayers),
      ).toBe('Ann paid to Free Parking');
    expect(transactionDescription(make('TO_JACKPOT', [], { comment: 'Tax' }), ledgerPlayers)).toBe(
      'Player paid Tax to Free Parking',
    );
  });

  it('names an auction payment after the tile, the trimmed lot name, or leaves it unnamed', () => {
    expect(
      transactionDescription(
        make('AUCTION_PAYMENT', payerOnly, { comment: '  Park Lane ' }),
        ledgerPlayers,
      ),
    ).toBe('Ann won the auction for Park Lane');
    for (const comment of [null, '', '   '])
      expect(
        transactionDescription(make('AUCTION_PAYMENT', payerOnly, { comment }), ledgerPlayers),
      ).toBe('Ann won an auction');
    expect(
      transactionDescription(
        make('AUCTION_PAYMENT', payerOnly, { comment: 'Park Lane' }),
        ledgerPlayers,
        'en',
        'Zhitna',
      ),
    ).toBe('Ann won the auction for Zhitna');
    expect(
      transactionDescription(make('AUCTION_PAYMENT', [], { comment: 'X' }), ledgerPlayers),
    ).toBe('Player won the auction for X');
  });

  it('shows a trade between the initiator and the other trader, and falls back to the payer', () => {
    const swap = [
      { playerId: 'ann', balanceDelta: 0 },
      { playerId: 'bob', balanceDelta: 0 },
    ];
    expect(
      transactionDescription(
        make('PROPERTY_TRANSFER', swap, { initiatorPlayerId: 'bob' }),
        ledgerPlayers,
      ),
    ).toBe('Bob ⇄ Ann · Trade');
    expect(transactionDescription(make('PROPERTY_TRANSFER', swap), ledgerPlayers)).toBe(
      'Player ⇄ Ann · Trade',
    );
    expect(transactionDescription(make('PROPERTY_TRANSFER', payment), ledgerPlayers)).toBe(
      'Ann ⇄ Bob · Trade',
    );
    expect(
      transactionDescription(
        make('PROPERTY_TRANSFER', swap, { initiatorPlayerId: null }),
        ledgerPlayers,
      ),
    ).toBe('Player ⇄ Ann · Trade');
  });

  it('reads a reversal with no payer or no receiver as the bank, and many as everyone', () => {
    const reversal = (participants: Transaction['participants']) =>
      transactionDescription(make('REVERSAL', participants), ledgerPlayers);
    expect(reversal(receiverOnly)).toBe('Reversal · Bank → Bob');
    expect(reversal(payerOnly)).toBe('Reversal · Ann → Bank');
    expect(
      reversal([
        { playerId: 'ann', balanceDelta: -5 },
        { playerId: 'bob', balanceDelta: -5 },
        { playerId: 'cat', balanceDelta: 10 },
      ]),
    ).toBe('Reversal · Everyone → Cat');
    expect(
      reversal([
        { playerId: 'ann', balanceDelta: -10 },
        { playerId: 'bob', balanceDelta: 5 },
        { playerId: 'cat', balanceDelta: 5 },
      ]),
    ).toBe('Reversal · Ann → Everyone');
    expect(reversal([])).toBe('Reversal · Bank → Bank');
  });

  it('shows the amount of a reversal as the total and of other types as the amount', () => {
    expect(
      transactionAmount(make('REVERSAL', payment, { amount: 5, totalAmount: 50 }), 'USD'),
    ).toBe('$50');
    expect(
      transactionAmount(make('PLAYER_TO_BANK', payerOnly, { amount: 5, totalAmount: 50 }), 'USD'),
    ).toBe('$5');
  });

  it('shows the change of one player, signed, or nothing for a player who took no part', () => {
    expect(playerTransactionAmount(make('PLAYER_TO_PLAYER', payment), 'ann', 'USD')).toBe('−$10');
    expect(playerTransactionAmount(make('PLAYER_TO_PLAYER', payment), 'bob', 'USD')).toBe('+$10');
    expect(playerTransactionAmount(make('PLAYER_TO_PLAYER', payment), 'cat', 'USD')).toBeNull();
    expect(
      playerTransactionAmount(
        make('PROPERTY_TRANSFER', [{ playerId: 'ann', balanceDelta: 0 }]),
        'ann',
        'USD',
      ),
    ).not.toBeNull();
  });
});
