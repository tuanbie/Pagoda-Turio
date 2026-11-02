import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { store } from './store.ts';
import { detectLocale } from './i18n/index.ts';
import { prefs } from './store.ts';
import './styles.css';

// first visit: pick the browser language if we support it
if (prefs.get('locale', null) === null) store.set({ locale: detectLocale() });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
