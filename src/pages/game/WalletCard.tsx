import type { CSSProperties, ReactNode } from 'react';
import type { Currency, Player } from '../../../shared/types/monopoly';
import { cx, playerSwatchClass } from '../../components/ui/class-names';
import { useLanguage } from '../../i18n/language-context';
import { formatMoney } from '../../utils/money';
import { playerNameWithGameId } from '../../utils/player-display';

export interface WalletCardProps {
  player: Player;
  players: Player[];
  currency: Currency;
  active: boolean;
  gameActive: boolean;
  prominent?: boolean;
  onOpen: () => void;
}

/*
 * `wallet-card` and `wallet-card-active` stay as hooks for the e2e suites and the swatch's
 * `[.wallet-card-active_&]` variant. The player colour arrives through the `--wallet-player-color`
 * inline custom property; the Liquid Glass colours skip the inline-start side so it keeps it.
 */
const cardClass = cx(
  'wallet-card relative grid min-w-0 content-between gap-(--mb-space-4) overflow-hidden rounded-card border text-start',
  'border-s-[6px] border-s-(color:--wallet-player-color) motion-reduce:transform-none!',
  'glass:text-primary glass:backdrop-blur-[22px] glass:backdrop-saturate-[1.35]',
);
const readonlyCardClass = cx(
  'min-h-[154px] border-border bg-surface-elevated p-(--mb-space-5) text-primary shadow-sm',
  'glass:border-y-[rgb(85_98_116/0.14)] glass:border-e-[rgb(85_98_116/0.14)] glass:bg-[rgb(255_255_255/0.54)]',
  'glass:dark:border-y-[rgb(255_255_255/0.14)] glass:dark:border-e-[rgb(255_255_255/0.14)] glass:dark:bg-[rgb(40_49_62/0.64)]',
);
/* Hover outranks the Liquid Glass light colours; Liquid Glass dark keeps its own on hover. */
const activeCardClass = cx(
  'wallet-card-active w-full cursor-pointer border-accent bg-surface-inverse text-on-inverse shadow-md',
  '[transition:transform_var(--mb-duration-normal)_var(--mb-ease-standard),box-shadow_var(--mb-duration-normal)_var(--mb-ease-standard),border-color_var(--mb-duration-fast)_var(--mb-ease-standard)]',
  'focus-visible:outline-offset-3 enabled:active:transform-[translateY(1px)] disabled:cursor-default',
  'fine-pointer:enabled:hover:transform-[translateY(-2px)] fine-pointer:enabled:hover:border-highlight fine-pointer:enabled:hover:border-s-(color:--wallet-player-color) fine-pointer:enabled:hover:shadow-hover',
  'glass:border-y-[color:color-mix(in_srgb,var(--mb-color-accent)_48%,rgb(255_255_255/0.78))] glass:border-e-[color:color-mix(in_srgb,var(--mb-color-accent)_48%,rgb(255_255_255/0.78))] glass:bg-[rgb(255_255_255/0.68)]',
  'glass:shadow-[0_16px_42px_rgb(50_70_100/0.14),0_0_0_1px_rgb(93_127_168/0.14),inset_0_1px_0_rgb(255_255_255/0.82)]',
  'glass:dark:border-y-[color:color-mix(in_srgb,var(--mb-color-accent)_48%,rgb(255_255_255/0.2))] glass:dark:border-e-[color:color-mix(in_srgb,var(--mb-color-accent)_48%,rgb(255_255_255/0.2))] glass:dark:bg-[rgb(50_61_76/0.82)]',
  'glass:dark:shadow-[0_18px_46px_rgb(0_0_0/0.3),0_0_0_1px_rgb(137_169_207/0.12),inset_0_1px_0_rgb(255_255_255/0.16)]',
  'glass:dark:fine-pointer:enabled:hover:border-y-[color:color-mix(in_srgb,var(--mb-color-accent)_48%,rgb(255_255_255/0.2))] glass:dark:fine-pointer:enabled:hover:border-e-[color:color-mix(in_srgb,var(--mb-color-accent)_48%,rgb(255_255_255/0.2))]',
  'glass:dark:fine-pointer:enabled:hover:shadow-[0_18px_46px_rgb(0_0_0/0.3),0_0_0_1px_rgb(137_169_207/0.12),inset_0_1px_0_rgb(255_255_255/0.16)]',
);
const prominentCardClass = 'min-h-[210px] p-[clamp(var(--mb-space-5),5vw,var(--mb-space-7))]';
const standardActiveCardClass = 'min-h-[154px] p-(--mb-space-5)';

const headingClass = 'grid min-w-0 grid-cols-[auto_minmax(0,1fr)] items-center gap-(--mb-space-2)';
const nameClass = 'min-w-0 text-[1rem] leading-[1.25] font-semibold text-inherit wrap-anywhere';
const badgesClass = 'col-span-full flex flex-wrap gap-(--mb-space-2)';
const badgeClass =
  'inline-flex min-h-[26px] w-fit items-center rounded-pill border border-[color:color-mix(in_srgb,currentColor_42%,transparent)] px-(--mb-space-2) py-[2px] text-meta font-semibold';
const badgeToneClass = {
  active: cx(
    'bg-[color-mix(in_srgb,var(--mb-color-highlight)_12%,transparent)] text-highlight',
    'glass:bg-[color-mix(in_srgb,var(--mb-color-accent-soft)_72%,transparent)] glass:text-accent-hover',
  ),
  bankrupt: 'bg-danger-soft text-danger',
};
const balanceClass =
  'min-w-0 font-money leading-none font-bold whitespace-nowrap text-inherit tabular-nums';
const footerClass =
  'flex min-h-(--mb-control-height-md) items-center justify-between gap-(--mb-space-3) border-t pt-(--mb-space-3) text-small font-semibold';

/** A status pill under the player name: the active wallet or a bankrupt player. */
function WalletBadge({
  tone,
  children,
}: {
  tone: keyof typeof badgeToneClass;
  children: ReactNode;
}) {
  return <span className={cx(badgeClass, badgeToneClass[tone])}>{children}</span>;
}

/** Balance size steps down for long amounts so the figure never wraps. */
function balanceSizeClass(length: number, prominent: boolean): string {
  if (length > 18)
    return prominent
      ? 'tracking-[-0.055em] text-[length:clamp(1.15rem,5.5vw,1.8rem)]'
      : 'tracking-[-0.055em] text-[length:clamp(0.95rem,4.5vw,1.35rem)]';
  if (length > 12)
    return prominent
      ? 'tracking-[-0.04em] text-[length:clamp(1.6rem,7vw,2.7rem)]'
      : 'tracking-[-0.04em] text-[length:clamp(1.25rem,5.5vw,1.75rem)]';
  return prominent ? 'tracking-[-0.04em] text-money-xl' : 'tracking-[-0.04em] text-money-lg';
}

export function WalletCard({
  player,
  players,
  currency,
  active,
  gameActive,
  prominent = false,
  onOpen,
}: WalletCardProps) {
  const { t } = useLanguage();
  const playerName = playerNameWithGameId(player, players);
  const unavailable = !gameActive || player.status === 'BANKRUPT';
  const interactive = active && !unavailable;
  const balance = formatMoney(player.balance, currency);
  const cardStyle = { '--wallet-player-color': player.color } as CSSProperties;
  const content = (
    <>
      <span className={headingClass}>
        <span
          className={cx(
            playerSwatchClass,
            '[.wallet-card-active_&]:border-text-on-inverse glass:[.wallet-card-active_&]:border-[rgb(255_255_255/0.86)] glass:dark:[.wallet-card-active_&]:border-[rgb(255_255_255/0.34)]',
          )}
          style={{ backgroundColor: player.color }}
          aria-hidden="true"
        />
        <span className={nameClass}>{playerName}</span>
        <span className={badgesClass}>
          {active && <WalletBadge tone="active">{t('activeWallet')}</WalletBadge>}
          {player.status === 'BANKRUPT' && (
            <WalletBadge tone="bankrupt">{t('bankrupt')}</WalletBadge>
          )}
        </span>
      </span>
      <strong className={cx(balanceClass, balanceSizeClass(balance.length, prominent))}>
        {balance}
      </strong>
      <span
        className={cx(
          footerClass,
          active
            ? cx(
                'border-t-[color:color-mix(in_srgb,var(--mb-color-text-on-inverse)_22%,transparent)] text-[color:color-mix(in_srgb,var(--mb-color-text-on-inverse)_78%,transparent)]',
                'glass:border-t-[rgb(85_98_116/0.16)] glass:text-secondary glass:dark:border-t-[rgb(255_255_255/0.14)]',
              )
            : 'border-border text-secondary',
        )}
      >
        <span>{interactive ? t('walletAction') : t('walletReadOnly')}</span>
        {interactive && <span aria-hidden="true">→</span>}
      </span>
    </>
  );
  const accessibleLabel = t(interactive ? 'walletAria' : 'walletReadOnlyAria', {
    name: playerName,
    balance,
  });
  if (!active)
    return (
      <article
        className={cx(cardClass, readonlyCardClass)}
        style={cardStyle}
        aria-label={accessibleLabel}
      >
        {content}
      </article>
    );
  return (
    <button
      className={cx(
        cardClass,
        activeCardClass,
        prominent ? prominentCardClass : standardActiveCardClass,
      )}
      type="button"
      disabled={unavailable}
      style={cardStyle}
      aria-label={accessibleLabel}
      onClick={onOpen}
    >
      {content}
    </button>
  );
}
