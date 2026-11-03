import { SONGS, type DjState } from '@sontu/shared';
import { serverNow } from '../store.ts';

type Bus = 'ambient' | 'effects' | 'chant' | 'music' | 'hall';

/** Deterministic PRNG so every visitor generates the same notes for the same beat. */
function hash(n: number) {
  let x = Math.imul(n ^ 0x9e3779b9, 0x85ebca6b);
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35);
  x ^= x >>> 16;
  return (x >>> 0) / 4294967296;
}

const CHANT_BEAT_S = 60 / 66;
const CHANT_PATTERN = [0, 0, 0, 0, 2, 0, -2, 0, 0, 0, 3, 2, 0, 0, -2, 0];
const MAJOR = [0, 2, 4, 5, 7, 9, 11];
const PENTA = [0, 2, 4, 7, 9];
const midi = (m: number) => 440 * 2 ** ((m - 69) / 12);

/** Hall music: slow, spacious, pentatonic — bamboo flute over a singing-bowl drone. */
const HALL_BEAT_S = 60 / 52;

/**
 * Everything audible is synthesised here — no audio files to download, no licensing.
 * Shared sounds (communal chanting, hall music, DJ songs) are anchored to SERVER time,
 * so every visitor hears the same note at the same moment.
 */
export class AudioEngine {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private buses = {} as Record<Bus, GainNode>;
  private reverb!: ConvolverNode;
  private noise!: AudioBuffer;
  private night = false;
  private scheduler = 0;
  private ambientTimer = 0;
  private volumes = { ambient: 0.4, effects: 0.8, chant: 0.7, music: 0.6 };
  private muted = false;

  private chantAnchor: number | null = null;
  private serviceAnchor: number | null = null;
  private musicLevel = 0;
  private musicEnabled = true;
  private hallLevel = 0;
  private dj: DjState | null = null;
  private nextBeat = new Map<string, number>();

  get ready() {
    return !!this.ctx && this.ctx.state === 'running';
  }

  /** Must be called from a user gesture (browser autoplay policy). */
  async unlock() {
    if (!this.ctx) {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return false;
      const ctx = (this.ctx = new Ctx({ latencyHint: 'playback' }));
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 3;
      this.master = ctx.createGain();
      this.master.connect(comp).connect(ctx.destination);
      // a small synthetic room reverb gives wood and bronze their space
      this.reverb = ctx.createConvolver();
      this.reverb.buffer = this.impulse(2.6, 2.2);
      const wet = ctx.createGain();
      wet.gain.value = 0.35;
      this.reverb.connect(wet).connect(this.master);
      for (const b of ['ambient', 'effects', 'chant', 'music', 'hall'] as Bus[]) {
        this.buses[b] = ctx.createGain();
        this.buses[b].connect(this.master);
        if (b !== 'ambient' && b !== 'music') this.buses[b].connect(this.reverb);
      }
      this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      this.applyVolumes();
      this.startAmbient();
      this.scheduler = window.setInterval(() => this.schedule(), 90);
    }
    if (this.ctx.state !== 'running') await this.ctx.resume().catch(() => {});
    return this.ready;
  }

  private impulse(seconds: number, decay: number) {
    const ctx = this.ctx!;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** decay;
    }
    return buf;
  }

  setMuted(m: boolean) {
    this.muted = m;
    if (this.ctx) this.ramp(this.master.gain, m ? 0 : 1, 0.4);
  }

  setVolumes(v: typeof this.volumes) {
    this.volumes = { ...v };
    this.applyVolumes();
  }

  private applyVolumes() {
    if (!this.ctx) return;
    this.master.gain.value = this.muted ? 0 : 1;
    this.ramp(this.buses.ambient.gain, this.volumes.ambient ** 2 * 0.8, 0.2);
    this.ramp(this.buses.effects.gain, this.volumes.effects ** 2, 0.2);
    this.ramp(this.buses.chant.gain, this.volumes.chant ** 2 * 0.9, 0.2);
    this.ramp(this.buses.music.gain, this.volumes.music ** 2 * this.musicLevel * (this.musicEnabled ? 1 : 0) * 0.7, 0.3);
    // hall music shares the music slider; fades in over ~1.5 s as you walk in
    this.ramp(this.buses.hall.gain, this.volumes.music ** 2 * this.hallLevel * 0.8, 1.5);
  }

  async suspend() {
    await this.ctx?.suspend().catch(() => {});
  }
  async resume() {
    await this.ctx?.resume().catch(() => {});
  }

  private ramp(p: AudioParam, v: number, s: number) {
    const t = this.ctx!.currentTime;
    p.cancelScheduledValues(t);
    p.setValueAtTime(p.value, t);
    p.linearRampToValueAtTime(v, t + s);
  }

  /** ctx time for a server timestamp */
  private at(serverMs: number) {
    return this.ctx!.currentTime + (serverMs - serverNow()) / 1000;
  }

  // ---------------- one-shot effects ----------------
  /** Temple bell: inharmonic partials with long, beating decay. `gain` lets distant bells be quieter. */
  bell(bus: Bus = 'effects', when?: number, base = 196, gain = 1) {
    if (!this.ctx) return;
    const t = when ?? this.ctx.currentTime;
    const partials = [
      [0.5, 0.35, 9],
      [1, 0.5, 7],
      [1.003, 0.3, 7],
      [2.0, 0.25, 4.5],
      [2.76, 0.18, 3.2],
      [5.4, 0.08, 1.6],
      [8.9, 0.04, 0.9],
    ];
    for (const [ratio, amp, dur] of partials) {
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.frequency.value = base * ratio;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(amp * 0.5 * gain, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(this.buses[bus]);
      o.start(t);
      o.stop(t + dur);
    }
  }

  /**
   * Church bells: a short peal of four tower bells (western bell partials: hum, prime, minor
   * third "tierce", fifth "quint", octave "nominal") — brighter and more tonal than the temple bell.
   */
  churchBell(gain = 1) {
    if (!this.ctx) return;
    const t0 = this.ctx.currentTime;
    const notes = [72, 69, 67, 64]; // a descending peal
    const partials: [number, number, number][] = [
      [0.5, 0.25, 6],
      [1, 0.4, 4.5],
      [1.2, 0.22, 3.2],
      [1.5, 0.14, 2.6],
      [2, 0.28, 2.2],
      [2.5, 0.08, 1.4],
      [3, 0.06, 1.0],
    ];
    notes.forEach((n, i) => {
      const t = t0 + i * 0.55;
      for (const [ratio, amp, dur] of partials) {
        const o = this.ctx!.createOscillator();
        const g = this.ctx!.createGain();
        o.frequency.value = midi(n - 12) * ratio;
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(amp * 0.45 * gain, t + 0.006);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        o.connect(g).connect(this.buses.effects);
        o.start(t);
        o.stop(t + dur);
      }
    });
  }

  /** which place's music plays in the "hall" bus: temple (bowls, flute) or church (organ) */
  private place: 'pagoda' | 'church' = 'pagoda';
  setPlace(p: 'pagoda' | 'church') {
    this.place = p;
  }

  /** Big temple drum: pitched-down membrane + skin slap. */
  drum(gain = 1) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.frequency.setValueAtTime(95, t);
    o.frequency.exponentialRampToValueAtTime(48, t + 0.5);
    g.gain.setValueAtTime(1.2 * gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 1.6);
    o.connect(g).connect(this.buses.effects);
    o.start(t);
    o.stop(t + 1.7);
    this.noiseBurst('effects', t, 600, 1, 0.12, 0.5 * gain);
  }

  /**
   * Wooden fish (mõ): modal synthesis of a hollow carved block.
   * A short mallet "tock" excites a few resonant modes of the wood plus the
   * cavity resonance of the slot — each mode is a band-passed noise impulse
   * with its own decay, which is what makes real wood sound woody.
   */
  moktak(bus: Bus = 'effects', when?: number, gain = 0.9) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = when ?? ctx.currentTime;
    const v = 0.985 + Math.random() * 0.03; // tiny variation, like striking a slightly different spot
    const modes: [number, number, number, number][] = [
      // freq, Q, decay(s), level
      [395, 18, 0.16, 1.0], // cavity resonance — the hollow "tok"
      [820, 28, 0.11, 0.75], // first bending mode of the body
      [1490, 32, 0.07, 0.4],
      [2380, 36, 0.045, 0.22],
      [3650, 30, 0.03, 0.12],
    ];
    const exciter = ctx.createBufferSource();
    exciter.buffer = this.noise;
    const exGain = ctx.createGain();
    exGain.gain.setValueAtTime(1, t);
    exGain.gain.exponentialRampToValueAtTime(0.001, t + 0.012);
    exciter.connect(exGain);
    const out = ctx.createGain();
    out.gain.value = gain * 2.2;
    for (const [f, q, decay, level] of modes) {
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = f * v;
      bp.Q.value = q;
      const env = ctx.createGain();
      env.gain.setValueAtTime(level, t);
      env.gain.exponentialRampToValueAtTime(0.0001, t + decay * 2.2);
      exGain.connect(bp).connect(env).connect(out);
    }
    // the low "body" thump you feel more than hear
    const body = ctx.createOscillator();
    const bodyG = ctx.createGain();
    body.frequency.setValueAtTime(400 * v, t);
    body.frequency.exponentialRampToValueAtTime(330 * v, t + 0.09);
    bodyG.gain.setValueAtTime(0.35 * gain, t);
    bodyG.gain.exponentialRampToValueAtTime(0.0001, t + 0.13);
    body.connect(bodyG).connect(this.buses[bus]);
    out.connect(this.buses[bus]);
    exciter.start(t, Math.random() * 1.5, 0.03);
    body.start(t);
    body.stop(t + 0.15);
  }

  bead() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.noiseBurst('effects', t, 3200, 8, 0.03, 0.5);
    this.noiseBurst('effects', t + 0.045, 2600, 8, 0.03, 0.35);
  }

  /** gentle "plop" when a fish slips into the water — soft, low and short */
  splash() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1400;
    const g = ctx.createGain();
    g.gain.value = 0.35;
    lp.connect(g).connect(this.buses.effects);
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, t);
    env.gain.linearRampToValueAtTime(0.08, t + 0.03);
    env.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
    src.connect(env).connect(lp);
    src.start(t, Math.random(), 0.5);
    // one soft bubble
    const o = ctx.createOscillator();
    const og = ctx.createGain();
    o.frequency.setValueAtTime(380, t + 0.08);
    o.frequency.exponentialRampToValueAtTime(720, t + 0.16);
    og.gain.setValueAtTime(0.0001, t + 0.08);
    og.gain.linearRampToValueAtTime(0.025, t + 0.1);
    og.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
    o.connect(og).connect(lp);
    o.start(t + 0.08);
    o.stop(t + 0.22);
  }

  /** tea pouring: a thin trickle (band-passed noise) rising in pitch as the cup fills */
  pour() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + 0.6;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 3;
    bp.frequency.setValueAtTime(900, t);
    bp.frequency.linearRampToValueAtTime(1700, t + 1.9);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.09, t + 0.15);
    g.gain.setValueAtTime(0.09, t + 1.7);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 2.1);
    src.connect(bp).connect(g).connect(this.buses.effects);
    src.start(t);
    src.stop(t + 2.2);
  }

  /** a quiet sip */
  sip() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    for (const d of [0.7, 1.5]) this.noiseBurst('effects', t + d, 3000, 2, 0.18, 0.04);
  }

  /** soft notification for chat */
  ping() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.frequency.value = 1320;
    g.gain.setValueAtTime(0.05, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
    o.connect(g).connect(this.buses.effects);
    o.start(t);
    o.stop(t + 0.4);
  }

  private noiseBurst(bus: Bus, t: number, freq: number, q: number, dur: number, amp: number) {
    const src = this.ctx!.createBufferSource();
    src.buffer = this.noise;
    const f = this.ctx!.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = freq;
    f.Q.value = q;
    const g = this.ctx!.createGain();
    g.gain.setValueAtTime(amp, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f).connect(g).connect(this.buses[bus]);
    src.start(t, Math.random() * 1.5, dur + 0.02);
  }

  // ---------------- ambience (wind always, birds by day) ----------------
  private startAmbient() {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 380;
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    lfo.frequency.value = 0.06;
    lfoGain.gain.value = 200;
    lfo.connect(lfoGain).connect(filter.frequency);
    const g = ctx.createGain();
    g.gain.value = 0.1;
    src.connect(filter).connect(g).connect(this.buses.ambient);
    src.start();
    lfo.start();
    const loop = () => {
      if (!this.night) this.birdCall();
      this.ambientTimer = window.setTimeout(loop, 2500 + Math.random() * 6000);
    };
    loop();
  }

  setNight(n: boolean) {
    this.night = n;
  }

  private birdCall() {
    const ctx = this.ctx!;
    let t = ctx.currentTime + 0.05;
    const notes = 2 + Math.floor(Math.random() * 4);
    const base = 2200 + Math.random() * 1600;
    const pan = ctx.createStereoPanner();
    pan.pan.value = Math.random() * 1.6 - 0.8;
    pan.connect(this.buses.ambient);
    for (let i = 0; i < notes; i++) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      const f = base * (1 + (Math.random() - 0.3) * 0.4);
      o.frequency.setValueAtTime(f, t);
      o.frequency.exponentialRampToValueAtTime(f * (1.2 + Math.random() * 0.4), t + 0.09);
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.05, t + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
      o.connect(g).connect(pan);
      o.start(t);
      o.stop(t + 0.14);
      t += 0.13 + Math.random() * 0.08;
    }
  }

  // ---------------- chanting ----------------
  setChant(on: boolean) {
    this.chantAnchor = on ? serverNow() + 300 : null;
    this.nextBeat.delete('chant');
  }

  setService(startsAt: number | null) {
    if (startsAt === this.serviceAnchor) return;
    this.serviceAnchor = startsAt;
    this.nextBeat.delete('service');
  }

  private chantVoice(when: number, semis: number, dur: number) {
    const ctx = this.ctx!;
    const f0 = 123.5 * 2 ** (semis / 12);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, when);
    g.gain.linearRampToValueAtTime(0.1, when + 0.06);
    g.gain.setValueAtTime(0.1, when + dur * 0.55);
    g.gain.exponentialRampToValueAtTime(0.0001, when + dur);
    const mix = ctx.createGain();
    for (const [freq, q] of [
      [520, 6],
      [900, 8],
      [2400, 10],
    ]) {
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = freq * (semis % 2 ? 1.06 : 1);
      bp.Q.value = q;
      mix.connect(bp).connect(g);
    }
    for (const det of [-6, 0, 7]) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f0;
      o.detune.value = det;
      o.connect(mix);
      o.start(when);
      o.stop(when + dur + 0.05);
    }
    g.connect(this.buses.chant);
  }

  private scheduleChant(key: 'chant' | 'service', anchor: number, horizon: number) {
    const beatMs = CHANT_BEAT_S * 1000;
    let k = this.nextBeat.get(key) ?? Math.max(0, Math.ceil((serverNow() - anchor) / beatMs));
    while (anchor + k * beatMs < horizon) {
      const when = this.at(anchor + k * beatMs);
      if (when >= this.ctx!.currentTime - 0.01) {
        this.moktak('chant', when, 0.5);
        this.chantVoice(when, CHANT_PATTERN[k % CHANT_PATTERN.length], CHANT_BEAT_S * 0.95);
        if (k % 32 === 0) this.bell('chant', when, 147);
      }
      k++;
    }
    this.nextBeat.set(key, k);
  }

  // ---------------- hall music (fades in near / inside the halls) ----------------
  setHallProximity(level: number) {
    if (Math.abs(level - this.hallLevel) < 0.02) return;
    this.hallLevel = level;
    this.applyVolumes();
  }

  private scheduleHall(horizon: number) {
    const beatMs = HALL_BEAT_S * 1000;
    let k = this.nextBeat.get('hall') ?? Math.ceil(serverNow() / beatMs);
    while (k * beatMs < horizon) {
      const when = this.at(k * beatMs);
      if (when >= this.ctx!.currentTime - 0.01) this.hallStep(k, when);
      k++;
    }
    this.nextBeat.set('hall', k);
  }

  private hallStep(k: number, t: number) {
    if (this.place === 'church') return this.organStep(k, t);
    const ctx = this.ctx!;
    const out = this.buses.hall;
    const bar = Math.floor(k / 8);
    const root = 50; // D3
    // singing-bowl drone every 2 bars
    if (k % 16 === 0) {
      for (const [ratio, amp] of [
        [1, 0.16],
        [2.71, 0.06],
        [5.15, 0.025],
      ]) {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.frequency.value = midi(root - 12) * ratio;
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(amp, t + 0.05);
        g.gain.exponentialRampToValueAtTime(0.0001, t + HALL_BEAT_S * 15);
        o.connect(g).connect(out);
        o.start(t);
        o.stop(t + HALL_BEAT_S * 15);
      }
    }
    // soft pad on the chord of the bar
    if (k % 8 === 0) {
      const degree = [0, 5, 3, 4][bar % 4];
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 900;
      const g = ctx.createGain();
      const dur = HALL_BEAT_S * 8;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.05, t + 1.2);
      g.gain.setValueAtTime(0.05, t + dur - 1.2);
      g.gain.linearRampToValueAtTime(0, t + dur + 0.4);
      lp.connect(g).connect(out);
      for (const step of [0, 2, 4]) {
        const deg = degree + step;
        const n = root + MAJOR[deg % 7] + 12 * Math.floor(deg / 7);
        const o = ctx.createOscillator();
        o.type = 'triangle';
        o.frequency.value = midi(n);
        o.connect(lp);
        o.start(t);
        o.stop(t + dur + 0.5);
      }
    }
    // bamboo flute: sparse pentatonic phrase, sine with vibrato + breath noise
    if (hash(k * 31 + 7) > 0.55) {
      const n = root + 12 + PENTA[Math.floor(hash(k * 17) * PENTA.length)] + (hash(k * 5) > 0.7 ? 12 : 0);
      const dur = HALL_BEAT_S * (1 + Math.floor(hash(k * 3) * 2));
      const o = ctx.createOscillator();
      const vib = ctx.createOscillator();
      const vibG = ctx.createGain();
      vib.frequency.value = 5;
      vibG.gain.value = 4;
      vib.connect(vibG).connect(o.detune);
      o.frequency.value = midi(n);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.07, t + 0.18);
      g.gain.setValueAtTime(0.07, t + dur * 0.6);
      g.gain.linearRampToValueAtTime(0, t + dur);
      o.connect(g).connect(out);
      o.start(t);
      vib.start(t);
      o.stop(t + dur + 0.05);
      vib.stop(t + dur + 0.05);
      this.noiseBurst('hall', t, midi(n) * 2, 3, 0.25, 0.03);
    }
    if (k % 32 === 0) this.bell('hall', t, 392, 0.35);
  }

  // ---------------- moonlight yard DJ ----------------
  /**
   * Church interior: a quiet pipe-organ improvisation — slow diatonic chords on soft flue
   * stops (8', 4', 2' as sine/triangle partials) with a pedal note. Generated, not a hymn.
   */
  private organStep(k: number, t: number) {
    const ctx = this.ctx!;
    const out = this.buses.hall;
    if (k % 8 !== 0) return;
    const bar = Math.floor(k / 8);
    const root = 53; // F3
    const prog = [0, 3, 5, 4, 0, 5, 1, 4];
    const degree = prog[bar % prog.length];
    const dur = HALL_BEAT_S * 8;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.045, t + 0.9);
    g.gain.setValueAtTime(0.045, t + dur - 0.6);
    g.gain.linearRampToValueAtTime(0, t + dur + 0.6);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2400;
    lp.connect(g).connect(out);
    const pipe = (freq: number, amp: number, type: OscillatorType) => {
      const o = ctx.createOscillator();
      const og = ctx.createGain();
      o.type = type;
      o.frequency.value = freq;
      og.gain.value = amp;
      o.connect(og).connect(lp);
      o.start(t);
      o.stop(t + dur + 0.8);
    };
    for (const step of [0, 2, 4]) {
      const deg = degree + step;
      const n = root + MAJOR[deg % 7] + 12 * Math.floor(deg / 7);
      pipe(midi(n), 0.5, 'sine'); // 8'
      pipe(midi(n + 12), 0.22, 'triangle'); // 4'
      pipe(midi(n + 24), 0.08, 'sine'); // 2'
    }
    pipe(midi(root - 12 + MAJOR[degree % 7]), 0.6, 'sine'); // pedal 16'
    // an occasional soft upper voice
    if (hash(bar * 13 + 1) > 0.5) {
      const n = root + 12 + MAJOR[(degree + 4 + Math.floor(hash(bar * 7) * 3)) % 7];
      pipe(midi(n + 12), 0.12, 'sine');
    }
  }

  setDj(d: DjState) {
    const same = this.dj && this.dj.s === d.s && this.dj.at === d.at;
    this.dj = d;
    if (!same) this.nextBeat.delete('party');
  }
  setMusicProximity(level: number) {
    if (Math.abs(level - this.musicLevel) < 0.02) return;
    this.musicLevel = level;
    this.applyVolumes();
  }
  setMusicEnabled(on: boolean) {
    this.musicEnabled = on;
    this.applyVolumes();
  }

  private scheduleParty(horizon: number) {
    const d = this.dj!;
    const song = SONGS[d.s];
    const stepMs = 60_000 / song.bpm / 4;
    const total = song.bars * 16;
    let k = this.nextBeat.get('party') ?? Math.max(0, Math.ceil((serverNow() - d.at) / stepMs));
    while (d.at + k * stepMs < horizon && k < total) {
      const when = this.at(d.at + k * stepMs);
      if (when >= this.ctx!.currentTime - 0.01) this.partyStep(d.s, k, when, stepMs / 1000);
      k++;
    }
    this.nextBeat.set('party', k);
  }

  private partyStep(si: number, k: number, t: number, stepS: number) {
    const ctx = this.ctx!;
    const song = SONGS[si];
    const out = this.buses.music;
    const s = k % 16;
    const bar = Math.floor(k / 16);
    const seed = si * 100_000 + k;
    if (song.style === 'lofi' && s % 2) t += stepS * 0.14;
    const fadeIn = Math.min(1, bar / 2 + s / 32);
    const kick = (vel: number) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.setValueAtTime(song.style === 'house' ? 130 : 110, t);
      o.frequency.exponentialRampToValueAtTime(42, t + 0.16);
      g.gain.setValueAtTime(vel * fadeIn, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
      o.connect(g).connect(out);
      o.start(t);
      o.stop(t + 0.4);
    };
    switch (song.style) {
      case 'house':
        if (s % 4 === 0) kick(1);
        if (s % 4 === 2) this.noiseBurst('music', t, 9000, 1.2, 0.07, 0.18 * fadeIn);
        if (s === 4 || s === 12) this.noiseBurst('music', t, 1600, 0.9, 0.16, 0.3 * fadeIn);
        break;
      case 'bossa':
        if (s === 0 || s === 6 || s === 8 || s === 14) kick(0.7);
        if ([3, 6, 10, 12].includes(s)) this.noiseBurst('music', t, 2400, 4, 0.05, 0.25 * fadeIn);
        if (s % 2 === 0) this.noiseBurst('music', t, 7000, 2, 0.04, 0.08 * fadeIn);
        break;
      case 'ambient':
        if (s === 0 && bar % 2 === 0) kick(0.5);
        break;
      default:
        if (s === 0 || s === 10) kick(0.9);
        if (s === 4 || s === 12) this.noiseBurst('music', t, 1800, 0.8, 0.18, 0.32 * fadeIn);
        if (s % 2 === 0) this.noiseBurst('music', t, 8000, 1.5, 0.05, (s % 4 ? 0.08 : 0.14) * fadeIn);
    }
    if (s === 0) {
      const degree = song.prog[bar % song.prog.length];
      const dur = stepS * 16;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = song.style === 'house' ? 2200 : 1100;
      const g = ctx.createGain();
      const lvl = (song.style === 'ambient' ? 0.09 : 0.06) * fadeIn;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(lvl, t + (song.style === 'ambient' ? 1 : 0.3));
      g.gain.setValueAtTime(lvl, t + dur - 0.4);
      g.gain.linearRampToValueAtTime(0, t + dur);
      lp.connect(g).connect(out);
      for (const step of [0, 2, 4, 6]) {
        const deg = degree + step;
        const n = song.root + MAJOR[deg % 7] + 12 * Math.floor(deg / 7);
        const o = ctx.createOscillator();
        o.type = song.style === 'house' ? 'sawtooth' : 'triangle';
        o.frequency.value = midi(n);
        o.detune.value = (hash(n + bar) - 0.5) * 12;
        o.connect(lp);
        o.start(t);
        o.stop(t + dur + 0.05);
      }
      const bo = ctx.createOscillator();
      const bg = ctx.createGain();
      bo.frequency.value = midi(song.root - 12 + MAJOR[degree % 7]);
      bg.gain.setValueAtTime(0.18 * fadeIn, t);
      bg.gain.exponentialRampToValueAtTime(0.01, t + dur);
      bo.connect(bg).connect(out);
      bo.start(t);
      bo.stop(t + dur);
    }
    // melody, identical for everyone thanks to the seeded hash
    const density = song.style === 'ambient' ? 0.8 : song.style === 'house' ? 0.7 : 0.62;
    if (s % 2 === 0 && hash(seed * 7 + 3) > density) {
      const n = song.root + 12 + PENTA[Math.floor(hash(seed * 13) * PENTA.length)] + (hash(seed) > 0.75 ? 12 : 0);
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = song.style === 'bossa' ? 'triangle' : 'sine';
      o.frequency.value = midi(n);
      const len = song.style === 'ambient' ? 1.6 : 0.6;
      g.gain.setValueAtTime(0.12 * fadeIn, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + len);
      o.connect(g).connect(out);
      o.start(t);
      o.stop(t + len + 0.05);
    }
  }

  // ---------------- lookahead scheduler ----------------
  private schedule() {
    if (!this.ctx || this.ctx.state !== 'running') return;
    const horizon = serverNow() + 350;
    // chanting (moktak, voices, temple bell) is never heard in the church
    if (this.place !== 'church') {
      if (this.chantAnchor !== null) this.scheduleChant('chant', this.chantAnchor, horizon);
      if (this.serviceAnchor !== null) this.scheduleChant('service', this.serviceAnchor, horizon);
    }
    if (this.musicLevel > 0.01 && this.musicEnabled && this.dj) this.scheduleParty(horizon);
    else this.nextBeat.delete('party');
    if (this.hallLevel > 0.01) this.scheduleHall(horizon);
    else this.nextBeat.delete('hall');
  }

  dispose() {
    clearInterval(this.scheduler);
    clearTimeout(this.ambientTimer);
    void this.ctx?.close();
    this.ctx = null;
  }
}

export const audio = new AudioEngine();
