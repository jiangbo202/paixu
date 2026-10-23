import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../engine.js';
import { MODES, modeRulesFor, validateMode } from '../modes.js';
import { DEFAULT_RULES } from '../rules.js';
import { roundGuidance } from '../presentation.js';
import { setLanguage, t } from '../i18n.js';

const legacySixSeat = seed => { const s=E.newRun(seed,undefined,'medium','six-seat'); delete s.modeRules.jokerSet; delete s.modeRules.jokersOnly; delete s.modeRules.difficultyGrowth; s.modeRules.faceChance=.6; s.jokers=[{id:'scary'}]; return s; };

test('classic remains default and old saves keep the same deck, targets, shops and win condition', () => {
  const fresh = E.newRun('LEGACY'), old = structuredClone(fresh);
  delete old.mode; delete old.modeRules;
  assert.equal(fresh.mode, 'classic'); assert.equal(modeRulesFor(old).antes, 8);
  E.startBlind(old); E.startBlind(fresh); assert.deepEqual(old.hand, fresh.hand);
  E.createShop(old); E.createShop(fresh); assert.deepEqual(old.shop, fresh.shop);
  for (let ante = 1; ante <= 9; ante++) for (let blindIndex = 0; blindIndex < 3; blindIndex++) assert.equal(E.targetFor({ ...old, ante, blindIndex }), E.targetFor({ ...fresh, ante, blindIndex }));
  assert.equal(E.jokerPool(old).length, 26); assert.ok(!E.jokerPool(old).some(j => j.modes));
});
test('modes snapshot independent target curves, starter builds and their actual ending', () => {
  for (const mode of MODES) for (const difficulty of ['easy', 'medium', 'hard', 'nightmare']) {
    const state = E.newRun('MODE', DEFAULT_RULES, difficulty, mode.id);
    assert.ok(state.modeRules.targets.every((n, i, a) => n > (a[i - 1] || 0)));
    assert.equal(state.modeRules.targets.length, mode.antes);
    const snapshot = JSON.stringify(state.modeRules); mode.targets[0]++; assert.equal(JSON.stringify(state.modeRules), snapshot); mode.targets[0]--;
    state.phase = 'roundWon'; state.ante = mode.antes; state.blindIndex = 2;
    E.cashOut(state); assert.equal(state.phase, 'victory');
    E.nextBlind(state); assert.equal(state.ante, mode.antes + 1); assert.ok(E.targetFor(state) > 0);
    if (mode.id === 'six-seat') assert.equal(E.jokerSlots(state),6);
  }
  const fast = E.newRun('FAST', undefined, 'medium', 'quick');
  assert.equal(fast.money, 8); assert.equal(E.itemInfo({ type: 'joker', id: 'greedy' }, fast).price, 4);
  assert.equal(fast.jokers.filter(j => j.id === 'joker').length, 1);
  assert.equal(E.newRun('EASY', undefined, 'easy', 'quick').jokers.filter(j => j.id === 'joker').length, 1);
  for (const invalid of ['bad', '', null, {}, 1]) assert.throws(() => validateMode(invalid));
});
test('face combos repeat chips, enhancements and per-card jokers, without changing hand classification', () => {
  const state = legacySixSeat('FACES');
  state.jokers = ['scary', 'smiley', 'pareidolia', 'buskin'].map(id => ({ id }));
  const numbered = { ...state.deck.find(c => c.id === 'S2'), enhancement: 'mult' };
  const result = E.scoreHand(state, [numbered]);
  // High card: 5 chips/1 mult; each of two triggers adds 2+30 chips and 4+5 mult.
  assert.equal(result.id, 'high'); assert.equal(result.chips, 69); assert.equal(result.mult, 19); assert.equal(result.total, 1311);
  assert.equal(result.events.filter(e => e.kind === 'card').length, 4);
  assert.ok(result.events.some(e => e.retrigger));
  state.jokers = [{ id: 'scary' }, { id: 'smiley' }, { id: 'buskin' }];
  const plain = E.scoreHand(state, [numbered]); assert.equal(plain.chips, 7); assert.equal(plain.mult, 5);
  const king = E.scoreHand(state, [state.deck.find(c => c.id === 'S13')]); assert.equal(king.chips, 85); assert.equal(king.mult, 11);
  state.jokers = [{ id: 'photograph' }, { id: 'buskin' }];
  assert.equal(E.scoreHand(state, [state.deck.find(c => c.id === 'S13')]).mult, 4);
});
test('Pareidolia interacts with the Plant debuff and never retriggers non-scoring cards', () => {
  const state = legacySixSeat('PLANT');
  state.jokers = ['scary', 'smiley', 'pareidolia', 'buskin'].map(id => ({ id }));
  const cards = ['S2', 'H2', 'S13'].map(id => state.deck.find(c => c.id === id));
  const pair = E.scoreHand(state, cards); assert.equal(pair.scoringIds.length, 2);
  assert.equal(pair.events.filter(e => e.kind === 'card').length, 4);
  state.ante = 4; state.blindIndex = 2; state.phase = 'playing';
  const blocked = E.scoreHand(state, cards); assert.equal(blocked.chips, 10); assert.equal(blocked.mult, 2);
  assert.match(roundGuidance(state).title, /全牌失效/);
  state.jokers = state.jokers.filter(j => j.id !== 'pareidolia');
  assert.ok(E.scoreHand(state, cards).chips > 10);
});
test('Six-seat shops favor face combos while respecting configured rarity weights', () => {
  const state = legacySixSeat('POOL'); state.jokers = [];
  let faces = 0;
  for (let i = 0; i < 1000; i++) { const item = E.shopItem('joker', state); faces += Number(E.JOKERS.find(j => j.id === item.id)?.face || false); }
  assert.ok(faces > 550 && faces < 850, faces);
  const rare = legacySixSeat('RARE'); Object.assign(rare.rules,{commonWeight:0,uncommonWeight:0,rareWeight:100});
  for (let i = 0; i < 20; i++) assert.equal(E.shopItem('joker', rare).id, 'banana');
});
test('modes, face rules and coin text translate, including currency in legacy saved descriptions', () => {
  setLanguage('en');
  for (const mode of MODES) for (const field of ['name', 'description']) assert.doesNotMatch(t(mode[field]), /[\u3400-\u9fff]/);
  assert.equal(t('现在使用可以获得 🪙12。'), 'Using this now gains 🪙12.');
  assert.doesNotMatch(t('每 $5 获得 $1，最多 $5'), /\$/);
  setLanguage('zh'); assert.equal(t('出售 $3'), '出售 🪙3');
});
