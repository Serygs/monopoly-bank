import type { Currency } from '../../shared/types/monopoly';

/** Formats the integer-thousands values stored by Monopoly Bank for display. */
export function formatThousands(value: number): string {
  return Math.abs(value)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
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
  return `${value >= 0 ? '+' : '-'}${formatMoney(Math.abs(value), currency)}`;
}
