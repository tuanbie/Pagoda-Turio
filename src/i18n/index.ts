import { en, enNames, type Key } from './en.ts';
import { vi, viNames } from './vi.ts';
import { lo, loNames } from './lo.ts';
import { km, kmNames } from './km.ts';
import { store } from '../store.ts';

export type Locale = 'vi' | 'en' | 'lo' | 'km';
export type { Key };

export const LOCALES: { id: Locale; label: string }[] = [
  { id: 'vi', label: 'Tiếng Việt' },
  { id: 'en', label: 'English' },
  { id: 'lo', label: 'ພາສາລາວ' },
  { id: 'km', label: 'ភាសាខ្មែរ' },
];

const dicts: Record<Locale, Record<Key, string>> = { en, vi, lo, km };
const names = { en: enNames, vi: viNames, lo: loNames, km: kmNames };
/** English puts the adjective first; Vietnamese, Lao and Khmer put the noun first. */
const adjFirst: Record<Locale, boolean> = { en: true, vi: false, lo: false, km: false };

export function detectLocale(): Locale {
  for (const lang of navigator.languages ?? [navigator.language]) {
    const code = lang.slice(0, 2).toLowerCase();
    if (code === 'vi' || code === 'en' || code === 'lo' || code === 'km') return code;
  }
  return 'vi';
}

export function translate(locale: Locale, key: Key, params?: Record<string, string | number>): string {
  const s = dicts[locale][key] ?? en[key];
  return params ? s.replace(/\{(\w+)\}/g, (_, k) => String(params[k] ?? '')) : s;
}

/** Non-React access (game engine, toasts). */
export const t = (key: Key, params?: Record<string, string | number>) => translate(store.get().locale, key, params);

export function visitorName(locale: Locale, adj: number, noun: number): string {
  const n = names[locale];
  const a = n.adj[adj % n.adj.length];
  const b = n.noun[noun % n.noun.length];
  return adjFirst[locale] ? `${a} ${b}` : `${b} ${a}`;
}

export function formatTime(locale: Locale, ms: number): string {
  return new Intl.DateTimeFormat(locale === 'lo' ? 'lo-LA' : locale === 'km' ? 'km-KH' : locale, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Asia/Bangkok', // UTC+7, same clock as Hanoi, Vientiane and Phnom Penh
  }).format(ms);
}
