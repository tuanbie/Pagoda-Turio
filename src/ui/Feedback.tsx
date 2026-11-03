import { useState } from 'react';
import { FEEDBACK_MAX, type FeedbackInput } from '@sontu/shared';
import { store, useStore } from '../store.ts';
import { BACKEND } from '../net/Net.ts';
import { Modal, useT } from './common.tsx';
import { siteConfig } from '../config.ts';

/** Private message to the developer: what should be improved. */
export function FeedbackPanel() {
  const t = useT();
  const locale = useStore((s) => s.locale);
  const [kind, setKind] = useState<FeedbackInput['kind']>('idea');
  const [message, setMessage] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'done' | 'error' | 'short'>('idle');
  const close = () => store.set({ panel: null });

  const send = async () => {
    if (message.trim().length < 3) return setState('short');
    setState('sending');
    try {
      const res = await fetch(`${BACKEND}/api/feedback`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        // no name, contact or other personal data: only what is needed to read the feedback
        body: JSON.stringify({ kind, message, locale } satisfies FeedbackInput),
      });
      setState(res.ok ? 'done' : 'error');
    } catch {
      setState('error');
    }
  };

  return (
    <Modal title={t('feedback.title')} onClose={close} closeLabel={t('feedback.close')}>
      {state === 'done' ? (
        <div className="feedback-done">
          <p>{t('feedback.thanks')}</p>
          <ContactLinks />
          <button className="primary sm" onClick={close}>
            {t('feedback.close')}
          </button>
        </div>
      ) : (
        <form
          className="feedback"
          onSubmit={(e) => {
            e.preventDefault();
            void send();
          }}
        >
          <p className="muted small">🔒 {t('feedback.intro')}</p>
          <div className="seg three" role="radiogroup">
            {(['bug', 'idea', 'other'] as const).map((k) => (
              <button type="button" key={k} role="radio" aria-checked={kind === k} className={kind === k ? 'active' : ''} onClick={() => setKind(k)}>
                {t(`feedback.kind.${k}`)}
              </button>
            ))}
          </div>
          <label>
            <span>{t('feedback.message')}</span>
            <textarea
              value={message}
              maxLength={FEEDBACK_MAX}
              rows={5}
              placeholder={t('feedback.placeholder')}
              onChange={(e) => {
                setMessage(e.target.value);
                if (state === 'short') setState('idle');
              }}
              autoFocus
            />
            <small className="muted">
              {message.length} / {FEEDBACK_MAX}
            </small>
          </label>
          <p className="muted small">{t('feedback.privacy')}</p>
          {state === 'short' && <p className="error">{t('feedback.tooShort')}</p>}
          {state === 'error' && <p className="error">{t('feedback.error')}</p>}
          <button className="primary" type="submit" disabled={state === 'sending'}>
            {state === 'sending' ? t('feedback.sending') : t('feedback.send')}
          </button>
          <ContactLinks />
        </form>
      )}
    </Modal>
  );
}

/** Discord / email as alternatives to the form */
function ContactLinks() {
  const t = useT();
  const { discord, email } = siteConfig.contact;
  return (
    <div className="contact-links">
      <span className="muted small">{t('feedback.orContact')}</span>
      <div>
        <a href={discord} target="_blank" rel="noreferrer" className="contact discord">
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
            <path fill="currentColor" d="M19.3 5.3A16.5 16.5 0 0 0 15.2 4l-.5 1a15 15 0 0 0-5.4 0L8.8 4a16.5 16.5 0 0 0-4.1 1.3C2.1 9.2 1.4 13 1.7 16.7a16.6 16.6 0 0 0 5 2.5l1.1-1.7c-.6-.2-1.2-.5-1.7-.9l.4-.3a11.8 11.8 0 0 0 10.1 0l.4.3c-.5.4-1.1.7-1.7.9l1.1 1.7a16.5 16.5 0 0 0 5-2.5c.4-4.3-.7-8.1-2.1-11.4zM8.7 14.5c-1 0-1.8-.9-1.8-2s.8-2 1.8-2 1.8.9 1.8 2-.8 2-1.8 2zm6.6 0c-1 0-1.8-.9-1.8-2s.8-2 1.8-2 1.8.9 1.8 2-.8 2-1.8 2z" />
          </svg>
          Discord
        </a>
        <a href={`mailto:${email}?subject=${encodeURIComponent('Góp ý Tịnh Tâm Tự')}`} className="contact mail">
          ✉️ {email}
        </a>
      </div>
    </div>
  );
}
