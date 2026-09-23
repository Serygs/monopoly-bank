import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.tsx';
import { LanguageProvider } from './i18n/LanguageProvider.tsx';
import { registerPwa } from './pwa.ts';
import { applyAppearance } from './appearance/appearance-controller';
import { readPreferences } from './utils/preferences';

applyAppearance(readPreferences());
registerPwa();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LanguageProvider>
      <App />
    </LanguageProvider>
  </StrictMode>,
);
