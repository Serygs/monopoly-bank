import type { ReactNode } from 'react';
import { useLanguage } from '../../i18n/language-context';
import { actionLabel, walletActionTone, type ActionType } from '../../pages/game/game-page-helpers';
import { Button } from '../ui';

export interface WalletActionGridProps {
  actions: readonly ActionType[];
  onSelect: (action: ActionType) => void;
  /** Extra classes appended after `action-grid`. */
  className?: string;
  /** Rendered after the action buttons, inside the grid. */
  children?: ReactNode;
}

/** Grid of income/expense-toned wallet action buttons (`action-grid`). */
export function WalletActionGrid({
  actions,
  onSelect,
  className,
  children,
}: WalletActionGridProps) {
  const { t } = useLanguage();
  return (
    <div className={className === undefined ? 'action-grid' : `action-grid ${className}`}>
      {actions.map((item) => (
        <Button
          className={`wallet-action-button wallet-action-${walletActionTone(item)} action-button`}
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
