// Звук без файлов: всё синтезируется WebAudio. Музыка — индастриал-петля 132 удара в минуту.
export class Sound {
  constructor() {
    this.ctx = null;
    this.sfxOn = true; this.musicOn = true; this.voiceOn = true;
    this.last = {};
    this.intensity = 0; // 0 — затишье, 1 — бой
    try {
      const s = JSON.parse(localStorage.getItem('rubezh-sound') || '{}');
      if (s.sfx === false) this.sfxOn = false;
      if (s.music === false) this.musicOn = false;
      if (s.voice === false) this.voiceOn = false;
    } catch {}
  }
  save() { try { localStorage.setItem('rubezh-sound', JSON.stringify({ sfx: this.sfxOn, music: this.musicOn, voice: this.voiceOn })); } catch {} }

  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {}); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    const c = this.ctx;
    this.master = c.createGain(); this.master.gain.value = 0.8;
    const comp = c.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4;
    this.master.connect(comp); comp.connect(c.destination);
    this.sfx = c.createGain(); this.sfx.gain.value = this.sfxOn ? 0.7 : 0; this.sfx.connect(this.master);
    this.music = c.createGain(); this.music.gain.value = this.musicOn ? 0.32 : 0; this.music.connect(this.master);
    const len = c.sampleRate;
    this.noise = c.createBuffer(1, len, c.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.startMusic();
  }
  setSfx(on) { this.sfxOn = on; if (this.sfx) this.sfx.gain.value = on ? 0.7 : 0; this.save(); }
  setMusic(on) { this.musicOn = on; if (this.music) this.music.gain.setTargetAtTime(on ? 0.32 : 0, this.ctx.currentTime, 0.1); this.save(); }
  setVoice(on) { this.voiceOn = on; if (!on) try { speechSynthesis.cancel(); } catch {} this.save(); }

  gate(key, ms) {
    const now = performance.now();
    if (now - (this.last[key] || 0) < ms) return false;
    this.last[key] = now; return true;
  }
  noiseSrc(t, dur, filterType, freq, q, gain, dest) {
    const c = this.ctx;
    const n = c.createBufferSource(); n.buffer = this.noise; n.loop = true;
    const f = c.createBiquadFilter(); f.type = filterType; f.frequency.value = freq; f.Q.value = q;
    const g = c.createGain(); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    n.connect(f); f.connect(g); g.connect(dest || this.sfx);
    n.start(t, Math.random()); n.stop(t + dur + 0.02);
    return { f, g };
  }
  osc(t, type, f0, f1, dur, gain, dest) {
    const c = this.ctx;
    const o = c.createOscillator(); o.type = type; o.frequency.setValueAtTime(f0, t); if (f1) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = c.createGain(); g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(dest || this.sfx); o.start(t); o.stop(t + dur + 0.02);
    return o;
  }

  play(name) {
    if (!this.ctx || !this.sfxOn) return;
    const t = this.ctx.currentTime;
    switch (name) {
      case 'mg': if (!this.gate('mg', 45)) return;
        this.noiseSrc(t, 0.05, 'bandpass', 1800, 0.8, 0.35); this.osc(t, 'square', 180, 60, 0.04, 0.08); break;
      case 'tesla': if (!this.gate('tesla', 70)) return;
        this.noiseSrc(t, 0.35, 'highpass', 2500, 0.5, 0.35);
        this.osc(t, 'sawtooth', 1400, 90, 0.3, 0.12); this.osc(t + 0.03, 'square', 900, 60, 0.22, 0.06); break;
      case 'flak': if (!this.gate('flak', 80)) return;
        this.osc(t, 'sine', 140, 40, 0.18, 0.5); this.noiseSrc(t, 0.12, 'lowpass', 900, 0.7, 0.35);
        this.noiseSrc(t + 0.09, 0.25, 'lowpass', 600, 0.5, 0.25); break;
      case 'boom': if (!this.gate('boom', 60)) return;
        this.osc(t, 'sine', 90, 30, 0.5, 0.6); this.noiseSrc(t, 0.6, 'lowpass', 700, 0.6, 0.6); break;
      case 'bigboom':
        this.osc(t, 'sine', 70, 22, 1.1, 0.9); this.noiseSrc(t, 1.2, 'lowpass', 500, 0.5, 0.9); this.noiseSrc(t + 0.15, 0.9, 'lowpass', 1200, 0.4, 0.4); break;
      case 'pop': if (!this.gate('pop', 40)) return;
        this.osc(t, 'sine', 520, 140, 0.12, 0.18); this.noiseSrc(t, 0.08, 'bandpass', 3000, 2, 0.08); break;
      case 'squish': this.osc(t, 'sawtooth', 160, 40, 0.35, 0.25); this.noiseSrc(t, 0.3, 'lowpass', 400, 1, 0.4); break;
      case 'psiDie': this.osc(t, 'sine', 900, 120, 0.7, 0.2); this.osc(t, 'sine', 905, 118, 0.7, 0.2); break;
      case 'capture': { const o = this.osc(t, 'sine', 300, 600, 1.0, 0.18); const o2 = this.osc(t, 'triangle', 450, 900, 1.0, 0.1);
        const l = this.ctx.createOscillator(); l.frequency.value = 9; const lg = this.ctx.createGain(); lg.gain.value = 30; l.connect(lg); lg.connect(o.frequency); lg.connect(o2.frequency); l.start(t); l.stop(t + 1); break; }
      case 'build': this.osc(t, 'square', 660, 0, 0.08, 0.08); this.osc(t + 0.1, 'square', 990, 0, 0.12, 0.08); break;
      case 'place': this.noiseSrc(t, 0.4, 'lowpass', 300, 1, 0.5); this.osc(t, 'sine', 80, 40, 0.3, 0.4); break;
      case 'click': this.osc(t, 'square', 1200, 600, 0.03, 0.05); break;
      case 'deny': this.osc(t, 'square', 180, 0, 0.12, 0.08); this.osc(t + 0.13, 'square', 140, 0, 0.16, 0.08); break;
      case 'sell': this.osc(t, 'triangle', 800, 1600, 0.12, 0.1); this.osc(t + 0.08, 'triangle', 1200, 2400, 0.12, 0.08); break;
      case 'ping': this.osc(t, 'sine', 1320, 0, 0.12, 0.15); this.osc(t + 0.14, 'sine', 1320, 0, 0.12, 0.15); break;
      case 'alarm': this.osc(t, 'sawtooth', 600, 400, 0.25, 0.08); this.osc(t + 0.3, 'sawtooth', 600, 400, 0.25, 0.08); break;
      case 'wave': this.osc(t, 'sawtooth', 110, 55, 1.2, 0.18); this.noiseSrc(t, 1.0, 'lowpass', 300, 1, 0.3); break;
      case 'cash': this.osc(t, 'triangle', 1500, 0, 0.05, 0.05); break;
    }
  }

  // ---------- музыка ----------
  startMusic() {
    const c = this.ctx;
    const bpm = 132, step = 60 / bpm / 4;
    let next = c.currentTime + 0.1, i = 0;
    const bass = [40, 0, 40, 40, 0, 40, 43, 0, 40, 0, 40, 47, 0, 45, 43, 0];
    const bass2 = [36, 0, 36, 36, 0, 36, 38, 0, 36, 0, 36, 43, 0, 41, 40, 0];
    const lead = [0, 0, 0, 0, 64, 0, 0, 0, 0, 0, 67, 0, 0, 0, 66, 0];
    const midi = n => 440 * Math.pow(2, (n - 69) / 12);
    const tick = () => {
      if (!this.ctx) return;
      while (next < c.currentTime + 0.12) {
        const s = i % 16, bar = Math.floor(i / 16) % 8;
        const fight = this.intensity;
        const g = this.music;
        // бочка
        if (s % 4 === 0 || (fight > 0.5 && s === 10)) { this.osc(next, 'sine', 120, 38, 0.22, 0.9 * (0.5 + fight * 0.5), g); }
        // малый барабан
        if (fight > 0.3 && (s === 4 || s === 12)) { this.noiseSrc(next, 0.16, 'bandpass', 1800, 0.7, 0.55, g); this.osc(next, 'triangle', 220, 120, 0.1, 0.25, g); }
        // хэт
        if (s % 2 === 0) this.noiseSrc(next, s % 4 === 2 ? 0.06 : 0.03, 'highpass', 7000, 0.5, 0.18 + fight * 0.1, g);
        // бас
        const seq = bar >= 4 ? bass2 : bass;
        const n = seq[s];
        if (n) {
          const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = midi(n);
          const f = c.createBiquadFilter(); f.type = 'lowpass'; f.frequency.setValueAtTime(300 + fight * 900, next); f.frequency.exponentialRampToValueAtTime(120, next + step * 1.6); f.Q.value = 6;
          const gg = c.createGain(); gg.gain.setValueAtTime(0.32, next); gg.gain.exponentialRampToValueAtTime(0.001, next + step * 1.8);
          o.connect(f); f.connect(gg); gg.connect(g); o.start(next); o.stop(next + step * 2);
        }
        // тревожная нота в бою
        if (fight > 0.5 && lead[s] && bar % 2 === 1) {
          const o = c.createOscillator(); o.type = 'square'; o.frequency.value = midi(lead[s] + (bar >= 4 ? -4 : 0));
          const gg = c.createGain(); gg.gain.setValueAtTime(0.05, next); gg.gain.exponentialRampToValueAtTime(0.001, next + step * 3);
          o.connect(gg); gg.connect(g); o.start(next); o.stop(next + step * 3);
        }
        next += step; i++;
      }
    };
    clearInterval(this.musicTimer);
    this.musicTimer = setInterval(tick, 25);
  }

  // ---------- голос штаба ----------
  say(text) {
    if (!this.voiceOn || typeof speechSynthesis === 'undefined') return;
    try {
      const voices = speechSynthesis.getVoices();
      const v = voices.find(v => /^ru/i.test(v.lang) && /milena|female|жен/i.test(v.name)) || voices.find(v => /^ru/i.test(v.lang));
      if (!v) return;
      if (speechSynthesis.speaking && !this.gate('voice', 1400)) return;
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.voice = v; u.lang = v.lang; u.rate = 1.08; u.pitch = 0.85; u.volume = 0.9;
      speechSynthesis.speak(u);
    } catch {}
  }
}
