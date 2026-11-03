import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { store } from './store.ts';
import { detectLocale } from './i18n/index.ts';
import { prefs } from './store.ts';
// Fonts are bundled and served from this site, so no visitor IP goes to a font CDN.
// Each family is split by unicode-range: browsers fetch only the subsets a page uses.
import '@fontsource/be-vietnam-pro/400.css';
import '@fontsource/be-vietnam-pro/500.css';
import '@fontsource/be-vietnam-pro/600.css';
import '@fontsource/noto-sans-lao/400.css';
import '@fontsource/noto-sans-lao/500.css';
import '@fontsource/noto-sans-lao/600.css';
import '@fontsource/noto-sans-khmer/400.css';
import '@fontsource/noto-sans-khmer/500.css';
import '@fontsource/noto-sans-khmer/600.css';
import '@fontsource/noto-serif-tc/600.css';
import './styles.css';

// first visit: pick the browser language if we support it
if (prefs.get('locale', null) === null) store.set({ locale: detectLocale() });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
