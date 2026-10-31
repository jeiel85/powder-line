import { storage } from './util.js';

const MUTE_KEY = 'powderline.muted';

/** WebAudio로 합성하는 바람·카빙 소리와 효과음. 외부 오디오 파일을 쓰지 않는다. */
export class SnowAudio {
  constructor() {
    this.ctx = null;
    this.muted = storage.get(MUTE_KEY) === true;
  }

  /** 브라우저 자동재생 정책 때문에 첫 사용자 입력에서 호출해야 한다. */
  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return; // 오디오 미지원 브라우저: 무음으로 동작
    const ctx = (this.ctx = new AC());
    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.8;
    this.master.connect(ctx.destination);

    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.04 * white) / 1.04; // 브라운 노이즈 쪽으로 기울인다
      data[i] = last * 3 + white * 0.15;
    }
    this.noiseBuf = buf;

    const mkLoop = (filterType, freq, q) => {
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      const f = ctx.createBiquadFilter();
      f.type = filterType;
      f.frequency.value = freq;
      f.Q.value = q;
      const g = ctx.createGain();
      g.gain.value = 0;
      src.connect(f).connect(g).connect(this.master);
      src.start();
      return { f, g };
    };
    this.wind = mkLoop('lowpass', 500, 0.7);
    this.carve = mkLoop('bandpass', 1600, 0.9);
  }

  setMuted(m) {
    this.muted = m;
    storage.set(MUTE_KEY, m);
    if (this.ctx) this.master.gain.setTargetAtTime(m ? 0 : 0.8, this.ctx.currentTime, 0.05);
  }

  /** 매 프레임: 속도(m/s), 스키드 강도(0~1), 지면 여부 */
  update(speed, skid, grounded) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const sp = Math.min(1, speed / 28);
    this.wind.g.gain.setTargetAtTime(0.05 + sp * sp * 0.5, t, 0.15);
    this.wind.f.frequency.setTargetAtTime(300 + sp * 900, t, 0.2);
    const c = grounded ? Math.min(1, 0.12 * sp + skid * 0.9) : 0;
    this.carve.g.gain.setTargetAtTime(c * 0.45, t, 0.06);
    this.carve.f.frequency.setTargetAtTime(1100 + skid * 1400, t, 0.1);
  }

  silence() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.wind.g.gain.setTargetAtTime(0, t, 0.1);
    this.carve.g.gain.setTargetAtTime(0, t, 0.1);
  }

  tone(freq, dur, type = 'sine', vol = 0.3, slide = 0, when = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + when;
    const o = this.ctx.createOscillator();
    const g = this.ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq + slide), t + dur);
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  burst(dur, freq, vol) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random());
    src.stop(t + dur + 0.05);
  }

  pop() { this.tone(180, 0.12, 'triangle', 0.25, 120); }
  land(strength) { this.burst(0.25, 500 + strength * 400, 0.3 + strength * 0.4); }
  crash() { this.burst(0.7, 900, 0.8); this.tone(140, 0.4, 'sawtooth', 0.12, -80); }
  gate() { this.tone(880, 0.12, 'sine', 0.18); this.tone(1320, 0.18, 'sine', 0.15, 0, 0.08); }
  miss() { this.tone(220, 0.25, 'square', 0.08, -60); }
  trick(level) {
    const base = 660;
    for (let i = 0; i < Math.min(4, 1 + level); i++) this.tone(base * Math.pow(1.26, i), 0.16, 'triangle', 0.16, 0, i * 0.07);
  }
  beep(high) { this.tone(high ? 1046 : 523, high ? 0.45 : 0.18, 'square', 0.12); }
}
