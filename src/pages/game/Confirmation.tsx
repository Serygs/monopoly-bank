import type { Currency, Player } from '../../../shared/types/monopoly';
import { Notice } from '../../components/ui';
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
  /** The mortgaged property, shown for a mortgage or a redemption. */
  propertyName?: string;
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
/* Below `md` the lead block carries amount and route, so the rows that repeat them are hidden. */
const compactHidden = 'max-md:hidden!';
const leadClass = cx(
  'mb-(--mb-space-3) grid gap-[4px] rounded-control border border-border bg-surface-subtle p-(--mb-space-4) md:hidden',
  '[&>strong]:font-money [&>strong]:text-[2rem] [&>strong]:leading-[1.05] [&>strong]:font-bold [&>strong]:tracking-[-0.03em] [&>strong]:text-primary [&>strong]:tabular-nums [&>strong]:wrap-anywhere',
  '[&>span]:text-secondary',
);
const balancesClass = cx(
  'mt-(--mb-space-4) [&>summary]:cursor-pointer [&>summary]:py-(--mb-space-2) [&>summary]:font-semibold [&>summary]:text-accent',
  'open:[&>summary]:text-primary [&_h3]:hidden [&_ul]:mt-(--mb-space-2)',
);
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
  propertyName,
}: ConfirmationProps) {
  const { t } = useLanguage();
  const total =
    action === 'PLAYER_TO_ALL' || action === 'ALL_TO_PLAYER'
      ? amount * (preview.length - 1)
      : action === 'PASS_GO'
        ? passGoReward
        : amount;
  const shownAmount = action === 'PASS_GO' ? passGoReward : amount;
  const repeatsAmount = total === shownAmount;
  const isLoanRequest = action === 'LOAN_ISSUE';
  const resultingBalance =
    preview.find(({ player: affected }) => affected.id === player.id)?.after ?? player.balance;
  return (
    <section className={confirmationClass}>
      <p className={leadClass}>
        <strong>
          {formatMoney(shownAmount, currency)}
          {action === 'PLAYER_TO_ALL' || action === 'ALL_TO_PLAYER' ? ` ${t('perPlayer')}` : ''}
        </strong>
        <span>
          {sourceFor(action, player, t, target)} → {destinationFor(action, player, target, t)}
        </span>
      </p>
      {isLoanRequest && (
        <Notice tone="info">
          {t('loanRequestNotice', { name: target?.name ?? t('selectedPlayer') })}
        </Notice>
      )}
      <dl>
        <div className={compactHidden}>
          <dt>{t('actor')}</dt>
          <dd>{player.name}</dd>
        </div>
        <div className={compactHidden}>
          <dt>{t('operation')}</dt>
          <dd>{transactionLabel(action, t)}</dd>
        </div>
        <div className={compactHidden}>
          <dt>{t('source')}</dt>
          <dd>{sourceFor(action, player, t, target)}</dd>
        </div>
        <div className={compactHidden}>
          <dt>{t('destination')}</dt>
          <dd>{destinationFor(action, player, target, t)}</dd>
        </div>
        {propertyName !== undefined && propertyName !== '' && (
          <div>
            <dt>{t('property')}</dt>
            <dd>{propertyName}</dd>
          </div>
        )}
        <div className={compactHidden}>
          <dt>{t('amount')}</dt>
          <dd>
            {formatMoney(action === 'PASS_GO' ? passGoReward : amount, currency)}
            {action === 'PLAYER_TO_ALL' || action === 'ALL_TO_PLAYER' ? ` ${t('perPlayer')}` : ''}
          </dd>
        </div>
        <div className={repeatsAmount ? compactHidden : undefined}>
          <dt>{t('total')}</dt>
          <dd>{formatMoney(total, currency)}</dd>
        </div>
        {!isLoanRequest && (
          <div className={availableClass}>
            <dt>{t('resultingAvailableBalance')}</dt>
            <dd>{formatMoney(resultingBalance, currency)}</dd>
          </div>
        )}
        {comment.trim() !== '' && (
          <div>
            <dt>{t('comment')}</dt>
            <dd>{comment.trim()}</dd>
          </div>
        )}
      </dl>
      {!isLoanRequest && (
        <details className={balancesClass}>
          <summary>{t('resultingBalances')}</summary>
          <h3>{t('resultingBalances')}</h3>
          <ul>
            {preview.map(({ player: affected, after, delta }) => (
              <li key={affected.id}>
                <span>
                  <i style={{ backgroundColor: affected.color }} />
                  {affected.name}
                </span>
                <strong>
                  {formatMoney(after, currency)}{' '}
                  <small>({formatMoneyDelta(delta, currency)})</small>
                </strong>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
