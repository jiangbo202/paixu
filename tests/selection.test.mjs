import test from 'node:test';
import assert from 'node:assert/strict';
import { paintSelection, crossedCards, bindSwipeSelection } from '../selection.js';

test('selection strokes add or erase once, retain prior selections and enforce the five-card limit', () => {
  assert.deepEqual(paintSelection(['A'], ['B', 'B', 'C'], true), ['A', 'B', 'C']);
  assert.deepEqual(paintSelection(['A', 'B', 'C'], ['B', 'B', 'A'], false), ['C']);
  assert.deepEqual(paintSelection(['A', 'B', 'C', 'D'], ['E', 'F', 'G'], true), ['A', 'B', 'C', 'D', 'E']);
  assert.deepEqual(paintSelection([], ['H', 'G', 'F', 'E', 'D', 'C'], true), ['H', 'G', 'F', 'E', 'D']);
});
test('fast horizontal, vertical and reverse paths find crossed cards in travel order, ignoring cards outside the path', () => {
  const rects = Array.from({ length: 8 }, (_, i) => ({ id: String(i), left: i * 30, right: i * 30 + 29, top: 20, bottom: 120 }));
  assert.deepEqual(crossedCards(rects, { x: 10, y: 70 }, { x: 239, y: 70 }), ['0','1','2','3','4','5','6','7']);
  assert.deepEqual(crossedCards(rects, { x: 239, y: 70 }, { x: 10, y: 70 }), ['7','6','5','4','3','2','1','0']);
  assert.deepEqual(crossedCards(rects, { x: 50, y: 0 }, { x: 50, y: 140 }), ['1']);
  assert.deepEqual(crossedCards(rects, { x: 0, y: 10 }, { x: 240, y: 10 }), []);
});
function gestureFixture() {
  const listeners = new Map(), classes = new Set(); let captured = false, selected = [];
  const app = { setPointerCapture() { captured = true; }, hasPointerCapture() { return captured; }, releasePointerCapture() { captured = false; } };
  const root = { documentElement: { classList: { add: k => classes.add(k), remove: k => classes.delete(k) } }, querySelector: () => app, addEventListener(type, callback) { const callbacks = listeners.get(type) || []; callbacks.push(callback); listeners.set(type, callbacks); } };
  const cards = Array.from({ length: 8 }, (_, i) => ({ dataset: { id: String(i) }, getBoundingClientRect: () => ({ left: i * 30, right: i * 30 + 70, top: 20, bottom: 120 }), getAttribute: () => String(selected.includes(String(i))), closest() { return this; } }));
  cards.forEach(card => { card.parentElement = { querySelectorAll: () => cards }; });
  bindSwipeSelection({ root, canSelect: () => true, onPaint: (ids, selecting) => { selected = paintSelection(selected, ids, selecting); } });
  const emit = (type, x = 10, y = 60, extra = {}) => { const event = { pointerId: 1, isPrimary: true, button: 0, clientX: x, clientY: y, target: cards[0], detail: 1, preventDefault() { this.prevented = true; }, stopImmediatePropagation() { this.stopped = true; }, ...extra }; for (const callback of listeners.get(type) || []) callback(event); return event; };
  return { emit, cards, app, classes, selection: () => selected };
}
test('a tap stays a normal click; dragging captures on the stable app and suppresses only its release click', () => {
  const f = gestureFixture(); f.emit('pointerdown'); f.emit('pointermove', 13); f.emit('pointerup', 13);
  assert.deepEqual(f.selection(), []); assert.ok(!f.emit('click').prevented);
  f.emit('pointerdown'); f.emit('pointermove', 239);
  assert.deepEqual(f.selection(), ['0','1','2','3','4']);
  // Real touch transfers implicit capture away from the original button.
  f.emit('lostpointercapture', 239, 60, { target: f.cards[0] });
  f.emit('pointermove', 10); assert.deepEqual(f.selection(), ['0','1','2','3','4']);
  f.emit('pointerup'); assert.equal(f.classes.size, 0); assert.ok(f.emit('click', 10, 60, { target: f.app }).stopped); assert.ok(!f.emit('click').prevented);
  // Another stroke beginning on a selected card erases all crossed cards.
  f.emit('pointerdown'); f.emit('pointermove', 239); assert.deepEqual(f.selection(), []); f.emit('pointercancel');
  f.emit('pointerdown', 220, 60, { target: f.cards[7] }); f.emit('pointermove', 10);
  assert.deepEqual(f.selection(), ['7','6','5','4','3']); f.emit('pointerup');
});
test('non-primary touches and right-clicks do not start gestures; keyboard clicks are not swallowed', () => {
  const f = gestureFixture(); f.emit('pointerdown', 10, 60, { isPrimary: false }); f.emit('pointermove', 239); assert.deepEqual(f.selection(), []);
  f.emit('pointerdown', 10, 60, { button: 2 }); f.emit('pointermove', 239); assert.deepEqual(f.selection(), []);
  f.emit('pointerdown'); f.emit('pointermove', 239); f.emit('pointerup'); assert.ok(!f.emit('click', 0, 0, { detail: 0 }).prevented);
  f.emit('pointerdown', 0, 0, { target: { closest: () => null } }); assert.ok(!f.emit('click').prevented);
});
