/** Все звуки синтезируются через Web Audio API — никаких внешних файлов. */
export class GameAudio {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private crowdGain: GainNode | null = null;
  private crowdFilter: BiquadFilterNode | null = null;
  private rumbleGain: GainNode | null = null;
  private rainGain: GainNode | null = null;
  private sources: AudioScheduledSourceNode[] = [];
  private excitement = 0;
  private swell = 0;
  private swellT = 0;
  private noise: AudioBuffer | null = null;
  private brown: AudioBuffer | null = null;
  volume = 0.8;

  ensure() {
    if (!this.ctx) {
      const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.volume;
      const comp = this.ctx.createDynamicsCompressor();
      this.master.connect(comp);
      comp.connect(this.ctx.destination);
      this.noise = this.makeNoise('pink', 4);
      this.brown = this.makeNoise('brown', 4);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  private makeNoise(kind: 'pink' | 'brown' | 'white', seconds: number) {
    const ctx = this.ctx!;
    const len = ctx.sampleRate * seconds;
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0, last = 0;
      for (let i = 0; i < len; i++) {
        const w = Math.random() * 2 - 1;
        if (kind === 'white') d[i] = w;
        else if (kind === 'brown') { last = (last + 0.02 * w) / 1.02; d[i] = last * 3.5; }
        else {
          b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
          b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
          d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
          b6 = w * 0.115926;
        }
      }
    }
    return buf;
  }

  private loop(buf: AudioBuffer) {
    const s = this.ctx!.createBufferSource();
    s.buffer = buf;
    s.loop = true;
    s.loopStart = Math.random();
    s.start(0, Math.random() * 2);
    this.sources.push(s);
    return s;
  }

  startAmbience(rain: boolean) {
    this.ensure();
    if (!this.ctx || this.crowdGain) return;
    const ctx = this.ctx;
    // гул голосов
    const voices = this.loop(this.noise!);
    this.crowdFilter = ctx.createBiquadFilter();
    this.crowdFilter.type = 'bandpass';
    this.crowdFilter.frequency.value = 700;
    this.crowdFilter.Q.value = 0.6;
    this.crowdGain = ctx.createGain();
    this.crowdGain.gain.value = 0;
    voices.connect(this.crowdFilter).connect(this.crowdGain).connect(this.master);
    // низкий рокот
    const rumble = this.loop(this.brown!);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 260;
    this.rumbleGain = ctx.createGain();
    this.rumbleGain.gain.value = 0;
    rumble.connect(lp).connect(this.rumbleGain).connect(this.master);
    this.crowdGain.gain.setTargetAtTime(0.22, ctx.currentTime, 1.5);
    this.rumbleGain.gain.setTargetAtTime(0.25, ctx.currentTime, 1.5);
    if (rain) {
      const r = this.loop(this.noise!);
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 2500;
      this.rainGain = ctx.createGain();
      this.rainGain.gain.value = 0.12;
      r.connect(hp).connect(this.rainGain).connect(this.master);
    }
  }

  stopAmbience() {
    for (const s of this.sources) { try { s.stop(); } catch { /* уже остановлен */ } }
    this.sources = [];
    this.crowdGain = null;
    this.rumbleGain = null;
    this.rainGain = null;
  }

  excite(v: number) { this.excitement = Math.min(1.5, Math.max(this.excitement, v)); }

  update(dt: number) {
    if (!this.ctx || !this.crowdGain || !this.crowdFilter || !this.rumbleGain) return;
    this.excitement = Math.max(0, this.excitement - dt * 0.25);
    this.swellT -= dt;
    if (this.swellT <= 0) { this.swellT = 2 + Math.random() * 4; this.swell = Math.random() * 0.12; }
    const e = this.excitement;
    const t = this.ctx.currentTime;
    this.crowdGain.gain.setTargetAtTime(0.18 + this.swell + e * 0.55, t, 0.25);
    this.rumbleGain.gain.setTargetAtTime(0.22 + e * 0.35, t, 0.3);
    this.crowdFilter.frequency.setTargetAtTime(650 + e * 900 + this.swell * 800, t, 0.3);
  }

  whistle(kind: 'short' | 'long' | 'end') {
    this.ensure();
    if (!this.ctx) return;
    const ctx = this.ctx;
    const blasts = kind === 'end' ? [[0, 0.45], [0.6, 0.45], [1.2, 1.1]] : kind === 'long' ? [[0, 0.9]] : [[0, 0.28]];
    for (const [start, dur] of blasts) {
      const t0 = ctx.currentTime + start;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t0);
      g.gain.linearRampToValueAtTime(0.18, t0 + 0.02);
      g.gain.setValueAtTime(0.18, t0 + dur - 0.05);
      g.gain.linearRampToValueAtTime(0, t0 + dur);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 2900;
      bp.Q.value = 4;
      const trem = ctx.createGain();
      trem.gain.value = 0.6;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 28;
      const lfoGain = ctx.createGain();
      lfoGain.gain.value = 0.4;
      lfo.connect(lfoGain).connect(trem.gain);
      for (const f of [2850, 2920]) {
        const o = ctx.createOscillator();
        o.type = 'triangle';
        o.frequency.value = f;
        o.connect(trem);
        o.start(t0); o.stop(t0 + dur + 0.05);
      }
      trem.connect(bp).connect(g).connect(this.master);
      lfo.start(t0); lfo.stop(t0 + dur + 0.05);
    }
  }

  kick(power: number) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(170, t0);
    o.frequency.exponentialRampToValueAtTime(55, t0 + 0.09);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.25 + power * 0.5, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.12);
    o.connect(g).connect(this.master);
    o.start(t0); o.stop(t0 + 0.13);
    const n = ctx.createBufferSource();
    n.buffer = this.noise!;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1400;
    bp.Q.value = 1.2;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.25 + power * 0.4, t0);
    ng.gain.exponentialRampToValueAtTime(0.001, t0 + 0.05);
    n.connect(bp).connect(ng).connect(this.master);
    n.start(t0, Math.random() * 3); n.stop(t0 + 0.06);
  }

  post() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime;
    for (const f of [520, 1330, 2210]) {
      const o = ctx.createOscillator();
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.12, t0);
      g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.7);
      o.connect(g).connect(this.master);
      o.start(t0); o.stop(t0 + 0.72);
    }
  }

  goal() {
    this.excite(1.5);
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime;
    const n = ctx.createBufferSource();
    n.buffer = this.noise!;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(500, t0);
    bp.frequency.linearRampToValueAtTime(1500, t0 + 0.8);
    bp.frequency.linearRampToValueAtTime(900, t0 + 5);
    bp.Q.value = 0.5;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(0.9, t0 + 0.5);
    g.gain.linearRampToValueAtTime(0.5, t0 + 3);
    g.gain.linearRampToValueAtTime(0, t0 + 6);
    n.connect(bp).connect(g).connect(this.master);
    n.start(t0); n.stop(t0 + 6.1);
  }

  setVolume(v: number) {
    this.volume = v;
    if (this.ctx) this.master.gain.value = v;
  }
}
