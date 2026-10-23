import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../engine.js';

const cards = text => text.split(' ').map((part, i) => ({ id: `test${i}`, rank: Number(part.slice(0, -1)), suit: part.slice(-1) }));
const playing = (seed = 'TEST') => { const s = E.newRun(seed); E.startBlind(s); return s; };
const loadHand = (s, text) => { const hand = cards(text); s.deck = [...hand, ...s.deck.filter(c => !hand.some(h => h.suit === c.suit && h.rank === c.rank))]; s.hand = hand.map(c => c.id); s.selected = [...s.hand]; s.drawPile = s.deck.filter(c => !s.hand.includes(c.id)).map(c => c.id); return hand; };

test('all nine hands, precedence, and only participating cards score', () => {
  for (const [text, id, count] of [
    ['14S 10H 8C 6D 3S', 'high', 1], ['13S 13H 9C 6D 2S', 'pair', 2],
    ['12S 12H 8C 8D 2S', 'twoPair', 4], ['7S 7H 7C 6D 2S', 'three', 3],
    ['9S 8H 7C 6D 5S', 'straight', 5], ['14H 10H 8H 6H 3H', 'flush', 5],
    ['11S 11H 11C 4D 4S', 'fullHouse', 5], ['6S 6H 6C 6D 2S', 'four', 4],
    ['9S 8S 7S 6S 5S', 'straightFlush', 5],
  ]) { const result = E.evaluate(cards(text)); assert.equal(result.id, id, text); assert.equal(result.scoring.length, count); }
});
test('ace can be low or high, cannot wrap, and a flush needs five cards', () => {
  assert.equal(E.evaluate(cards('14S 2H 3C 4D 5S')).id, 'straight');
  assert.equal(E.evaluate(cards('14S 13H 12C 11D 10S')).id, 'straight');
  assert.equal(E.evaluate(cards('12S 13H 14C 2D 3S')).id, 'high');
  assert.equal(E.evaluate(cards('2S 3S 4S 5S')).id, 'high');
  assert.equal(E.evaluate(cards('14S 13S 12S 11S 10S')).name, '皇家同花顺');
});
test('a pair ignores kickers and face-card values cap at ten', () => {
  const s = playing(); const hand = loadHand(s, '13S 13H 9C 6D 2S');
  assert.equal(E.scoreHand(s, hand).total, 60);
  assert.equal(E.cardChips({ rank: 14 }), 11);
  assert.equal(E.cardChips({ rank: 12 }), 10);
});
test('planet levels increase base chips and mult cumulatively', () => {
  const s = playing(); s.levels.pair = 3;
  assert.deepEqual(E.handBase(s, 'pair'), { chips: 40, mult: 4 });
  assert.equal(E.scoreHand(s, cards('13S 13H')).total, 240);
});
test('joker multiplication respects left-to-right order', () => {
  const s = playing(); s.jokers = [{ id: 'joker' }, { id: 'banana' }];
  assert.equal(E.scoreHand(s, cards('13S 13H')).total, 540);
  s.jokers.reverse();
  assert.equal(E.scoreHand(s, cards('13S 13H')).total, 300);
});
test('card-triggered multipliers occur before the main joker row', () => {
  const s = playing(); s.jokers = [{ id: 'banana' }, { id: 'lusty' }];
  assert.equal(E.scoreHand(s, cards('13S 13H')).total, 450);
});
test('boss-debuffed cards still form hands but contribute no chips or card effects', () => {
  const s = playing(); s.blindIndex = 2; s.ante = 1; s.jokers = [{ id: 'glutton' }];
  const result = E.scoreHand(s, cards('13C 13H'));
  assert.equal(result.id, 'pair'); assert.equal(result.chips, 20); assert.equal(result.mult, 2);
});
test('boss requirements reject a play without spending a hand', () => {
  const s = playing(); s.blindIndex = 2; s.ante = 5; loadHand(s, '13S 13H');
  assert.match(E.playHand(s).error, /5/); assert.equal(s.hands, 4); assert.equal(s.hand.length, 2);
  s.ante = 6; s.roundPlayed = ['pair']; assert.ok(E.playHand(s).error);
  s.ante = 7; s.roundPlayed = ['flush']; assert.ok(E.playHand(s).error);
});
test('same seed and decisions produce identical decks and shops', () => {
  const a = playing('REPRODUCIBLE'), b = playing('REPRODUCIBLE');
  assert.deepEqual(a.hand, b.hand); assert.deepEqual(a.drawPile, b.drawPile);
  E.createShop(a); E.createShop(b); assert.deepEqual(a.shop, b.shop);
  assert.notDeepEqual(a.hand, playing('OTHER').hand);
});
test('discard refills, consumes one chance and never recycles used cards', () => {
  const s = playing(); const removed = s.hand.slice(0, 5); s.selected = removed;
  assert.ok(E.discard(s)); assert.equal(s.hand.length, 8); assert.equal(s.discards, 3); assert.equal(s.drawPile.length, 39);
  assert.ok(removed.every(id => !s.hand.includes(id) && !s.drawPile.includes(id)));
  s.discards = 0; s.selected = s.hand.slice(0, 2); const before = JSON.stringify(s); assert.equal(E.discard(s), false); assert.equal(JSON.stringify(s), before);
});
test('winning with the final hand succeeds before loss and payout is awarded once', () => {
  const s = playing(); s.hands = 1; s.score = 290; loadHand(s, '13S 13H');
  E.playHand(s); assert.equal(s.phase, 'roundWon'); assert.equal(s.hands, 0);
  const expected = 4 + E.payout(s).total; assert.ok(E.cashOut(s)); assert.equal(s.money, expected); assert.equal(s.phase, 'shop');
  assert.equal(E.cashOut(s), false); assert.equal(s.money, expected);
});
test('a failed final hand ends the run; no extra plays are possible', () => {
  const s = playing(); s.hands = 1; loadHand(s, '2S'); E.playHand(s);
  assert.equal(s.phase, 'lost'); const before = JSON.stringify(s); assert.ok(E.playHand(s).error); assert.equal(JSON.stringify(s), before);
});
test('shop payments, inventory limits, sold items and immediate planet upgrades', () => {
  const s = playing(); s.phase = 'shop'; s.money = 20; E.createShop(s);
  s.shop.items = [{ type: 'joker', id: 'joker' }, { type: 'planet', id: 'pair' }, { type: 'tarot', id: 'hermit' }];
  assert.equal(E.buyItem(s, 0), null); assert.equal(s.money, 18); assert.equal(s.jokers.length, 1);
  assert.ok(E.buyItem(s, 0)); assert.equal(s.money, 18);
  E.buyItem(s, 1); assert.equal(s.levels.pair, 2); assert.equal(s.money, 15);
  E.buyItem(s, 2); assert.deepEqual(s.consumables, ['hermit']); assert.equal(s.money, 12);
  assert.equal(E.useTarot(s, 0), null); assert.equal(s.money, 24); assert.equal(s.consumables.length, 0);
  s.jokers = Array.from({ length: 5 }, () => ({ id: 'joker' })); s.shop.items[0].sold = false;
  assert.ok(E.buyItem(s, 0)); assert.equal(s.money, 24);
});
test('reroll preserves voucher and booster state, increases cost and charges once', () => {
  const s = playing(); s.phase = 'shop'; s.money = 20; E.createShop(s); const voucher = s.shop.voucher; s.shop.booster = false;
  assert.ok(E.reroll(s)); assert.equal(s.money, 15); assert.equal(s.shop.rerollCost, 6); assert.equal(s.shop.voucher, voucher); assert.equal(s.shop.booster, false);
});
test('booster picks exactly one joker and blocks leaving until resolved', () => {
  const s = playing(); s.phase = 'shop'; s.money = 20; E.createShop(s);
  assert.ok(E.buyBooster(s)); assert.equal(s.money, 14); assert.equal(s.shop.pack.length, 3); assert.equal(E.nextBlind(s), false);
  assert.ok(E.chooseBooster(s, 0)); assert.equal(s.jokers.length, 1); assert.equal(s.shop.pack, null); assert.equal(E.chooseBooster(s, 0), false);
});
test('tarots persistently change selected cards, replace enhancements, and wrap ace', () => {
  const s = playing(); const hand = loadHand(s, '14S 13H'); s.consumables = ['empress', 'hierophant'];
  assert.equal(E.useTarot(s, 0), null); assert.ok(hand.every(c => c.enhancement === 'mult'));
  assert.equal(E.useTarot(s, 0), null); assert.ok(hand.every(c => c.enhancement === 'bonus'));
  s.consumables = ['strength']; E.useTarot(s, 0); assert.deepEqual(hand.map(c => c.rank), [2, 14]);
  s.consumables = ['empress']; s.selected = []; assert.ok(E.useTarot(s, 0)); assert.equal(s.consumables.length, 1);
});
test('green joker preview and actual play agree, discards lower its accumulated mult', () => {
  const s = playing(); s.jokers = [{ id: 'green', value: 2 }]; const hand = loadHand(s, '2S');
  const preview = E.scoreHand(s, hand).total; assert.equal(E.playHand(s).total, preview); assert.equal(s.jokers[0].value, 3);
  s.selected = [s.hand[0]]; E.discard(s); assert.equal(s.jokers[0].value, 2);
});
test('blind progression, skip rewards, ante targets, and the final victory', () => {
  const s = E.newRun('PROGRESSION'); assert.ok(E.skipBlind(s)); assert.equal(s.money, 9); assert.equal(s.blindIndex, 1); assert.ok(E.skipBlind(s)); assert.equal(s.blindIndex, 2); assert.equal(E.skipBlind(s), false);
  s.phase = 'shop'; s.hands = 1; s.discards = 0; E.createShop(s); E.nextBlind(s); assert.equal(s.ante, 2); assert.equal(s.blindIndex, 0); assert.equal(E.targetFor(s), 800); assert.equal(s.hands, 4); assert.equal(s.discards, 4);
  s.ante = 8; s.blindIndex = 2; s.phase = 'roundWon'; assert.equal(E.targetFor(s), 100000); E.cashOut(s); assert.equal(s.phase, 'victory');
});
test('new blind resets deck and one-round counters but retains upgrades and jokers', () => {
  const s = playing(); s.levels.flush = 3; s.jokers = [{ id: 'joker', value: 0 }]; s.vouchers = ['hand', 'discard', 'size']; s.roundPlayed = ['pair'];
  s.phase = 'shop'; E.createShop(s); E.nextBlind(s); E.startBlind(s);
  assert.equal(s.hand.length, 9); assert.equal(s.drawPile.length, 43); assert.equal(s.hands, 5); assert.equal(s.discards, 5); assert.deepEqual(s.roundPlayed, []); assert.equal(s.levels.flush, 3); assert.equal(s.jokers.length, 1);
});
test('water removes discards, manacle reduces hand size and interest is capped', () => {
  const s = E.newRun(); s.blindIndex = 2; s.ante = 3; E.startBlind(s); assert.equal(s.discards, 0);
  s.ante = 8; s.phase = 'blind'; E.startBlind(s); assert.equal(s.hand.length, 7);
  s.money = 100; assert.equal(E.payout(s).interest, 5);
});
