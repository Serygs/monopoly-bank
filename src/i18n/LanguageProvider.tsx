import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { LanguageContext } from './language-context';
import { languageLocale, translate, type Language } from './translations';

const storageKey = 'monopoly-bank-language';

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguage] = useState<Language>(readInitialLanguage);

  useEffect(() => {
    document.documentElement.lang = language;
    window.localStorage.setItem(storageKey, language);
  }, [language]);

  const value = useMemo(
    () => ({
      language,
      locale: languageLocale(language),
      setLanguage,
      t: (key: Parameters<typeof translate>[1], values?: Parameters<typeof translate>[2]) =>
        translate(language, key, values),
    }),
    [language],
  );

  return <LanguageContext value={value}>{children}</LanguageContext>;
}

function readInitialLanguage(): Language {
  const saved = window.localStorage.getItem(storageKey);
  if (saved === 'en' || saved === 'uk') {
    return saved;
  }
  return navigator.language.toLowerCase().startsWith('uk') ? 'uk' : 'en';
}
