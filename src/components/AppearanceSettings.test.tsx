import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LanguageContext } from '../i18n/language-context';
import { languageLocale, translate } from '../i18n/translations';
import { AppearanceSettings } from './AppearanceSettings';

describe('appearance settings', () => {
  it.each(['en', 'uk'] as const)('offers only implemented styles and separate appearance options in %s', (language) => {
    const markup = renderToStaticMarkup(
      <LanguageContext value={{ language, locale: languageLocale(language), setLanguage: () => {}, t: (key) => translate(language, key) }}>
        <AppearanceSettings preferences={{ visualStyle: 'classic-bank', colorMode: 'dark' }} onChange={() => {}} />
      </LanguageContext>,
    );
    expect(markup).toContain(translate(language, 'visualStyle'));
    expect(markup).toContain(translate(language, 'appearance'));
    expect(markup).toContain(translate(language, 'visualStyleClassicBank'));
    expect(markup.match(/<fieldset/g)).toHaveLength(2);
    expect(markup.match(/aria-pressed/g)).toHaveLength(4);
    expect(markup).toContain('aria-pressed="true"');
    expect(markup).toContain(translate(language, 'themeLight'));
    expect(markup).toContain(translate(language, 'themeDark'));
    expect(markup).toContain(translate(language, 'themeSystem'));
    expect(markup).not.toContain('liquid-glass');
    expect(markup).not.toContain('minimal-finance');
  });
});
