import { describe, expect, it } from 'vitest';
import { defaultGameRules } from '../../shared/types/monopoly';
import { fillRulesText, rulesContent, rulesForGame, type RulesValues } from './game-rules';

const values: RulesValues = {
  startingBalance: '1 500',
  passGoReward: '200',
  doubleGoReward: '400',
  unit: '10',
  incomeTax: '200',
  luxuryTax: '100',
  jailFine: '50',
  bankLoanMax: '200',
  auctionMinBid: '10',
  auctionBidSteps: '10, 25',
  reversalMinutes: '15',
};

describe('game rules content', () => {
  it('shows only the basics and mortgages when no house rule is on', () => {
    const ids = rulesForGame('en', defaultGameRules, values).map((section) => section.id);
    expect(ids).toEqual(['basic', 'mortgages']);
  });

  it('adds the enabled house rules with the game values', () => {
    const sections = rulesForGame('en', { ...defaultGameRules, auctions: true }, values);
    const auctions = sections.find((section) => section.id === 'auctions');
    expect(auctions?.paragraphs.join(' ')).toContain('10, 25');
  });

  it('leaves no placeholder unfilled in either language', () => {
    const all = { ...defaultGameRules, playerLoans: true, bankLoans: true, auctions: true };
    for (const language of ['en', 'uk'] as const) {
      const text = JSON.stringify(
        rulesForGame(
          language,
          { ...all, doubleRewardOnExactGo: true, freeParkingJackpot: true },
          values,
        ),
      );
      expect(text).not.toMatch(/\{\w+\}/);
    }
  });

  it('has the same sections in both languages', () => {
    expect(rulesContent.uk.map((s) => s.id)).toEqual(rulesContent.en.map((s) => s.id));
  });

  it('keeps an unknown token visible', () => {
    expect(fillRulesText('{nope}', values)).toBe('{nope}');
  });
});
