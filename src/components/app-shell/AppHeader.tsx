import type { RefObject } from 'react';
import type { UserProfile } from '../../../shared/contracts/api';
import { useLanguage } from '../../i18n/language-context';
import { Avatar } from '../AvatarPicker';
import { BankSeal } from '../ui';
import { cx } from '../ui/class-names';

/*
 * The shell keeps its semantic class names as hooks: the safe-area padding and offsets
 * (`env(safe-area-inset-*)`, `--mb-app-safe-*`) and the iOS `@supports` block stay in
 * `layout.css`, and the Liquid Glass ambient background drift stays in `liquid-glass.css`.
 */
const appHeaderClass = cx(
  'app-header sticky top-0 z-20 border-b border-b-[color:color-mix(in_srgb,var(--mb-color-highlight)_48%,transparent)]',
  '[background:var(--mb-background-header)] text-on-inverse shadow-header',
  // Only the dark Classic header needs the inverse ring; Liquid Glass light keeps the default.
  'classic:light:[&_button:focus-visible]:outline-text-on-inverse',
  'glass:border-b-[rgb(255_255_255/0.36)] glass:text-primary',
  'glass:backdrop-blur-[20px] glass:backdrop-saturate-[1.3] glass:max-md:backdrop-blur-[16px] glass:max-md:backdrop-saturate-[1.22]',
);
/* Liquid Glass frosts the profile and settings buttons and drops their hover fill. */
const glassHeaderControlClass = cx(
  'glass:border glass:border-solid glass:border-[rgb(255_255_255/0.4)]',
  'glass:bg-[rgb(255_255_255/0.22)] glass:fine-pointer:hover:bg-[rgb(255_255_255/0.22)]',
  'glass:shadow-[inset_0_1px_0_rgb(255_255_255/0.38),0_5px_16px_rgb(40_60_90/0.07)]',
);
const appHeaderInnerClass = cx(
  'app-header-inner mx-auto flex w-[min(100%,var(--mb-layout-content-max))] items-center justify-between',
  'min-h-(--mb-layout-header-height-compact) gap-(--mb-space-2)',
  'md:min-h-(--mb-layout-header-height-medium) md:gap-(--mb-space-4)',
  'lg:min-h-(--mb-layout-header-height-wide) short-landscape:min-h-[52px]',
);
const headerButtonClass = cx(
  'inline-flex min-h-(--mb-control-height-md) min-w-(--mb-control-height-md) items-center justify-center',
  'gap-(--mb-space-2) bg-transparent font-semibold text-inherit',
  'transition-[color,background-color,border-color,transform] duration-(--mb-duration-fast) ease-standard',
  'active:transform-[translateY(1px)] motion-reduce:transform-none! fine-pointer:hover:bg-inverse-hover',
);
const brandClass = cx(headerButtonClass, 'border-none p-0 text-[1rem] tracking-[-0.015em]');
const profileButtonClass = cx(
  headerButtonClass,
  'rounded-pill border-none p-(--mb-space-1)',
  'md:max-w-[16rem] md:py-(--mb-space-1) md:pr-(--mb-space-2) md:pl-(--mb-space-1)',
  'max-md:[&>span:last-child]:hidden',
  glassHeaderControlClass,
);
const settingsButtonClass = cx(
  headerButtonClass,
  'w-(--mb-control-height-md) rounded-md border border-[color:color-mix(in_srgb,var(--mb-color-text-on-inverse)_28%,transparent)] p-0',
  'md:w-auto md:px-(--mb-space-3) max-md:[&>span]:hidden',
  glassHeaderControlClass,
);

interface AppHeaderProps {
  profile: UserProfile;
  settingsOpen: boolean;
  settingsButtonRef: RefObject<HTMLButtonElement | null>;
  onToggleSettings: () => void;
  navigate: (target: string) => void;
}

export function AppHeader({
  profile,
  settingsOpen,
  settingsButtonRef,
  onToggleSettings,
  navigate,
}: AppHeaderProps) {
  const { t } = useLanguage();
  return (
    <header className={appHeaderClass}>
      <div className={appHeaderInnerClass}>
        <button type="button" className={brandClass} onClick={() => navigate('/')}>
          <BankSeal variant="header" />
          <span>{t('appName')}</span>
        </button>
        <div className="header-tools flex items-center justify-end gap-(--mb-space-2)">
          <button className={profileButtonClass} type="button" onClick={() => navigate('/profile')}>
            <Avatar avatar={profile.avatar} label={profile.nickname} />
            <span>{profile.nickname}</span>
          </button>
          <button
            ref={settingsButtonRef}
            className={settingsButtonClass}
            type="button"
            aria-label={t('settings')}
            aria-expanded={settingsOpen}
            aria-haspopup="dialog"
            aria-controls="settings-panel"
            onClick={onToggleSettings}
          >
            ⚙ <span>{t('settings')}</span>
          </button>
        </div>
      </div>
    </header>
  );
}
