import { buildGameSettings } from '../../shared/domain/game-rules';
import { REVERSAL_WINDOW_MS } from '../../shared/domain/reversal';
import type { Currency, GameRuleKey, GameSettings } from '../../shared/types/monopoly';
import { formatMoney } from '../utils/money';
import type { Language } from '../i18n/translations';

/*
 * The in-game rulebook. Edit the text here only; `RulesScreen` renders it offline from the bundle.
 * `{token}` placeholders are replaced with the game's own values (see `RulesValues`). A section with
 * a `rule` is shown only when that house rule is on for the game; `mortgages` is always part of the
 * game. Paragraphs are plain text; a `bullets` list follows them.
 */

export type RulesSectionId = 'basic' | 'mortgages' | GameRuleKey;

export interface RulesSection {
  id: RulesSectionId;
  /** Shown only while this house rule is enabled. */
  rule?: GameRuleKey;
  title: string;
  /** One line shown next to the rule's switch when a game is created. */
  summary?: string;
  paragraphs: string[];
  bullets?: string[];
}

/** Values substituted for `{token}`s; every one is already formatted for display. */
export interface RulesValues {
  startingBalance: string;
  passGoReward: string;
  doubleGoReward: string;
  unit: string;
  incomeTax: string;
  luxuryTax: string;
  jailFine: string;
  bankLoanMax: string;
  auctionMinBid: string;
  auctionBidSteps: string;
  reversalMinutes: string;
}

const english: RulesSection[] = [
  {
    id: 'basic',
    title: 'Basic rules',
    paragraphs: [
      'Monopoly Bank only keeps the money honest. The players still run the board: dice, moves, properties and deals happen at the table.',
      'Everyone starts with {startingBalance}. Passing GO pays {passGoReward} from the bank.',
    ],
    bullets: [
      'Every payment is reviewed before it is sent: who pays, who receives, the amount and the resulting balances.',
      'A payment that a wallet cannot afford is rejected and nothing changes.',
      'History is never edited. A mistake is fixed with a reversal, which moves exactly the same money back. The game owner can reverse any transaction; a player can reverse their own within {reversalMinutes} minutes.',
      'A reversal, a bankruptcy transfer, a mortgage step, a loan step and a Free Parking payment cannot be reversed.',
      'Going bankrupt hands the wallet to the creditor or to the bank. A bankrupt player no longer takes part in payments.',
      'The game owner finishes the game. Every player who is not bankrupt wins; the statistics also rank the players by cash.',
    ],
  },
  {
    id: 'doubleRewardOnExactGo',
    rule: 'doubleRewardOnExactGo',
    title: 'Double reward on exact GO',
    summary: 'Landing exactly on GO pays {doubleGoReward} instead of {passGoReward}.',
    paragraphs: [
      'A token that lands exactly on GO earns twice the usual reward: {doubleGoReward} instead of {passGoReward}.',
    ],
    bullets: [
      'Use the “Landed exactly on GO (double)” action in the wallet. Passing GO without landing on it pays the normal reward.',
      'The players agree at the table whether the token really landed on GO.',
    ],
  },
  {
    id: 'playerLoans',
    rule: 'playerLoans',
    title: 'Player loans',
    summary: 'Players lend to each other with no interest; the lender must accept.',
    paragraphs: [
      'A player can borrow money from another player. The borrower asks, and the loan exists only after the lender accepts, in every payment mode.',
    ],
    bullets: [
      'A loan carries no interest. The borrower repays any part of it whenever they like.',
      'If a borrower goes bankrupt, their debts are written off. Loans they made pass to their creditor, or are written off if the creditor is the borrower or the bank.',
      'Loan payments do not count as money sent or received in the statistics.',
    ],
  },
  {
    id: 'bankLoans',
    rule: 'bankLoans',
    title: 'Bank loans',
    summary: 'Borrow up to {bankLoanMax} from the bank; interest grows each round.',
    paragraphs: [
      'A player can borrow up to {bankLoanMax} from the bank. The money is paid out at once. Each player can have one bank loan at a time.',
      'The loan is repaid in full, with interest on the amount borrowed. The interest leaves the game.',
    ],
    bullets: [
      'Interest depends on the round: 0% in the first round, 10% in the second and 20% in the third. The third round is the last one to repay on time. The app works out the round from the order of operations in the history. It is a hint, not a turn order, and you confirm the rate when repaying.',
      'From the fourth round the loan is shown as overdue.',
      'After repaying, borrowing again within 2 rounds needs an explicit acknowledgement.',
      'If a borrower goes bankrupt, the bank is paid first from their wallet (the amount borrowed, then interest). The creditor gets the rest.',
    ],
  },
  {
    id: 'freeParkingJackpot',
    rule: 'freeParkingJackpot',
    title: 'Free Parking jackpot',
    summary: 'Taxes ({incomeTax}, {luxuryTax}) feed a pot that Free Parking collects.',
    paragraphs: [
      'Taxes feed a pot instead of the bank. Income tax ({incomeTax}) and luxury tax ({luxuryTax}) go into the pot; the jail fine ({jailFine}) is still paid to the bank.',
      'A player who lands on Free Parking takes the whole pot.',
    ],
    bullets: [
      'The pot starts at zero and is shown at the top of the game.',
      'Before collecting, you review the pot. If it changed in the meantime, the app asks you to check again.',
      'Paying into the pot and collecting it cannot be reversed. A bankruptcy leaves the pot untouched.',
    ],
  },
  {
    id: 'auctions',
    rule: 'auctions',
    title: 'Auctions',
    summary: 'Put a property up for a 30-second auction; the leading bid is reserved.',
    paragraphs: [
      'Any player can put a property up for auction. Only the name of the lot and the money are recorded; the app does not track who owns what.',
      'Bidding lasts 30 seconds. A bid placed in the last 10 seconds extends the auction to 10 seconds from that bid; an earlier bid does not change the end. The minimum bid is {auctionMinBid}, and each bid raises the price by one of these steps: {auctionBidSteps}.',
    ],
    bullets: [
      'The leading bid is reserved on the leader’s wallet: they cannot spend that money elsewhere while they lead. Being outbid releases it.',
      'You cannot outbid yourself. Only one auction runs at a time.',
      'When time is up, the leader pays the bank and the lot is sold. With no bid, or if the leader can no longer pay, there is no sale.',
      'A sale can be reversed like any payment to the bank.',
    ],
  },
  {
    id: 'mortgages',
    title: 'Mortgages',
    paragraphs: [
      'A player can mortgage a property to the bank. Enter the property name and the mortgage value from its card; the bank pays that amount.',
      'To redeem it, the player pays the mortgage value plus 10%.',
    ],
    bullets: [
      'A player can have one active mortgage per property name.',
      'The app only remembers which properties are mortgaged, not who owns them. When you pay rent to a player, their mortgaged properties are shown as a reminder; the app does not enforce rent.',
      'If a player goes bankrupt, their mortgages pass to the creditor, who can redeem them. With a bankruptcy to the bank they are released.',
      'Mortgage and redemption cannot be reversed.',
    ],
  },
];

const ukrainian: RulesSection[] = [
  {
    id: 'basic',
    title: 'Основні правила',
    paragraphs: [
      'Monopoly Bank лише чесно веде облік грошей. Грою за столом керують гравці: кубики, ходи, власність та угоди залишаються на дошці.',
      'Кожен починає з {startingBalance}. Проходження СТАРТУ приносить {passGoReward} від банку.',
    ],
    bullets: [
      'Кожен платіж перевіряється перед відправленням: хто платить, хто отримує, сума та підсумкові баланси.',
      'Платіж, на який у гаманці не вистачає коштів, відхиляється, і нічого не змінюється.',
      'Історію не редагують. Помилку виправляє сторно, яке повертає рівно ті самі гроші. Власник гри може сторнувати будь-яку операцію, а гравець — свою протягом {reversalMinutes} хв.',
      'Сторно, передачу при банкрутстві, кроки іпотеки й позик та платежі «Безкоштовної стоянки» сторнувати не можна.',
      'Банкрутство передає гаманець кредитору або банку. Банкрут більше не бере участі в платежах.',
      'Гру завершує власник гри. Перемагають усі гравці, які не збанкрутіли; у статистиці гравців також упорядковано за готівкою.',
    ],
  },
  {
    id: 'doubleRewardOnExactGo',
    rule: 'doubleRewardOnExactGo',
    title: 'Подвійна винагорода за точне потрапляння на СТАРТ',
    summary: 'Точне потрапляння на СТАРТ приносить {doubleGoReward} замість {passGoReward}.',
    paragraphs: [
      'Фішка, що зупинилась точно на СТАРТІ, отримує подвійну винагороду: {doubleGoReward} замість {passGoReward}.',
    ],
    bullets: [
      'Скористайтеся дією «Точно на СТАРТі (подвійно)» у гаманці. Проходження СТАРТУ без зупинки платить звичайну винагороду.',
      'Чи справді фішка зупинилась на СТАРТІ, гравці домовляються за столом.',
    ],
  },
  {
    id: 'playerLoans',
    rule: 'playerLoans',
    title: 'Позики між гравцями',
    summary: 'Гравці позичають одне одному без відсотків; позикодавець має підтвердити.',
    paragraphs: [
      'Гравець може позичити гроші в іншого гравця. Позичальник робить запит, і позика з’являється лише після того, як кредитор її прийме, в будь-якому режимі платежів.',
    ],
    bullets: [
      'Позика без відсотків. Позичальник повертає будь-яку частину, коли захоче.',
      'Якщо позичальник збанкрутує, його борги списуються. Позики, які він видав, переходять його кредитору або списуються, якщо кредитор — сам позичальник чи банк.',
      'Платежі за позиками не враховуються у статистиці як надіслані чи отримані гроші.',
    ],
  },
  {
    id: 'bankLoans',
    rule: 'bankLoans',
    title: 'Позики банку',
    summary: 'Позика в банку до {bankLoanMax}; відсотки зростають з кожним колом.',
    paragraphs: [
      'Гравець може взяти в банку до {bankLoanMax}. Гроші видаються одразу. Кожен гравець може мати одну позику банку одночасно.',
      'Позику повертають повністю, зі відсотками від позиченої суми. Відсотки виходять із гри.',
    ],
    bullets: [
      'Відсотки залежать від кола: 0% у першому, 10% у другому й 20% у третьому. Третє коло — останнє, щоб повернути позику вчасно. Застосунок визначає коло за порядком операцій в історії. Це підказка, а не черга ходів; ставку ви підтверджуєте під час повернення.',
      'З четвертого кола позика позначається як прострочена.',
      'Якщо після повернення брати позику знову протягом 2 кіл, потрібне явне підтвердження.',
      'Якщо позичальник збанкрутує, банк отримує гроші першим із гаманця (позичена сума, потім відсотки). Решту отримує кредитор.',
    ],
  },
  {
    id: 'freeParkingJackpot',
    rule: 'freeParkingJackpot',
    title: 'Джекпот «Безкоштовної стоянки»',
    summary: 'Податки ({incomeTax}, {luxuryTax}) йдуть у фонд, який забирає «Безкоштовна стоянка».',
    paragraphs: [
      'Податки наповнюють банк-скарбничку замість банку. Прибутковий податок ({incomeTax}) і податок на розкіш ({luxuryTax}) ідуть у скарбничку; штраф за в’язницю ({jailFine}) і далі сплачується банку.',
      'Гравець, що потрапив на «Безкоштовну стоянку», забирає всю скарбничку.',
    ],
    bullets: [
      'Скарбничка починається з нуля й показана нагорі гри.',
      'Перед отриманням ви переглядаєте суму. Якщо вона змінилась, застосунок попросить перевірити ще раз.',
      'Внесок у скарбничку й отримання її не можна сторнувати. Банкрутство скарбничку не чіпає.',
    ],
  },
  {
    id: 'auctions',
    rule: 'auctions',
    title: 'Аукціони',
    summary: 'Виставте нерухомість на 30-секундний аукціон; найвища ставка резервується.',
    paragraphs: [
      'Будь-який гравець може виставити власність на аукціон. Записуються лише назва лота та гроші; застосунок не відстежує, хто чим володіє.',
      'Торги тривають 30 секунд. Ставка в останні 10 секунд подовжує торги до 10 секунд від цієї ставки; раніша ставка кінець не змінює. Мінімальна ставка — {auctionMinBid}, а кожна ставка підвищує ціну на один із кроків: {auctionBidSteps}.',
    ],
    bullets: [
      'Найвища ставка резервується в гаманці лідера: поки він лідирує, цих грошей він витратити не може. Коли ставку перебили, резерв знімається.',
      'Перебивати власну ставку не можна. Одночасно триває лише один аукціон.',
      'Коли час спливає, лідер платить банку, і лот продано. Без ставок або якщо лідер уже не може заплатити, продажу немає.',
      'Продаж можна сторнувати, як і будь-який платіж банку.',
    ],
  },
  {
    id: 'mortgages',
    title: 'Іпотека',
    paragraphs: [
      'Гравець може закласти власність банку. Вкажіть назву власності та заставну вартість з її картки; банк виплачує цю суму.',
      'Щоб викупити, гравець платить заставну вартість плюс 10%.',
    ],
    bullets: [
      'Гравець може мати одну активну іпотеку на одну назву власності.',
      'Застосунок пам’ятає лише, які власності закладені, а не хто ними володіє. Коли ви платите ренту гравцеві, його закладені власності показуються як нагадування; рента не контролюється.',
      'Якщо гравець збанкрутує, його іпотеки переходять кредитору, який може їх викупити. У разі банкрутства перед банком їх знімають.',
      'Іпотеку та викуп сторнувати не можна.',
    ],
  },
];

export const rulesContent: Record<Language, RulesSection[]> = {
  en: english,
  uk: ukrainian,
};

/** Replaces each `{token}`; an unknown token is left as written so a typo stays visible. */
/** The house rules' one-line summaries, filled with the game's values, in rulebook order. */
export function ruleSummaries(
  language: Language,
  values: RulesValues,
): Partial<Record<GameRuleKey, string>> {
  const summaries: Partial<Record<GameRuleKey, string>> = {};
  for (const section of rulesContent[language]) {
    if (section.rule !== undefined && section.summary !== undefined)
      summaries[section.rule] = fillRulesText(section.summary, values);
  }
  return summaries;
}

/** The values a game's money amounts put into the rules text; settings derive from the starting balance. */
export function buildRulesValues(
  startingBalance: number,
  passGoReward: number,
  currency: Currency,
  settings: GameSettings = buildGameSettings(startingBalance),
): RulesValues {
  const money = (amount: number) => formatMoney(amount, currency);
  return {
    startingBalance: money(startingBalance),
    passGoReward: money(passGoReward),
    doubleGoReward: money(passGoReward * 2),
    unit: money(settings.unit),
    incomeTax: money(settings.incomeTax),
    luxuryTax: money(settings.luxuryTax),
    jailFine: money(settings.jailFine),
    bankLoanMax: money(settings.bankLoanMax),
    auctionMinBid: money(settings.auctionMinBid),
    auctionBidSteps: settings.auctionBidSteps.map(money).join(', '),
    reversalMinutes: String(REVERSAL_WINDOW_MS / 60_000),
  };
}

export function fillRulesText(text: string, values: RulesValues): string {
  return text.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in values ? values[key as keyof RulesValues] : match,
  );
}

/** The sections that apply to a game: the basics, enabled house rules, then mortgages. */
export function rulesForGame(
  language: Language,
  rules: Record<GameRuleKey, boolean>,
  values: RulesValues,
): RulesSection[] {
  return rulesContent[language]
    .filter((section) => section.rule === undefined || rules[section.rule])
    .map((section) => ({
      ...section,
      title: fillRulesText(section.title, values),
      ...(section.summary === undefined ? {} : { summary: fillRulesText(section.summary, values) }),
      paragraphs: section.paragraphs.map((text) => fillRulesText(text, values)),
      ...(section.bullets === undefined
        ? {}
        : { bullets: section.bullets.map((text) => fillRulesText(text, values)) }),
    }));
}
