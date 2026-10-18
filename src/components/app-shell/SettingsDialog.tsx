import type { CSSProperties } from 'react';
import { apiErrorMessage } from '../../i18n/api-errors';
import { useLanguage } from '../../i18n/language-context';
import type { DevicePreferences } from '../../utils/preferences';
import { AppearanceSettings, SettingsGroup } from '../AppearanceSettings';
import { Dialog } from '../Dialog';
import { Button, Notice, SegmentedControl, Toggle } from '../ui';
import { cx } from '../ui/class-names';

/*
 * Popover position from md up. It reads the `--settings-popover-top/right` properties written
 * below. The breakpoint variants sort after the Dialog panel's own `max-height`.
 */
const settingsPanelClass = cx(
  'settings-panel md:fixed md:max-w-[calc(100vw_-_2_*_var(--mb-space-3))]',
  'md:top-[var(--settings-popover-top,calc(var(--mb-layout-header-height-medium)_+_var(--mb-app-safe-top)_+_12px))]',
  'lg:top-[var(--settings-popover-top,calc(var(--mb-layout-header-height-wide)_+_var(--mb-app-safe-top)_+_12px))]',
  'md:right-[var(--settings-popover-right,max(var(--mb-layout-page-inline-medium),calc((100vw_-_var(--mb-layout-content-max))_/_2)))]',
  'md:max-h-[calc(100dvh_-_var(--settings-popover-top,calc(var(--mb-layout-header-height-medium)_+_var(--mb-app-safe-top)_+_12px))_-_24px)]',
  'short-landscape:max-h-[calc(100dvh_-_var(--mb-app-safe-top)_-_var(--mb-space-2))]',
  // The cap applies to the anchored popover only; below `md` both styles share the full-width sheet.
  'glass:min-w-0 glass:md:max-w-[min(22.5rem,calc(100vw_-_2_*_var(--mb-space-3)))] glass:overflow-x-hidden',
  'glass:md:w-[min(22.5rem,calc(100vw_-_2_*_var(--mb-space-3)))]',
  'glass-popover',
  'glass:[&>header>div]:min-w-0 glass:[&>header_h2]:max-w-full glass:[&>header_h2]:text-[1.75rem] glass:[&>header_h2]:whitespace-nowrap',
  'glass:[&_.settings-options]:min-w-0',
);

interface SettingsDialogProps {
  preferences: DevicePreferences;
  onPreferencesChange: (change: Partial<DevicePreferences>) => void;
  position: { top: number; right: number } | null;
  signingOut: boolean;
  signOutError: unknown;
  onSignOut: () => void;
  onClose: () => void;
}

function SignOutIcon() {
  return (
    <svg
      className="settings-sign-out-icon size-5 fill-none stroke-current stroke-[1.75] [stroke-linecap:round] [stroke-linejoin:round]"
      viewBox="0 0 20 20"
      aria-hidden="true"
    >
      <path d="M8.25 3.25H5.5A1.75 1.75 0 0 0 3.75 5v10c0 .97.78 1.75 1.75 1.75h2.75M12.25 6.25 16 10l-3.75 3.75M7.5 10H16" />
    </svg>
  );
}

function SignOutSection({
  signingOut,
  signOutError,
  onSignOut,
}: Pick<SettingsDialogProps, 'signingOut' | 'signOutError' | 'onSignOut'>) {
  const { t } = useLanguage();
  return (
    <div className="settings-account-actions grid gap-(--mb-space-3) border-t border-dialog-divider mt-(--mb-space-1) pt-(--mb-space-4)">
      {signOutError !== null && (
        <Notice tone="error" className="m-0">
          {apiErrorMessage(signOutError, t, 'unableSignOut')}
        </Notice>
      )}
      <Button
        variant="quiet"
        className="settings-sign-out w-full justify-start text-secondary enabled:active:text-danger enabled:active:bg-danger-soft fine-pointer:enabled:hover:text-danger fine-pointer:enabled:hover:bg-danger-soft"
        disabled={signingOut}
        onClick={onSignOut}
      >
        <SignOutIcon />
        <span>{signingOut ? t('signingOut') : t('signOut')}</span>
      </Button>
    </div>
  );
}

function popoverStyle(position: SettingsDialogProps['position']): CSSProperties | undefined {
  if (position === null) return undefined;
  return {
    '--settings-popover-top': `${position.top}px`,
    '--settings-popover-right': `${position.right}px`,
  } as CSSProperties;
}

export function SettingsDialog(props: SettingsDialogProps) {
  const { language, setLanguage, t } = useLanguage();
  const { preferences, onPreferencesChange } = props;
  const toggle = (key: 'sound' | 'vibration' | 'keepScreenAwake', label: string) => (
    <Toggle
      label={label}
      checked={preferences[key]}
      onChange={(value) => onPreferencesChange({ [key]: value })}
    />
  );
  return (
    <Dialog
      title={t('settings')}
      closeLabel={t('closeDialog', { title: t('settings') })}
      onClose={props.onClose}
      closeDisabled={props.signingOut}
      className={settingsPanelClass}
      presentation="popover"
      popoverStyle={popoverStyle(props.position)}
    >
      <AppearanceSettings preferences={preferences} onChange={onPreferencesChange} />
      <SettingsGroup legend={t('language')}>
        <SegmentedControl
          options={[
            { value: 'en', label: t('english') },
            { value: 'uk', label: t('ukrainian') },
          ]}
          value={language}
          onChange={setLanguage}
        />
      </SettingsGroup>
      {toggle('sound', t('sound'))}
      {toggle('vibration', t('vibration'))}
      {toggle('keepScreenAwake', t('keepScreenAwake'))}
      <SignOutSection {...props} />
    </Dialog>
  );
}
