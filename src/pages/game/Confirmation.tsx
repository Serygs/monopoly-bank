import type { Currency, Player } from '../../../shared/types/monopoly';
import { cx } from '../../components/ui/class-names';
import { useLanguage } from '../../i18n/language-context';
import { formatMoney, formatMoneyDelta } from '../../utils/money';
import {
  destinationFor,
  sourceFor,
  transactionLabel,
  type ActionType,
  type BalancePreview,
} from './game-page-helpers';

export interface ConfirmationProps {
  action: ActionType;
  player: Player;
  target: Player | null;
  amount: number;
  passGoReward: number;
  currency: Currency;
  preview: BalancePreview[];
  comment: string;
}

/** Summary rows (label left, value right) and the resulting-balances list with colour dots. */
const confirmationClass = cx(
  '[&_dl]:m-0 [&_dl>div]:flex [&_dl>div]:justify-between [&_dl>div]:gap-[16px] [&_dl>div]:border-b [&_dl>div]:border-b-border [&_dl>div]:px-0 [&_dl>div]:py-[10px]',
  '[&_dt]:text-secondary [&_dd]:m-0 [&_dd]:text-right [&_dd]:font-semibold',
  '[&_h3]:mx-0 [&_h3]:mt-[22px] [&_h3]:mb-[10px] [&_h3]:text-[1rem]',
  '[&_ul]:m-0 [&_ul]:grid [&_ul]:list-none [&_ul]:gap-[8px] [&_ul]:p-0',
  '[&_li]:flex [&_li]:justify-between [&_li]:gap-[10px] [&_li]:px-0 [&_li]:py-[8px]',
  '[&_li>span]:flex [&_li>span]:items-center [&_li>span]:gap-[8px] [&_i]:size-[10px] [&_i]:rounded-[50%]',
);
/** The resulting available balance row; `!` beats the shared row padding above. */
const availableClass =
  'mt-[8px] border-t-2 border-t-accent pt-[12px]! [&>dd]:text-[1.1rem] [&>dd]:text-primary';

export function Confirmation({
  action,
  player,
  target,
  amount,
  passGoReward,
  currency,
  preview,
  comment,
}: ConfirmationProps) {
  const { t } = useLanguage();
  const total =
    action === 'PLAYER_TO_ALL' || action === 'ALL_TO_PLAYER'
      ? amount * (preview.length - 1)
      : action === 'PASS_GO'
        ? passGoReward
        : amount;
  const resultingBalance =
    preview.find(({ player: affected }) => affected.id === player.id)?.after ?? player.balance;
  return (
    <section className={confirmationClass}>
      <dl>
        <div>
          <dt>{t('actor')}</dt>
          <dd>{player.name}</dd>
        </div>
        <div>
          <dt>{t('operation')}</dt>
          <dd>{transactionLabel(action, t)}</dd>
        </div>
        <div>
          <dt>{t('source')}</dt>
          <dd>{sourceFor(action, player, t)}</dd>
        </div>
        <div>
          <dt>{t('destination')}</dt>
          <dd>{destinationFor(action, player, target, t)}</dd>
        </div>
        <div>
          <dt>{t('amount')}</dt>
          <dd>
            {formatMoney(action === 'PASS_GO' ? passGoReward : amount, currency)}
            {action === 'PLAYER_TO_ALL' || action === 'ALL_TO_PLAYER' ? ` ${t('perPlayer')}` : ''}
          </dd>
        </div>
        <div>
          <dt>{t('total')}</dt>
          <dd>{formatMoney(total, currency)}</dd>
        </div>
        <div className={availableClass}>
          <dt>{t('resultingAvailableBalance')}</dt>
          <dd>{formatMoney(resultingBalance, currency)}</dd>
        </div>
        {comment.trim() !== '' && (
          <div>
            <dt>{t('comment')}</dt>
            <dd>{comment.trim()}</dd>
          </div>
        )}
      </dl>
      <h3>{t('resultingBalances')}</h3>
      <ul>
        {preview.map(({ player: affected, after, delta }) => (
          <li key={affected.id}>
            <span>
              <i style={{ backgroundColor: affected.color }} />
              {affected.name}
            </span>
            <strong>
              {formatMoney(after, currency)} <small>({formatMoneyDelta(delta, currency)})</small>
            </strong>
          </li>
        ))}
      </ul>
    </section>
  );
}
