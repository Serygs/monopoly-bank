import type { ReactNode } from 'react';
import { visualStyles } from '../appearance/visual-styles';
import { useLanguage } from '../i18n/language-context';
import { isColorMode, type DevicePreferences } from '../utils/preferences';
import { SegmentedControl } from './ui';
import { cx } from './ui/class-names';

type AppearancePreferences = Pick<DevicePreferences, 'visualStyle' | 'colorMode'>;

/* `style-preview-grid` stays as the hook the e2e overflow check uses. */
const previewGridClass =
  'style-preview-grid grid grid-cols-2 gap-(--mb-space-2) glass:w-full glass:min-w-0';
const previewCardClass = cx(
  'relative grid min-h-[94px] content-end gap-(--mb-space-2) overflow-hidden p-(--mb-space-3) text-start',
  'rounded-md border border-border-strong bg-surface-elevated text-primary',
  'font-ui text-small leading-[1.2] font-semibold',
  'aria-pressed:border-accent aria-pressed:shadow-[0_0_0_1px_var(--mb-color-accent)]',
  'glass:min-w-0 glass:max-w-full glass:wrap-anywhere',
);
const previewArtClass =
  'absolute inset-x-(--mb-space-2) top-(--mb-space-2) bottom-[2.7rem] rounded-[calc(var(--mb-radius-md)-5px)]';
/* Each card previews its own style, whichever style is active. */
const classicArtClass = 'bg-[linear-gradient(135deg,#07382d,#176f51)]';
const glassArtClass =
  'bg-[radial-gradient(circle_at_20%_20%,rgb(255_255_255/0.82),transparent_30%),linear-gradient(135deg,#dcebfa,#e7e2f4_55%,#dcede8)]';
const previewCheckClass =
  'absolute top-(--mb-space-2) right-(--mb-space-2) size-[22px] place-items-center rounded-full bg-accent text-on-accent';

/** One labelled group of the settings panel; `settings-options` keeps its rules in primitives.css. */
export function SettingsGroup({ legend, children }: { legend: string; children: ReactNode }) {
  return (
    <fieldset className="settings-options">
      <legend>{legend}</legend>
      {children}
    </fieldset>
  );
}

export function AppearanceSettings({
  preferences,
  onChange,
}: {
  preferences: AppearancePreferences;
  onChange: (change: Partial<AppearancePreferences>) => void;
}) {
  const { t } = useLanguage();
  return (
    <>
      <SettingsGroup legend={t('visualStyle')}>
        <div className={previewGridClass}>
          {visualStyles.map((style) => {
            const active = preferences.visualStyle === style.id;
            return (
              <button
                key={style.id}
                type="button"
                className={previewCardClass}
                aria-pressed={active}
                onClick={() => onChange({ visualStyle: style.id })}
              >
                <span
                  className={cx(
                    previewArtClass,
                    style.id === 'liquid-glass' ? glassArtClass : classicArtClass,
                  )}
                  aria-hidden="true"
                />
                <span>{t(style.labelKey)}</span>
                <span
                  className={cx(previewCheckClass, active ? 'grid' : 'hidden')}
                  aria-hidden="true"
                >
                  ✓
                </span>
              </button>
            );
          })}
        </div>
      </SettingsGroup>
      <SettingsGroup legend={t('appearance')}>
        <SegmentedControl
          columns={3}
          options={(['light', 'dark', 'system'] as const).map((mode) => ({
            value: mode,
            label: t(
              mode === 'light' ? 'themeLight' : mode === 'dark' ? 'themeDark' : 'themeSystem',
            ),
          }))}
          value={preferences.colorMode}
          onChange={(mode) => {
            if (isColorMode(mode)) onChange({ colorMode: mode });
          }}
        />
      </SettingsGroup>
    </>
  );
}
