import { useEffect, useState } from 'react';
import { store, useStore } from '../store.ts';
import { loadContent, randomRiddle, randomSaying, randomWish, type Riddle, type Saying } from '../content/sayings.ts';
import { Modal, closePanel, useT } from './common.tsx';

/**
 * Wish tree plaza: pick a wish from the tree, shake the tube for a folk proverb, or solve a
 * folk riddle. All content is local; nothing is sent to the server or stored about the visitor.
 */
export function FunPanel() {
  const t = useT();
  const fun = useStore((s) => s.fun);
  const title = fun === 'wish' ? t('wish.title') : fun === 'sticks' ? t('sticks.title') : t('riddle.title');
  return (
    <Modal title={title} onClose={closePanel} closeLabel={t('fun.close')}>
      <div className="fun-tabs seg three">
        {(['wish', 'sticks', 'riddle'] as const).map((k) => (
          <button key={k} className={fun === k ? 'active' : ''} onClick={() => store.set({ fun: k })}>
            {t(k === 'wish' ? 'wish.title' : k === 'sticks' ? 'sticks.title' : 'riddle.title')}
          </button>
        ))}
      </div>
      {fun === 'wish' ? <WishCard /> : fun === 'sticks' ? <SticksCard /> : <RiddleCard />}
    </Modal>
  );
}

/** re-renders once the big collections have arrived, so the next draw can use them */
function useContent() {
  const [, setReady] = useState(false);
  useEffect(() => {
    let live = true;
    loadContent().then(() => live && setReady(true));
    return () => {
      live = false;
    };
  }, []);
}

function WishCard() {
  const t = useT();
  const locale = useStore((s) => s.locale);
  useContent();
  const [w, setW] = useState(() => randomWish(locale));
  const [flip, setFlip] = useState(0);
  const again = () => {
    setW(randomWish(locale, w[1]));
    setFlip((n) => n + 1);
  };
  return (
    <div className="fun-card">
      <p key={flip} className="fun-text wish-text">
        🧧 {w[0]}
      </p>
      <p className="muted small">{t('wish.note')}</p>
      <button className="primary sm" onClick={again}>
        {t('wish.again')}
      </button>
    </div>
  );
}

function SticksCard() {
  const t = useT();
  const locale = useStore((s) => s.locale);
  useContent();
  const [s, setS] = useState<[Saying, number] | null>(null);
  const [shaking, setShaking] = useState(false);
  const shake = () => {
    if (shaking) return;
    setShaking(true);
    window.setTimeout(() => {
      setS((cur) => randomSaying(locale, cur?.[1]));
      setShaking(false);
    }, 900);
  };
  return (
    <div className="fun-card">
      <div className={`stick-tube ${shaking ? 'shaking' : ''}`} aria-hidden="true">
        🎋
      </div>
      {s && !shaking && (
        <div key={s[1]} className="fun-text">
          <p className="saying">“{s[0].text}”</p>
          <p>
            <strong>{t('sticks.meaning')}:</strong> {s[0].meaning}
          </p>
        </div>
      )}
      <p className="muted small">{t('sticks.note')}</p>
      <button className="primary sm" onClick={shake} disabled={shaking}>
        {s ? t('sticks.again') : t('sticks.shake')}
      </button>
    </div>
  );
}

function RiddleCard() {
  const t = useT();
  const locale = useStore((s) => s.locale);
  useContent();
  const [r, setR] = useState<[Riddle, number]>(() => randomRiddle(locale));
  const [picked, setPicked] = useState<number[]>([]);
  const [solved, setSolved] = useState(0);
  const done = picked.includes(r[0].answer);
  const pick = (i: number) => {
    if (done || picked.includes(i)) return;
    setPicked((p) => [...p, i]);
    if (i === r[0].answer && picked.length === 0) setSolved((n) => n + 1);
  };
  const next = () => {
    setR(randomRiddle(locale, r[1]));
    setPicked([]);
  };
  const last = picked[picked.length - 1];
  return (
    <div className="fun-card">
      <p className="fun-text riddle-q">{r[0].q}</p>
      <div className="riddle-options">
        {r[0].options.map((o, i) => (
          <button
            key={i}
            className={`riddle-opt ${picked.includes(i) ? (i === r[0].answer ? 'right' : 'wrong') : ''}`}
            onClick={() => pick(i)}
            disabled={done && i !== r[0].answer}
          >
            {o}
          </button>
        ))}
      </div>
      <p className="riddle-result" role="status">
        {last === undefined ? '' : last === r[0].answer ? t('riddle.right') : t('riddle.wrong')}
      </p>
      <div className="fun-row">
        <span className="muted small">{t('riddle.score', { n: solved })}</span>
        <button className="primary sm" onClick={next}>
          {t('riddle.next')}
        </button>
      </div>
    </div>
  );
}
