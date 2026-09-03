import { createContext, useContext } from 'react';
import type { Language, Translate } from './translations';

export interface LanguageContextValue {
  language: Language;
  locale: string;
  setLanguage: (language: Language) => void;
  t: Translate;
}

export const LanguageContext = createContext<LanguageContextValue | null>(null);

export function useLanguage(): LanguageContextValue {
  const context = useContext(LanguageContext);
  if (context === null) {
    throw new Error('useLanguage must be used inside LanguageProvider.');
  }
  return context;
}
