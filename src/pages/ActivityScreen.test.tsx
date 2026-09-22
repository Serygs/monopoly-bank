import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LanguageContext } from '../i18n/language-context';
import { languageLocale, translate } from '../i18n/translations';
import { ActivityScreen } from './ActivityScreen';

describe('activity accessibility', () => {
  it.each(['en', 'uk'] as const)('connects tabs to one keyboard-focusable panel in %s', (language) => {
    const markup = renderToStaticMarkup(
      <LanguageContext value={{ language, locale: languageLocale(language), setLanguage: () => {}, t: (key, values) => translate(language, key, values) }}>
        <ActivityScreen gameId="game-1" players={[]} currency="K" liveTransactions={[]} onClose={() => {}} />
      </LanguageContext>,
    );

    expect(markup).toContain('role="tablist"');
    expect(markup.match(/role="tab"/g)).toHaveLength(3);
    expect(markup.match(/aria-controls=/g)).toHaveLength(3);
    expect(markup.match(/aria-selected="true"/g)).toHaveLength(1);
    expect(markup.match(/role="tab"[^>]*tabindex="-1"/g)).toHaveLength(2);
    expect(markup).toMatch(/role="tabpanel"[^>]*aria-labelledby="[^"]+"[^>]*tabindex="0"/);
  });
});
