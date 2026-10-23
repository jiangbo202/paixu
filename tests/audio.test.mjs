import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {AUDIO_TRACKS, EFFECT_DURATIONS, generateEffect, normalizeAudioSettings, GameAudio} from '../audio.js';
import * as E from '../engine.js';

test('every action has a distinct, finite, audible PCM sound without clipping', () => {
  const hashes = new Set();
  for (const [kind, duration] of Object.entries(EFFECT_DURATIONS)) {
    const pcm = generateEffect(kind);
    assert.equal(pcm.length, Math.ceil(duration * 22050));
    let power = 0, peak = 0;
    for (const sample of pcm) { assert.ok(Number.isFinite(sample), kind); power += sample * sample; peak = Math.max(peak, Math.abs(sample)); }
    assert.ok(power / pcm.length > .00001, `${kind}: inaudible`); assert.ok(peak <= .821, `${kind}: clipped`);
    hashes.add(createHash('sha256').update(Buffer.from(pcm.buffer)).digest('hex'));
  }
  assert.equal(hashes.size, Object.keys(EFFECT_DURATIONS).length);
  assert.notDeepEqual(generateEffect('chip', 1), generateEffect('chip', 4));
  assert.equal(AUDIO_TRACKS.length, 3); assert.equal(new Set(AUDIO_TRACKS.map(t => t.id)).size, 3);
});

test('tarot history persists, rejects invalid uses without spending, and records actual money and cards', () => {
  const state = E.newRun('HISTORY'); state.consumables = ['empress', 'hermit'];
  assert.ok(E.useTarot(state, 0)); assert.equal(state.appliedEffects, undefined); assert.equal(state.consumables.length, 2);
  state.money = 30; assert.equal(E.useTarot(state, 1), null); assert.equal(state.money, 50);
  assert.deepEqual(state.appliedEffects.hermit, {count: 1, money: 20, cardIds: []});
  E.startBlind(state); state.selected = [state.hand[0]]; const id = state.selected[0];
  assert.equal(E.useTarot(state, 0), null); assert.equal(state.deck.find(c => c.id === id).enhancement, 'mult');
  state.consumables = ['hierophant']; assert.equal(E.useTarot(state, 0), null);
  assert.equal(state.deck.find(c => c.id === id).enhancement, 'bonus');
  assert.deepEqual(state.appliedEffects.empress.cardIds, [id]); assert.deepEqual(state.appliedEffects.hierophant.cardIds, [id]);
  assert.equal(JSON.parse(JSON.stringify(state)).appliedEffects.empress.count, 1);
  const history = JSON.stringify(state.appliedEffects); assert.ok(E.useTarot(state, 0)); assert.equal(JSON.stringify(state.appliedEffects), history);
});


test('audio defaults enable fresh and legacy muted installs once, then honor saved preferences', () => {
  for (const saved of [undefined, null, [], {sound:false, musicEnabled:false, effectsVolume:0, musicVolume:0}]) {
    const settings = normalizeAudioSettings(saved);
    assert.equal(settings.sound, true); assert.equal(settings.musicEnabled, true);
    assert.ok(settings.effectsVolume > 0); assert.ok(settings.musicVolume > 0);
  }
  const upgraded = normalizeAudioSettings({sound:false, musicEnabled:false, best:4321, musicTrack:'mint', effectsVolume:.2});
  assert.equal(upgraded.best, 4321); assert.equal(upgraded.musicTrack, 'mint'); assert.equal(upgraded.effectsVolume, .2);
  const muted = normalizeAudioSettings({...upgraded, sound:false, musicEnabled:false, musicVolume:0, effectsVolume:0});
  assert.equal(muted.sound, false); assert.equal(muted.musicEnabled, false); assert.equal(muted.musicVolume, 0); assert.equal(muted.effectsVolume, 0);
  assert.deepEqual(normalizeAudioSettings(JSON.parse(JSON.stringify(muted))), muted);
  const invalid = normalizeAudioSettings({...upgraded, musicTrack:'invalid', musicVolume:NaN, effectsVolume:2});
  assert.equal(invalid.musicTrack, 'table'); assert.equal(invalid.musicVolume, .42); assert.equal(invalid.effectsVolume, 1);
});

test('paper deal plays one brief soft slide per drawn card, including expanded hands', () => {
  for (const rate of [22050, 44100]) for (const count of [1, 2, 5, 8, 13]) {
    const pcm = generateEffect('deal', count, rate);
    for (let i = 0; i < count; i++) {
      const card = pcm.subarray(Math.ceil((i * .074 + .01) * rate), Math.floor((i * .074 + .06) * rate));
      assert.ok(card.reduce((sum, n) => sum + n * n, 0) / card.length > .0001);
    }
    assert.ok(pcm.subarray(Math.ceil(((count - 1) * .074 + .104) * rate)).every(n => n === 0), 'extra cards must not sound after the refill finishes');
    assert.ok(pcm.every(n => Number.isFinite(n) && Math.abs(n) < .35), 'gentle, unclipped paper contact');
    assert.ok(Math.abs(pcm.reduce((sum, n) => sum + n, 0) / pcm.length) < .001, 'no DC click');
  }
});

function audioPlatform(t) {
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const contexts = [], session = { type: 'auto' };
  const parameter = () => ({ value: 0, setTargetAtTime(value) { this.value = value; } });
  class Context {
    constructor() { this.state = 'suspended'; this.sampleRate = 48000; this.currentTime = 0; this.destination = {}; this.starts = []; this.resumes = 0; contexts.push(this); }
    createGain() { return { gain: parameter(), connect() {}, disconnect() {} }; }
    createDynamicsCompressor() { return { threshold: parameter(), ratio: parameter(), connect() {} }; }
    createBuffer(channels, length, sampleRate) { return { length, sampleRate, copyToChannel() {} }; }
    createBufferSource() {
      const context = this;
      return { buffer: null, connect() {}, disconnect() {}, start() { context.starts.push(this.buffer.length); } };
    }
    async resume() { this.resumes++; this.state = 'running'; this.onstatechange?.(); }
    async suspend() { this.state = 'suspended'; this.onstatechange?.(); }
  }
  Object.defineProperty(globalThis, 'window', { value: { AudioContext: Context }, configurable: true });
  Object.defineProperty(globalThis, 'navigator', { value: { audioSession: session }, configurable: true });
  t.after(() => {
    for (const [name, descriptor] of [['window', originalWindow], ['navigator', originalNavigator]]) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor); else delete globalThis[name];
    }
  });
  const audio = new GameAudio(); let musicStarts = 0;
  // Observe scheduler starts without creating actual timers or oscillator voices.
  audio.startMusic = function () { musicStarts++; this.musicTimer = -1; };
  audio.configure(normalizeAudioSettings());
  t.after(() => audio.stopMusic());
  return { audio, contexts, session, musicStarts: () => musicStarts };
}

test('a completed tap retries a blocked resume and preserves only the latest first-tap sound', async t => {
  const { audio, contexts, session, musicStarts } = audioPlatform(t);
  let releasePointer;
  const originalResume = window.AudioContext.prototype.resume;
  window.AudioContext.prototype.resume = function () {
    if (!releasePointer) { this.resumes++; return new Promise(resolve => { releasePointer = resolve; }); }
    return originalResume.call(this);
  };
  const pointerAttempt = audio.unlock();
  assert.equal(contexts[0].state, 'suspended');
  audio.play('click'); audio.play('select');
  assert.equal(audio.pendingEffect.kind, 'select');
  assert.equal(await audio.unlock(), true, 'touchend must retry even with pointerdown still pending');
  releasePointer(); await pointerAttempt;
  assert.equal(contexts[0].resumes, 2);
  assert.equal(contexts[0].starts.filter(length => length > 1).length, 1, 'the first tap is audible exactly once');
  assert.equal(contexts[0].starts.filter(length => length === 1).length, 2, 'prime audio synchronously in both gestures');
  assert.equal(musicStarts(), 1); assert.equal(session.type, 'playback');
});

test('interrupted mobile audio restarts its scheduler and drops expired effects', async t => {
  const { audio, contexts, musicStarts } = audioPlatform(t);
  let changes = 0; audio.onStateChange = () => changes++;
  await audio.unlock(); const context = contexts[0];
  context.state = 'interrupted'; context.onstatechange();
  assert.equal(audio.unlocked, false); assert.equal(audio.musicTimer, null);
  audio.play('deal', 5); audio.pendingEffect.expires = Date.now() - 1;
  assert.equal(await audio.unlock(), true);
  assert.equal(context.resumes, 2); assert.equal(musicStarts(), 2);
  assert.equal(context.starts.filter(length => length > 1).length, 0, 'no old effects after resuming');
  assert.ok(changes >= 3); assert.equal(audio.pendingEffect, null);
});

test('background and return restore audio even after an interruption, while honoring mute', async t => {
  const { audio, contexts, session, musicStarts } = audioPlatform(t);
  await audio.unlock();
  await audio.visibility(true);
  assert.equal(contexts[0].state, 'suspended'); assert.equal(session.type, 'auto');
  audio.play('chip'); assert.equal(audio.pendingEffect, null);
  assert.equal(audio.fxBus.gain.value, 0); assert.equal(audio.musicBus.gain.value, 0);
  await audio.visibility(false);
  assert.equal(contexts[0].state, 'running'); assert.equal(musicStarts(), 2);
  audio.configure({ ...audio.settings, sound: false, musicEnabled: false });
  assert.equal(session.type, 'auto'); assert.equal(audio.musicTimer, null);
  await audio.visibility(true); await audio.visibility(false);
  assert.equal(contexts[0].state, 'suspended'); assert.equal(musicStarts(), 2);
});

test('closed contexts can be recreated and an unavailable audio-session API is harmless', async t => {
  const { audio, contexts } = audioPlatform(t);
  Object.defineProperty(navigator, 'audioSession', { get() { throw new Error('unsupported'); }, configurable: true });
  assert.equal(await audio.unlock(), true);
  contexts[0].state = 'closed'; contexts[0].onstatechange();
  assert.equal(await audio.unlock(), true);
  assert.equal(contexts.length, 2); assert.equal(audio.context, contexts[1]);
});
