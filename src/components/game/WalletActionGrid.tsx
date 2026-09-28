import type { ReactNode } from 'react';
import { useLanguage } from '../../i18n/language-context';
import { actionLabel, walletActionTone, type ActionType } from '../../pages/game/game-page-helpers';
import { Button } from '../ui';
import { actionGridClass, cx } from '../ui/class-names';

export interface WalletActionGridProps {
  actions: readonly ActionType[];
  onSelect: (action: ActionType) => void;
  /** Extra classes appended after the grid classes. */
  className?: string;
  /** Rendered after the action buttons, inside the grid. */
  children?: ReactNode;
}

/* A tall, start-aligned wallet action on the button core, toned by income or expense. */
const actionButtonClass =
  'min-h-16 justify-start rounded-control px-(--mb-space-4) py-[10px] text-left text-button leading-[1.15]';
const actionToneClass: Record<ReturnType<typeof walletActionTone>, string> = {
  income: 'border-status-border bg-success-soft text-status-text',
  expense: 'border-danger-border bg-danger-soft text-danger',
};

/** Grid of income/expense-toned wallet action buttons. */
export function WalletActionGrid({
  actions,
  onSelect,
  className,
  children,
}: WalletActionGridProps) {
  const { t } = useLanguage();
  return (
    <div className={cx(actionGridClass, className)}>
      {actions.map((item) => (
        <Button
          className={cx(actionButtonClass, actionToneClass[walletActionTone(item)])}
          key={item}
          onClick={() => onSelect(item)}
        >
          {actionLabel(item, t)}
        </Button>
      ))}
      {children}
    </div>
  );
}
