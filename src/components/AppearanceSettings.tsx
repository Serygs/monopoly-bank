import { isVisualStyleId, visualStyles } from '../appearance/visual-styles';
import { useLanguage } from '../i18n/language-context';
import { isColorMode, type DevicePreferences } from '../utils/preferences';

type AppearancePreferences = Pick<DevicePreferences, 'visualStyle' | 'colorMode'>;

export function AppearanceSettings({ preferences, onChange }: {
  preferences: AppearancePreferences;
  onChange: (change: Partial<AppearancePreferences>) => void;
}) {
  const { t } = useLanguage();
  return <>
    <label className="settings-select">
      <span>{t('visualStyle')}</span>
      <select value={preferences.visualStyle} onChange={(event) => {
        if (isVisualStyleId(event.target.value)) onChange({ visualStyle: event.target.value });
      }}>
        {visualStyles.map((style) => <option key={style.id} value={style.id}>{t(style.labelKey)}</option>)}
      </select>
    </label>
    <label className="settings-select">
      <span>{t('appearance')}</span>
      <select value={preferences.colorMode} onChange={(event) => {
        if (isColorMode(event.target.value)) onChange({ colorMode: event.target.value });
      }}>
        <option value="system">{t('themeSystem')}</option>
        <option value="light">{t('themeLight')}</option>
        <option value="dark">{t('themeDark')}</option>
      </select>
    </label>
  </>;
}
