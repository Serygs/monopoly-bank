import { visualStyles } from '../appearance/visual-styles';
import { useLanguage } from '../i18n/language-context';
import { isColorMode, type DevicePreferences } from '../utils/preferences';

type AppearancePreferences = Pick<DevicePreferences, 'visualStyle' | 'colorMode'>;

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
      <fieldset className="settings-options">
        <legend>{t('visualStyle')}</legend>
        <div className="style-preview-grid">
          {visualStyles.map((style) => (
            <button
              key={style.id}
              type="button"
              className={`style-preview-card style-preview-card--${style.id}${preferences.visualStyle === style.id ? ' active' : ''}`}
              aria-pressed={preferences.visualStyle === style.id}
              onClick={() => onChange({ visualStyle: style.id })}
            >
              <span className="style-preview-card-art" aria-hidden="true" />
              <span>{t(style.labelKey)}</span>
              <span className="style-preview-card-check" aria-hidden="true">
                ✓
              </span>
            </button>
          ))}
        </div>
      </fieldset>
      <fieldset className="settings-options">
        <legend>{t('appearance')}</legend>
        <div className="settings-segmented settings-segmented--three">
          {(['light', 'dark', 'system'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              className={preferences.colorMode === mode ? 'active' : ''}
              aria-pressed={preferences.colorMode === mode}
              onClick={() => {
                if (isColorMode(mode)) onChange({ colorMode: mode });
              }}
            >
              {t(mode === 'light' ? 'themeLight' : mode === 'dark' ? 'themeDark' : 'themeSystem')}
            </button>
          ))}
        </div>
      </fieldset>
    </>
  );
}
