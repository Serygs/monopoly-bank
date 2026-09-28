import type { Currency, Player } from '../../../shared/types/monopoly';
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
    <section className="confirmation">
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
        <div className="confirmation-available">
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
      <ul className="balance-preview">
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
