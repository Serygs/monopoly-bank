import { useLanguage } from '../../i18n/language-context';
import { BottomNav, NavIcon } from '../ui/BottomNav';

export type GameNavDestination = 'activity' | 'statistics' | 'property' | 'tools' | 'pay';

export interface GameBottomNavProps {
  /** The destination whose sheet is open; it is highlighted and tapping it again closes it. */
  active?: GameNavDestination | null;
  onClose?: () => void;
  pendingRequests: number;
  /** Show the Property item (board games only) with the viewer's card count as its badge. */
  property?: { count: number; onOpen: () => void };
  payDisabled: boolean;
  activityDisabled: boolean;
  toolsDisabled: boolean;
  onOpenTools: () => void;
  onPay: () => void;
  onOpenActivity: () => void;
  onOpenStatistics: () => void;
}

/**
 * Compact-only navigation (`md:hidden`): Activity, Statistics, Property (board games only), Tools and the raised Pay action.
 * Every destination opens a sheet or screen above the page, so there is no Wallets item.
 * `game-bottom-nav` stays as the hook for the e2e checks.
 */
export function GameBottomNav({
  active = null,
  onClose,
  pendingRequests,
  property,
  payDisabled,
  activityDisabled,
  toolsDisabled,
  onOpenTools,
  onPay,
  onOpenActivity,
  onOpenStatistics,
}: GameBottomNavProps) {
  const { t } = useLanguage();
  /** Tapping the open destination closes it; any other one opens it, replacing the open sheet. */
  const press = (destination: GameNavDestination, open: () => void) =>
    active === destination && onClose !== undefined ? onClose : open;
  return (
    <BottomNav
      label={t('gameNavigation')}
      className="game-bottom-nav md:hidden"
      items={[
        {
          key: 'activity',
          label: t('activity'),
          icon: (
            <NavIcon>
              <path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01" />
            </NavIcon>
          ),
          active: active === 'activity',
          disabled: activityDisabled,
          onPress: press('activity', onOpenActivity),
          badge: {
            count: pendingRequests,
            label: t('navPendingRequests', { count: pendingRequests }),
          },
        },
        {
          key: 'statistics',
          label: t('statistics'),
          icon: (
            <NavIcon>
              <path d="M5 20V10M12 20V4M19 20v-7" />
            </NavIcon>
          ),
          active: active === 'statistics',
          disabled: activityDisabled,
          onPress: press('statistics', onOpenStatistics),
        },
        ...(property === undefined
          ? []
          : [
              {
                key: 'property',
                label: t('navProperty'),
                icon: (
                  <NavIcon>
                    <path d="M4 11l8-7 8 7M6 10v10h12V10M10 20v-5h4v5" />
                  </NavIcon>
                ),
                active: active === 'property',
                disabled: activityDisabled,
                onPress: press('property', property.onOpen),
                badge: {
                  count: property.count,
                  label: t('navPropertyCards', { count: property.count }),
                },
              },
            ]),
        {
          key: 'tools',
          label: t('navTools'),
          icon: (
            <NavIcon>
              <path d="M14.5 6.5a4 4 0 0 0-5 5L4 17l3 3 5.5-5.5a4 4 0 0 0 5-5l-2.5 2.5-2-.5-.5-2z" />
            </NavIcon>
          ),
          active: active === 'tools',
          disabled: toolsDisabled,
          onPress: press('tools', onOpenTools),
        },
        {
          key: 'pay',
          label: t('navPay'),
          raised: true,
          icon: (
            <NavIcon>
              <path d="M7 8h12l-3-3M17 16H5l3 3" />
            </NavIcon>
          ),
          active: active === 'pay',
          disabled: payDisabled,
          onPress: press('pay', onPay),
        },
      ]}
    />
  );
}
