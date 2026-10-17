import type { Currency } from '../../shared/types/monopoly';

/** Groups the whole-unit integer amounts stored by Monopoly Bank for display. */
export function formatThousands(value: number): string {
  return Math.abs(value)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

/** The decimal separator of a locale: `,` for uk-UA, `.` for en-US. */
export function decimalSeparator(locale: string): string {
  return new Intl.NumberFormat(locale).format(1.1).charAt(1);
}

export function formatMoney(value: number, currency: Currency): string {
  const sign = value < 0 ? '-' : '';
  const amount = `${sign}${formatThousands(value)}`;
  switch (currency) {
    case 'USD':
      return `$${amount}`;
    case 'EUR':
      return `€${amount}`;
    case 'UAH':
      return `₴${amount}`;
    case 'K':
      return `${amount}k`;
  }
}

export function formatMoneyDelta(value: number, currency: Currency): string {
  return `${value >= 0 ? '+' : '\u2212'}${formatMoney(Math.abs(value), currency)}`;
}

export type MoneyTone = 'income' | 'expense' | 'neutral';

export function moneyTone(value: number): MoneyTone {
  if (value > 0) return 'income';
  if (value < 0) return 'expense';
  return 'neutral';
}
