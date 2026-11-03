import { useCallback, useEffect, useState } from 'react';
import { MAX_NAME_CHARS, type RoomInfo } from '@sontu/shared';
import { store, toast, useStore, type Quality } from '../store.ts';
import { LOCALES, visitorName, type Locale } from '../i18n/index.ts';
import { Net } from '../net/Net.ts';
import { runtime } from '../runtime.ts';
import { siteConfig } from '../config.ts';
import { LegalLinks, Modal, closePanel, useT } from './common.tsx';

const TINTS = ['#8b7f6c', '#9a8770', '#7d7466', '#a08a6a', '#8a8378', '#97806a'];

export function LanguageSelect() {
  const t = useT();
  const locale = useStore((s) => s.locale);
  return (
    <div className="lang-select" role="radiogroup" aria-label={t('settings.language')}>
      {LOCALES.map((l) => (
        <button key={l.id} role="radio" aria-checked={locale === l.id} lang={l.id} className={locale === l.id ? 'active' : ''} onClick={() => store.set({ locale: l.id as Locale })}>
          {l.label}
        </button>
      ))}
    </div>
  );
}

function NameField() {
  const t = useT();
  const current = useStore((s) => s.myName);
  const [name, setName] = useState(current);
  return (
    <form
      className="name-field"
      onSubmit={(e) => {
        e.preventDefault();
        const n = name.trim().slice(0, MAX_NAME_CHARS);
        runtime.game?.rename(n);
        toast(t('settings.nameSaved'));
      }}
    >
      <input value={name} maxLength={MAX_NAME_CHARS} placeholder={t('welcome.namePh')} onChange={(e) => setName(e.target.value)} aria-label={t('settings.name')} />
      <button className="toggle" type="submit" disabled={name.trim() === current}>
        {t('settings.nameSave')}
      </button>
    </form>
  );
}

function Slider({ label, desc, value, onChange }: { label: string; desc?: string; value: number; onChange: (v: number) => void }) {
  return (
    <label className="slider">
      <div>
        <strong>{label}</strong>
        {desc && <small>{desc}</small>}
      </div>
      <input type="range" min={0} max={1} step={0.05} value={value} onChange={(e) => onChange(+e.target.value)} />
    </label>
  );
}

export function SettingsPanel() {
  const t = useT();
  const s = useStore((x) => x);
  const vol = (k: keyof typeof s.volumes) => (v: number) => store.set({ volumes: { ...s.volumes, [k]: v } });
  const [askUltra, setAskUltra] = useState(false);
  return (
    <Modal title={t('settings.title')} onClose={closePanel} closeLabel={t('settings.close')}>
      <h3>{t('settings.name')}</h3>
      <NameField />
      <h3>{t('settings.language')}</h3>
      <LanguageSelect />

      <h3>{t('settings.sounds')}</h3>
      <Slider label={t('settings.ambient')} desc={t('settings.ambientDesc')} value={s.volumes.ambient} onChange={vol('ambient')} />
      <Slider label={t('settings.effects')} desc={t('settings.effectsDesc')} value={s.volumes.effects} onChange={vol('effects')} />
      <Slider label={t('settings.music')} value={s.volumes.music} onChange={vol('music')} />

      <div className="row-card">
        <div>
          <strong>{t('chant.title')}</strong>
          <small>{t('chant.desc')}</small>
        </div>
        <button
          className={`toggle ${s.chantOn ? 'on' : ''}`}
          onClick={async () => {
            if (!s.chantOn && !s.soundOn) await runtime.toggleSound();
            store.set({ chantOn: !s.chantOn });
          }}
        >
          {s.chantOn ? t('chant.stop') : t('chant.play')}
        </button>
      </div>
      <Slider label={t('settings.chant')} value={s.volumes.chant} onChange={vol('chant')} />

      <div className="row-card">
        <div>
          <strong>{t('settings.background')}</strong>
          <small>{s.backgroundPlay ? t('settings.bgOn') : t('settings.bgOff')}</small>
        </div>
        <button className={`toggle ${s.backgroundPlay ? 'on' : ''}`} aria-pressed={s.backgroundPlay} onClick={() => store.set({ backgroundPlay: !s.backgroundPlay })}>
          {s.backgroundPlay ? 'ON' : 'OFF'}
        </button>
      </div>

      <h3>{t('settings.quality')}</h3>
      <div className="seg seg-quality">
        {(['auto', 'ultra', 'high', 'medium', 'low'] as Quality[]).map((q) => (
          <button
            key={q}
            className={s.quality === q ? 'active' : ''}
            onClick={() => {
              if (q === s.quality) return;
              // ultra is heavy: explain first, switch only after the visitor confirms
              if (q === 'ultra') return setAskUltra(true);
              setAskUltra(false);
              store.set({ quality: q });
              runtime.rebuildGame?.();
            }}
          >
            {t(q === 'auto' ? 'settings.qAuto' : q === 'ultra' ? 'settings.qUltra' : q === 'high' ? 'settings.qHigh' : q === 'medium' ? 'settings.qMedium' : 'settings.qLow')}
            {q === 'auto' && s.autoTier && (
              <small className="auto-tier">{t(s.autoTier === 'high' ? 'settings.qHigh' : s.autoTier === 'medium' ? 'settings.qMedium' : 'settings.qLow')}</small>
            )}
          </button>
        ))}
      </div>
      {askUltra && (
        <div className="ultra-confirm" role="alertdialog" aria-labelledby="ultra-title">
          <strong id="ultra-title">{t('ultra.title')}</strong>
          <p>{t('ultra.text')}</p>
          <div className="fun-row">
            <button className="text-btn" onClick={() => setAskUltra(false)}>
              {t('ultra.cancel')}
            </button>
            <button
              className="primary sm"
              onClick={() => {
                setAskUltra(false);
                store.set({ quality: 'ultra' });
                runtime.rebuildGame?.();
              }}
            >
              {t('ultra.confirm')}
            </button>
          </div>
        </div>
      )}

      <button className="link-btn" onClick={() => store.set({ panel: 'feedback' })}>
        💬 {t('feedback.open')}
      </button>
      <details>
        <summary>{t('settings.controls')}</summary>
        <p className="pre">{t('settings.controlsText')}</p>
      </details>
      <details>
        <summary>{t('settings.credits')}</summary>
        <p>{t('settings.creditsText')}</p>
        <p className="muted small">{t('app.disclaimer', { name: siteConfig.developer.name })}</p>
      </details>
      <details>
        <summary>{t('settings.privacy')}</summary>
        <p className="pre">{t('settings.privacyText', { email: siteConfig.contact.email })}</p>
        <LegalLinks />
      </details>
    </Modal>
  );
}

export function ServersPanel() {
  const t = useT();
  const current = useStore((s) => s.room?.id);
  const [rooms, setRooms] = useState<RoomInfo[] | null>(null);
  const [error, setError] = useState(false);
  const load = useCallback(() => {
    Net.rooms()
      .then((r) => {
        setRooms(r);
        setError(false);
      })
      .catch(() => setError(true));
  }, []);
  useEffect(() => {
    load();
    const id = setInterval(load, 3000);
    return () => clearInterval(id);
  }, [load]);
  return (
    <Modal title={t('servers.title')} onClose={closePanel} closeLabel={t('servers.close')}>
      {!rooms && !error && <p className="muted">{t('servers.loading')}</p>}
      {error && <p className="muted">{t('servers.error')}</p>}
      <ul className="server-list">
        {rooms?.map((r) => {
          const full = r.count >= r.cap;
          const isCur = r.id === current;
          return (
            <li key={r.id}>
              <button
                disabled={(full && !isCur) || isCur}
                onClick={() => {
                  runtime.net?.switchRoom(r.id);
                  closePanel();
                }}
              >
                <span className="name">{t('servers.name', { n: r.num })}</span>
                <span className="meter">
                  <i style={{ width: `${(r.count / r.cap) * 100}%` }} />
                </span>
                <span className="count">
                  {r.count} / {r.cap}
                </span>
                {isCur && <em>{t('servers.current')}</em>}
                {full && !isCur && <em className="full">{t('servers.full')}</em>}
              </button>
            </li>
          );
        })}
      </ul>
      <p className="muted small">{t('servers.note')}</p>
    </Modal>
  );
}

export function VisitorsPanel() {
  const t = useT();
  const locale = useStore((s) => s.locale);
  const visitors = useStore((s) => s.visitors);
  return (
    <Modal title={t('visitors.title')} onClose={closePanel} closeLabel={t('visitors.close')}>
      <ul className="visitor-list">
        <li>
          <span className="swatch self" />
          {t('visitors.you')}
        </li>
        {visitors.map((v) => (
          <li key={v.id}>
            <span className="swatch" style={{ background: TINTS[v.tint % TINTS.length] }} />
            {v.name || visitorName(locale, v.adj, v.noun)}
          </li>
        ))}
      </ul>
    </Modal>
  );
}

function CopyRow({ value, copyText, sub }: { value: string; copyText: string; sub: string }) {
  const t = useT();
  const [copied, setCopied] = useState(false);
  return (
    <div className="row-card">
      <div>
        <strong>{value}</strong>
        <small>{sub}</small>
      </div>
      <button
        className="toggle"
        onClick={() =>
          navigator.clipboard
            .writeText(copyText)
            .then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1800);
            })
            .catch(() => {})
        }
      >
        {copied ? t('donate.copied') : t('donate.copy')}
      </button>
    </div>
  );
}

/** Voluntary support for the developer — software costs only, never a temple donation. */
export function DonatePanel() {
  const t = useT();
  const d = siteConfig.donation;
  const dev = siteConfig.developer;
  return (
    <Modal title={t('donate.title')} onClose={closePanel} closeLabel={t('donate.close')}>
      <p>
        {t('donate.by', { name: dev.name })}{' '}
        {dev.url && (
          <a href={dev.url} target="_blank" rel="noreferrer">
            {dev.url.replace(/^https?:\/\//, '')}
          </a>
        )}
      </p>
      <p>{t('donate.text')}</p>
      <p className="donate-disclaimer" role="note">
        {t('donate.notReligious')}
      </p>
      <LegalLinks />
      {d.qr && (
        <figure className="donate-qr">
          <img src={d.qr} alt={t('donate.qrAlt')} width={337} height={371} loading="lazy" />
          <figcaption>{t('donate.scan')}</figcaption>
        </figure>
      )}
      {d.memo && <CopyRow value={d.memo} copyText={d.memo} sub={t('donate.memo')} />}
      {d.accountNumber && <CopyRow value={d.accountNumber} copyText={d.accountNumber.replace(/\s/g, '')} sub={`${d.bank} · ${d.accountName}`} />}
      <p className="donate-note">☕ {t('donate.note')}</p>
      <button className="link-btn" onClick={() => store.set({ panel: 'feedback' })}>
        💬 {t('feedback.open')}
      </button>
      {d.links.map((l) => (
        <a key={l.url} className="link-btn" href={l.url} target="_blank" rel="noreferrer">
          {l.label}
        </a>
      ))}
    </Modal>
  );
}
