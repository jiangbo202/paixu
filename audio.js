// Original, generated audio: no network requests or third-party audio assets.
export const AUDIO_TRACKS = [
  { id: 'table', name: '夜色牌桌', desc: '温暖电琴 · 慢拍爵士', bpm: 76, roots: [45, 41, 38, 40], major: false, wave: 'sine' },
  { id: 'neon', name: '霓虹节拍', desc: '合成器 · 轻快律动', bpm: 98, roots: [38, 34, 31, 33], major: false, wave: 'triangle' },
  { id: 'mint', name: '薄荷电台', desc: '明亮和弦 · 轻柔放松', bpm: 86, roots: [48, 45, 41, 43], major: true, wave: 'sine' },
];
const AUDIO_DEFAULTS_VERSION = 1;
export function normalizeAudioSettings(saved = {}) {
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)) saved = {};
  const settings = { sound: true, musicEnabled: true, musicTrack: 'table', musicVolume: .42, effectsVolume: .65, ...saved };
  const legacy = saved.audioDefaultsVersion !== AUDIO_DEFAULTS_VERSION;
  // Apply the new enabled defaults once to old installs; future mute choices persist.
  for (const key of ['sound', 'musicEnabled']) settings[key] = legacy || settings[key] !== false;
  settings.musicTrack = AUDIO_TRACKS.some(track => track.id === settings.musicTrack) ? settings.musicTrack : AUDIO_TRACKS[0].id;
  for (const [key, fallback] of [['musicVolume', .42], ['effectsVolume', .65]]) {
    settings[key] = Number.isFinite(settings[key]) ? Math.max(0, Math.min(1, settings[key])) : fallback;
    if (legacy && settings[key] === 0) settings[key] = fallback;
  }
  settings.audioDefaultsVersion = AUDIO_DEFAULTS_VERSION;
  return settings;
}
export const EFFECT_DURATIONS = { click: .05, select: .08, deselect: .07, deal: .62, pack: .7, play: .24, discard: .3, chip: .15, mult: .24, joker: .34, total: .44, buy: .45, sell: .3, upgrade: .6, tarot: .6, shuffle: .42, win: .9, clear: 1.15, lose: .7, error: .25, sort: .18 };

// Pure PCM synthesis also lets tests check silence, clipping and action differentiation.
export function generateEffect(kind, variant = 0, rate = 22050) {
  if (!(kind in EFFECT_DURATIONS)) kind = 'click';
  const dealCount = kind === 'deal' ? Math.min(13, Math.max(1, Math.round(variant || 5))) : 0;
  const duration = kind === 'deal' ? Math.max(EFFECT_DURATIONS.deal, (dealCount - 1) * .074 + .104) : EFFECT_DURATIONS[kind];
  const output = new Float32Array(Math.ceil(duration * rate));
  let seed = [...kind].reduce((n, c) => (Math.imul(n, 31) + c.charCodeAt(0)) >>> 0, 17) ^ (variant * 7919);
  const random = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 2147483648 - 1; };
  const tone = (start, duration, from, to, level, waveform = 'sine') => {
    for (let i = Math.floor(start * rate); i < Math.min(output.length, (start + duration) * rate); i++) {
      const x = i / rate - start, p = x / duration, phase = 2 * Math.PI * (from * x + (to - from) * x * x / (2 * duration));
      const wave = waveform === 'triangle' ? 2 / Math.PI * Math.asin(Math.sin(phase)) : waveform === 'bell' ? Math.sin(phase) + .18 * Math.sin(phase * 2.76) : Math.sin(phase);
      output[i] += wave * level * Math.min(1, p * 45) * Math.exp(-p * 4.5) * (1 - p);
    }
  };
  const noise = (start, duration, level, flutter = 0) => {
    let last = 0, low = 0;
    for (let i = Math.floor(start * rate); i < Math.min(output.length, (start + duration) * rate); i++) {
      const p = (i / rate - start) / duration, n = random(), high = n - last * .88; last = n; low += .2 * (high - low);
      output[i] += low * level * Math.sin(Math.PI * p) ** 2 * (flutter ? .55 + .45 * Math.sin(p * flutter * Math.PI) ** 2 : 1);
    }
  };
  const paperSlide = (start, pressure, duration = .098, withContact = true) => {
    let smooth = 0, soft = 0, bass = 0, body = 0;
    const paperLow = 1 - Math.exp(-2 * Math.PI * 1800 / rate), soften = 1 - Math.exp(-2 * Math.PI * 1600 / rate), paperBass = 1 - Math.exp(-2 * Math.PI * 180 / rate), felt = 1 - Math.exp(-2 * Math.PI * 420 / rate);
    // Two low-pass stages take the sharp edge off the paper. Rounded envelopes
    // and a quiet felt contact avoid clicks, pitched sweeps and scratchy bursts.
    for (let i = Math.ceil(start * rate); i < Math.min(output.length, (start + duration) * rate); i++) {
      const time = i / rate - start, p = time / duration, n = random();
      smooth += paperLow * (n - smooth);
      soft += soften * (smooth - soft);
      bass += paperBass * (soft - bass);
      body += felt * (n - body);
      const envelope = Math.sin(Math.PI * p), friction = (soft - bass) * envelope ** 1.8;
      const hit = time - duration * .57;
      const landing = !withContact || hit < 0 ? 0 : body * Math.min(1, hit / .007) * Math.exp(-hit / .012) * envelope;
      output[i] += (friction * .3 + landing * .085) * pressure;
    }
  };
  switch (kind) {
    case 'click': noise(0, .025, .2); tone(0, .045, 680, 340, .17); break;
    case 'select': tone(0, .075, 420, 620, .27, 'triangle'); noise(0, .025, .16); break;
    case 'deselect': tone(0, .06, 380, 220, .2); break;
    case 'deal': {
      for (let i = 0; i < dealCount; i++) {
        const start = i * .074 + (i ? (random() + 1) * .002 : 0);
        paperSlide(start, .82 + (random() + 1) * .06);
      }
      break;
    }
    case 'pack':
      paperSlide(0, .72, .23, false); paperSlide(.11, .46, .18, false);
      [349, 440, 523].forEach((f, i) => tone(.18 + i * .075, .34, f, f, .13));
      break;
    case 'play': noise(0, .2, 1.1, 4); tone(.035, .14, 155, 68, .35); break;
    case 'discard': noise(0, .26, .85, 13); tone(.01, .18, 290, 90, .13); break;
    case 'chip': tone(0, .14, 950 + variant * 60, 1020 + variant * 60, .4, 'bell'); noise(0, .02, .12); break;
    case 'mult': [440, 660, 880].forEach((f, i) => tone(i * .035, .14, f, f * 1.04, .28, 'triangle')); break;
    case 'joker': [587, 740, 988, 1175].forEach((f, i) => tone(i * .045, .18, f, f, .3, 'bell')); break;
    case 'total': [262, 392, 523].forEach((f, i) => tone(i * .06, .28, f, f, .3, 'bell')); break;
    case 'buy': tone(0, .12, 1100, 1100, .3, 'bell'); tone(.09, .28, 1650, 1650, .35, 'bell'); noise(0, .055, .3); break;
    case 'sell': [1300, 980, 760].forEach((f, i) => tone(i * .055, .16, f, f, .25, 'bell')); break;
    case 'upgrade': [330, 440, 554, 660, 880].forEach((f, i) => tone(i * .065, .3, f, f, .26, 'bell')); break;
    case 'tarot': noise(0, .42, .45, 17); [392, 466, 587, 784, 1175].forEach((f, i) => tone(i * .055, .35, f, f * 1.02, .24, 'bell')); break;
    case 'shuffle': for (let i = 0; i < 7; i++) noise(i * .045, .1, .6, 11); break;
    case 'win': [392, 494, 587, 784, 988].forEach((f, i) => tone(i * .085, .5, f, f, .34, 'bell')); break;
    case 'clear':
      [523, 659, 784, 1047].forEach((f, i) => tone(i * .09, .5, f, f, .28, 'bell'));
      [523, 659, 784, 1047].forEach(f => tone(.42, .65, f, f, .11, 'triangle'));
      noise(.04, .18, .22); break;
    case 'lose': [220, 175, 131].forEach((f, i) => tone(i * .13, .4, f, f * .93, .28, 'triangle')); break;
    case 'error': tone(0, .11, 170, 150, .25, 'triangle'); tone(.12, .11, 150, 130, .2, 'triangle'); break;
    case 'sort': noise(0, .08, .42, 9); noise(.07, .09, .42, 11); tone(0, .12, 260, 390, .11); break;
  }
  let peak = 0; for (const sample of output) peak = Math.max(peak, Math.abs(sample));
  if (peak > .82) for (let i = 0; i < output.length; i++) output[i] *= .82 / peak;
  return output;
}

export class GameAudio {
  constructor() { this.settings = {}; this.buffers = new Map(); this.nodes = new Set(); this.unlocked = false; this.hidden = false; this.trackId = null; this.pendingEffect = null; }
  get enabled() { return this.settings.sound || this.settings.musicEnabled; }
  audioSession(active) {
    // Feature-detected: Safari can route Web Audio as ambient audio by default.
    try { if (globalThis.navigator?.audioSession) navigator.audioSession.type = active ? 'playback' : 'auto'; } catch { /* optional platform API */ }
  }
  syncState() {
    this.unlocked = this.context?.state === 'running';
    if (!this.unlocked || this.hidden) this.stopMusic();
    this.configure(this.settings);
    if (this.unlocked && !this.hidden && this.pendingEffect) {
      const effect = this.pendingEffect; this.pendingEffect = null;
      if (Date.now() < effect.expires) this.play(effect.kind, effect.variant);
    }
    this.onStateChange?.();
  }
  configure(settings) {
    const track = AUDIO_TRACKS.find(t => t.id === settings.musicTrack) || AUDIO_TRACKS[0];
    const changed = this.trackId !== track.id; this.settings = settings; this.trackId = track.id;
    if (!settings.sound || this.hidden) this.pendingEffect = null;
    if (!this.enabled || this.hidden) this.audioSession(false);
    else if (this.context && this.unlocked) this.audioSession(true);
    if (!this.context || this.context.state === 'closed') return;
    this.fxBus.gain.setTargetAtTime(settings.sound && !this.hidden ? Math.max(0, Math.min(1, settings.effectsVolume ?? .65)) * .65 : 0, this.context.currentTime, .025);
    this.musicBus.gain.setTargetAtTime(settings.musicEnabled && !this.hidden ? Math.max(0, Math.min(1, settings.musicVolume ?? .42)) * .65 : 0, this.context.currentTime, .06);
    if (changed || !settings.musicEnabled || this.hidden) this.stopMusic();
    if (settings.musicEnabled && this.unlocked && !this.hidden && !this.musicTimer) this.startMusic();
  }
  async unlock() {
    if (this.hidden || !this.enabled) return false;
    try {
      this.audioSession(true);
      if (!this.context || this.context.state === 'closed') {
        this.stopMusic(); this.buffers.clear();
        const Audio = window.AudioContext || window.webkitAudioContext; if (!Audio) return false;
        this.context = new Audio(); this.context.onstatechange = () => this.syncState();
        this.fxBus = this.context.createGain(); this.musicBus = this.context.createGain();
        this.fxBus.gain.value = 0; this.musicBus.gain.value = 0;
        const compressor = this.context.createDynamicsCompressor(); compressor.threshold.value = -16; compressor.ratio.value = 4;
        this.fxBus.connect(compressor); this.musicBus.connect(compressor); compressor.connect(this.context.destination);
      }
      const context = this.context;
      // Both calls must happen inside the user gesture, before the first await.
      // Retry on touchend/click even if an earlier pointerdown resume is pending.
      const resumed = context.state !== 'running' ? context.resume() : Promise.resolve();
      const primer = context.createBufferSource(); primer.buffer = context.createBuffer(1, 1, context.sampleRate);
      primer.connect(context.destination); primer.onended = () => primer.disconnect(); primer.start(0);
      await resumed;
      if (context !== this.context) return false;
      this.syncState(); return this.unlocked && !this.hidden;
    } catch { this.unlocked = false; this.onStateChange?.(); return false; }
  }
  play(kind, variant = 0) {
    if (!this.settings.sound || this.hidden) return;
    if (!this.context || !this.unlocked || this.context.state !== 'running') {
      // Keep only the most recent tap, never replay a backlog after an interruption.
      this.pendingEffect = { kind, variant, expires: Date.now() + 750 }; return;
    }
    const key = `${kind}:${variant}`;
    if (!this.buffers.has(key)) { const pcm = generateEffect(kind, variant), buffer = this.context.createBuffer(1, pcm.length, 22050); buffer.copyToChannel(pcm, 0); this.buffers.set(key, buffer); }
    const source = this.context.createBufferSource(); source.buffer = this.buffers.get(key); source.connect(this.fxBus); source.start(); source.onended = () => source.disconnect();
  }
  tone(note, at, duration, level, type = 'sine') {
    const context = this.context, gain = context.createGain(), oscillator = context.createOscillator();
    oscillator.type = type; oscillator.frequency.setValueAtTime(440 * 2 ** ((note - 69) / 12), at);
    gain.gain.setValueAtTime(0, at); gain.gain.linearRampToValueAtTime(level, at + .012); gain.gain.exponentialRampToValueAtTime(.0001, at + duration);
    oscillator.connect(gain); gain.connect(this.musicBus); this.nodes.add(oscillator);
    oscillator.start(at); oscillator.stop(at + duration + .02); oscillator.onended = () => { this.nodes.delete(oscillator); oscillator.disconnect(); gain.disconnect(); };
  }
  drum(type, at) {
    if (type === 'kick') { this.tone(31, at, .13, .055); return; }
    const context = this.context, size = Math.ceil(context.sampleRate * .065), buffer = context.createBuffer(1, size, context.sampleRate), data = buffer.getChannelData(0);
    for (let i = 0; i < size; i++) data[i] = (Math.random() * 2 - 1) * Math.exp(-i / size * 7);
    const source = context.createBufferSource(), filter = context.createBiquadFilter(), gain = context.createGain();
    filter.type = 'highpass'; filter.frequency.value = type === 'hat' ? 7000 : 1800; gain.gain.value = type === 'hat' ? .022 : .035;
    source.buffer = buffer; source.connect(filter); filter.connect(gain); gain.connect(this.musicBus); this.nodes.add(source); source.start(at);
    source.onended = () => { this.nodes.delete(source); source.disconnect(); filter.disconnect(); gain.disconnect(); };
  }
  startMusic() {
    if (!this.context || this.context.state !== 'running' || this.hidden || !this.settings.musicEnabled || this.musicTimer) return;
    const track = AUDIO_TRACKS.find(t => t.id === this.trackId) || AUDIO_TRACKS[0], stepLength = 60 / track.bpm / 4;
    let step = 0, next = this.context.currentTime + .08;
    const schedule = () => {
      if (this.context.state !== 'running') return;
      if (next < this.context.currentTime - .2) next = this.context.currentTime + .03;
      while (next < this.context.currentTime + .25) {
        const bar = Math.floor(step / 16) % 8, position = step % 16, root = track.roots[bar % 4], third = track.major && bar % 4 !== 1 ? 4 : 3;
        const swing = position % 2 ? stepLength * .12 : 0, at = next + swing;
        if ([0, 6, 8, 14].includes(position)) this.tone(root - 12 + (position === 6 ? 7 : position === 14 ? 10 : 0), at, .32, .065, 'triangle');
        if ([2, 10].includes(position)) for (const offset of [third + 12, 19, 22, 26]) this.tone(root + offset, at, .85, .022, track.wave);
        if ([0, 5, 8, 11, 14].includes(position)) {
          const offsets = [24, 31, 27, 34, 29, 31, 36, 26], offset = offsets[(bar * 3 + Math.floor(position / 2)) % offsets.length];
          this.tone(root + offset, at, .42, .027, track.wave);
        }
        if (position === 0 || position === 8) this.drum('kick', at);
        if (position === 4 || position === 12) this.drum('brush', at);
        if (position % 4 === 2) this.drum('hat', at);
        next += stepLength; step = (step + 1) % 128;
      }
    };
    schedule(); this.musicTimer = setInterval(schedule, 100);
  }
  stopMusic() {
    clearInterval(this.musicTimer); this.musicTimer = null;
    for (const node of this.nodes) { try { node.stop(); } catch { /* already ended */ } } this.nodes.clear();
  }
  async visibility(hidden) {
    this.hidden = hidden; this.pendingEffect = null;
    if (hidden) { this.stopMusic(); this.configure(this.settings); if (this.context?.state === 'running') await this.context.suspend().catch(() => {}); }
    else if (this.context) await this.unlock();
    this.onStateChange?.();
  }
}
