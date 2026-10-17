import type { BoardSnapshot } from '../../../shared/board';
import type { Currency, Player } from '../../../shared/types/monopoly';
import { useLanguage } from '../../i18n/language-context';
import { formatMoney } from '../../utils/money';
import { propertyGroupColors, type TileView } from '../../utils/property-view';
import { tradeOutcome } from '../../utils/trade-view';
import { Notice } from '../ui';

export interface TradeSummaryProps {
  board: BoardSnapshot;
  currency: Currency;
  proposer: Player;
  counterparty: Player;
  /** The tiles the proposer hands over / receives. */
  giveViews: readonly TileView[];
  takeViews: readonly TileView[];
  cashGive: number;
  cashTake: number;
}

function Side({
  name,
  views,
  cash,
  currency,
}: {
  name: string;
  views: readonly TileView[];
  cash: number;
  currency: Currency;
}) {
  const { t } = useLanguage();
  return (
    <section className="grid content-start gap-(--mb-space-2) rounded-compact border border-border bg-surface-subtle p-(--mb-space-3)">
      <h4 className="m-0 text-small font-semibold text-secondary">{t('tradeYouGive', { name })}</h4>
      {views.length === 0 && cash === 0 && <p className="m-0 font-semibold">{t('tradeNothing')}</p>}
      {views.length > 0 && (
        <ul className="m-0 grid list-none gap-(--mb-space-1) p-0">
          {views.map((view) => (
            <li key={view.tile.id} className="flex items-center gap-(--mb-space-2) font-semibold">
              <span
                aria-hidden="true"
                className="inline-block size-3 shrink-0 rounded-full border border-border"
                style={{ backgroundColor: propertyGroupColors[view.tile.group] }}
              />
              <span className="min-w-0 wrap-anywhere">{view.tile.name}</span>
              {view.mortgaged && <small className="text-secondary">{t('propertyMortgaged')}</small>}
            </li>
          ))}
        </ul>
      )}
      {cash > 0 && (
        <p className="m-0 font-money font-semibold tabular-nums">
          {t('tradeCashAmount', { amount: formatMoney(cash, currency) })}
        </p>
      )}
    </section>
  );
}

/**
 * The review of a trade, shared by the proposer's confirmation and the counterparty's accept
 * sheet: what moves each way, a notice when one side gives nothing, the 10% mortgage fees and
 * both balances after.
 */
export function TradeSummary({
  board,
  currency,
  proposer,
  counterparty,
  giveViews,
  takeViews,
  cashGive,
  cashTake,
}: TradeSummaryProps) {
  const { t } = useLanguage();
  const outcome = tradeOutcome(board, giveViews, takeViews, cashGive, cashTake);
  const money = (amount: number) => formatMoney(amount, currency);
  const signed = (amount: number) => `${amount < 0 ? '−' : '+'}${money(Math.abs(amount))}`;
  const gives = (views: readonly TileView[], cash: number) => views.length + cash > 0;
  const gift =
    gives(giveViews, cashGive) !== gives(takeViews, cashTake)
      ? gives(giveViews, cashGive)
        ? { giver: proposer, receiver: counterparty }
        : { giver: counterparty, receiver: proposer }
      : null;
  return (
    <div className="grid gap-(--mb-space-3)">
      <div className="grid grid-cols-2 gap-(--mb-space-2) max-md:grid-cols-1">
        <Side name={proposer.name} views={giveViews} cash={cashGive} currency={currency} />
        <Side name={counterparty.name} views={takeViews} cash={cashTake} currency={currency} />
      </div>
      {gift !== null && (
        <Notice tone="info" className="mb-0! p-(--mb-space-3)!">
          {t('tradeGiftNotice', { giver: gift.giver.name, receiver: gift.receiver.name })}
        </Notice>
      )}
      {[
        [proposer, outcome.proposerFee],
        [counterparty, outcome.counterpartyFee],
      ].map(([who, fee]) =>
        (fee as number) > 0 ? (
          <Notice key={(who as Player).id} tone="info" className="mb-0! p-(--mb-space-3)!">
            {t('tradeFeeNotice', { name: (who as Player).name, amount: money(fee as number) })}
          </Notice>
        ) : null,
      )}
      <ul className="m-0 grid list-none gap-(--mb-space-1) p-0">
        {[
          [proposer, outcome.proposerDelta],
          [counterparty, outcome.counterpartyDelta],
        ].map(([who, delta]) => (
          <li
            key={(who as Player).id}
            className="flex items-baseline justify-between gap-(--mb-space-3)"
          >
            <span>{(who as Player).name}</span>
            <span className="font-money tabular-nums">
              <span className="text-secondary">
                {t('tradeBalanceChange', {
                  delta: signed(delta as number),
                })}
              </span>{' '}
              <strong>{money((who as Player).balance + (delta as number))}</strong>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
