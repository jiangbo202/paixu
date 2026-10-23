import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../engine.js';
import { DIFFICULTIES, DEFAULT_RULES, difficultyFor, difficultySetup, validateDifficulty, validateRules } from '../rules.js';
import { t, setLanguage } from '../i18n.js';

test('medium preserves old games; saved snapshots do not reapply difficulty adjustments', () => {
  const fresh = E.newRun('LEGACY'), legacy = structuredClone(fresh); delete legacy.difficulty; delete legacy.difficultyRules;
  assert.deepEqual(fresh.rules, DEFAULT_RULES); assert.equal(difficultyFor(legacy).id, 'medium');
  for (let ante = 1; ante <= 10; ante++) for (let blindIndex = 0; blindIndex < 3; blindIndex++) assert.equal(E.targetFor({ ...legacy, ante, blindIndex }), E.targetFor({ ...fresh, ante, blindIndex }));
  const easy = E.newRun('SNAPSHOT', undefined, 'easy'), saved = JSON.parse(JSON.stringify(easy));
  assert.deepEqual(saved, easy); assert.equal(saved.hands, 5); E.startBlind(saved); assert.equal(saved.hands, 5); assert.equal(saved.discards, 5);
});
test('all difficulties have distinct rising target curves, resources and actual joker probabilities', () => {
  const runs = DIFFICULTIES.map(d => E.newRun('BALANCE', undefined, d.id));
  assert.deepEqual(runs.map(s => E.targetFor(s)), [210, 300, 345, 405]);
  assert.deepEqual(runs.map(s => [s.money, s.hands, s.discards]), [[8,5,5],[4,4,4],[4,4,3],[3,3,2]]);
  assert.deepEqual(runs[0].jokers, [{ id: 'joker' }]); assert.ok(runs.slice(1).every(s => !s.jokers.length));
  for (let ante = 1; ante <= 8; ante++) for (let blindIndex = 0; blindIndex < 3; blindIndex++) {
    const targets = runs.map(s => E.targetFor({ ...s, ante, blindIndex }));
    assert.ok(targets.every((n, i) => Number.isInteger(n) && n > 0 && (!i || n > targets[i-1])));
  }
  const rareCounts = runs.map(s => { let n = 0; for (let i = 0; i < 5000; i++) if (E.shopItem('joker', s).id === 'banana') n++; return n; });
  assert.ok(rareCounts.every((n, i) => n > 0 && (!i || n < rareCounts[i-1])), String(rareCounts));
  const a = E.newRun('REPEAT', undefined, 'hard'), b = E.newRun('REPEAT', undefined, 'hard'); E.startBlind(a); E.startBlind(b); E.createShop(a); E.createShop(b); assert.deepEqual(a, b);
});
test('difficulty composes with admin rules while respecting bounds and disabled rarity weights', () => {
  for (const preset of DIFFICULTIES) for (const money of [0, 100]) {
    const setup = difficultySetup({ startingMoney: money, hands: 1, discards: 0, targetScale: 10, commonWeight: 0, uncommonWeight: 0, rareWeight: 100 }, preset.id);
    assert.deepEqual(validateRules(setup.rules), setup.rules); assert.equal(setup.rules.commonWeight, 0); assert.equal(setup.rules.uncommonWeight, 0); assert.ok(setup.rules.rareWeight > 0);
  }
  for (const value of [null, '', 'expert', {}, 0, '__proto__']) assert.throws(() => validateDifficulty(value));
  assert.throws(() => E.newRun('INVALID', undefined, 'unknown'));
  setLanguage('en'); for (const d of DIFFICULTIES) { assert.doesNotMatch(t(d.name), /[\u3400-\u9fff]/); assert.doesNotMatch(t(d.description), /[\u3400-\u9fff]/); } setLanguage('zh');
});
