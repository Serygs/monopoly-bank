import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LanguageContext } from '../i18n/language-context';
import { languageLocale, translate } from '../i18n/translations';
import { AppearanceSettings } from './AppearanceSettings';

describe('appearance settings', () => {
  it.each(['en', 'uk'] as const)(
    'offers only implemented styles and separate appearance options in %s',
    (language) => {
      const { container } = render(
        <LanguageContext
          value={{
            language,
            locale: languageLocale(language),
            setLanguage: () => {},
            t: (key) => translate(language, key),
          }}
        >
          <AppearanceSettings
            preferences={{ visualStyle: 'classic-bank', colorMode: 'dark' }}
            onChange={() => {}}
          />
        </LanguageContext>,
      );
      expect(container).toHaveTextContent(translate(language, 'visualStyle'));
      expect(container).toHaveTextContent(translate(language, 'appearance'));
      expect(container).toHaveTextContent(translate(language, 'visualStyleClassicBank'));
      expect(screen.getAllByRole('group')).toHaveLength(2);
      expect(
        screen.getAllByRole('button').filter((button) => button.hasAttribute('aria-pressed')),
      ).toHaveLength(5);
      expect(screen.getAllByRole('button', { pressed: true }).length).toBeGreaterThan(0);
      expect(container).toHaveTextContent(translate(language, 'themeLight'));
      expect(container).toHaveTextContent(translate(language, 'themeDark'));
      expect(container).toHaveTextContent(translate(language, 'themeSystem'));
      expect(container).toHaveTextContent(translate(language, 'visualStyleLiquidGlass'));
      expect(container.innerHTML).not.toContain('minimal-finance');
    },
  );
});
