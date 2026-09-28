import type { Currency } from '../../../shared/types/monopoly';
import { formatMoney, formatMoneyDelta } from '../../utils/money';

export interface MoneyValueProps {
  amount: number;
  currency: Currency;
  /** Render a signed change (`+…` / `−…`) instead of a plain amount. */
  signed?: boolean;
}

/** A monetary amount as text, formatted only by `src/utils/money.ts`. */
export function MoneyValue({ amount, currency, signed = false }: MoneyValueProps) {
  return <>{signed ? formatMoneyDelta(amount, currency) : formatMoney(amount, currency)}</>;
}
