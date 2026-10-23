// A stroke paints one selection state; crossing a card twice never toggles it twice.
export function paintSelection(selected, ids, selecting, limit = 5) {
  const next = [...selected];
  for (const id of ids) {
    const index = next.indexOf(id);
    if (!selecting && index >= 0) next.splice(index, 1);
    else if (selecting && index < 0 && next.length < limit) next.push(id);
  }
  return next;
}

// Segment intersection catches cards skipped between pointer events during a fast swipe.
export function crossedCards(cards, from, to) {
  const hits = [];
  for (const card of cards) {
    let enter = 0, exit = 1;
    for (const [axis, min, max] of [['x', card.left, card.right], ['y', card.top, card.bottom]]) {
      const delta = to[axis] - from[axis];
      if (!delta) { if (from[axis] < min || from[axis] > max) exit = -1; continue; }
      const a = (min - from[axis]) / delta, b = (max - from[axis]) / delta;
      enter = Math.max(enter, Math.min(a, b)); exit = Math.min(exit, Math.max(a, b));
    }
    if (enter <= exit) hits.push({ id: card.id, enter });
  }
  return hits.sort((a, b) => a.enter - b.enter).map(card => card.id);
}

export function bindSwipeSelection({ root = document, canSelect, onPaint }) {
  let stroke = null, suppressClickUntil = 0;
  const end = event => {
    if (!stroke || event.pointerId !== stroke.pointerId) return;
    if (stroke.active) suppressClickUntil = Date.now() + 450;
    const previous = stroke; stroke = null;
    if (previous.capture?.hasPointerCapture?.(previous.pointerId)) previous.capture.releasePointerCapture(previous.pointerId);
    root.documentElement?.classList.remove('is-selecting-cards');
  };
  root.addEventListener('pointerdown', event => {
    // A fresh press belongs to a new action, even when it is outside the hand.
    if (!stroke && event.isPrimary && event.button === 0) suppressClickUntil = 0;
    if (stroke || !event.isPrimary || event.button !== 0 || !canSelect()) return;
    const card = event.target.closest('.hand-cards>[data-action="select"]'); if (!card) return;
    const elements = [...card.parentElement.querySelectorAll('[data-action="select"]')];
    const cards = elements.map(element => { const { left, right, top, bottom } = element.getBoundingClientRect(); return { id: element.dataset.id, left, right, top, bottom }; });
    // In the overlapping fan, each card owns its exposed strip, independent of selection.
    cards.forEach((rect, i) => { if (cards[i + 1]) rect.right = Math.min(rect.right, cards[i + 1].left); });
    stroke = { pointerId: event.pointerId, start: { x: event.clientX, y: event.clientY }, last: { x: event.clientX, y: event.clientY }, cards, id: card.dataset.id, selecting: card.getAttribute('aria-pressed') !== 'true', visited: new Set(), active: false, capture: root.querySelector('#app') };
  });
  root.addEventListener('pointermove', event => {
    if (!stroke || event.pointerId !== stroke.pointerId) return;
    if (!canSelect()) { end(event); return; }
    const point = { x: event.clientX, y: event.clientY };
    if (!stroke.active) {
      if (Math.hypot(point.x - stroke.start.x, point.y - stroke.start.y) < 8) return;
      stroke.active = true; stroke.capture?.setPointerCapture?.(event.pointerId);
      root.documentElement?.classList.add('is-selecting-cards');
    }
    event.preventDefault();
    const ids = [stroke.id, ...crossedCards(stroke.cards, stroke.last, point)].filter(id => !stroke.visited.has(id));
    ids.forEach(id => stroke.visited.add(id)); stroke.last = point;
    if (ids.length) onPaint(ids, stroke.selecting);
  }, { passive: false });
  for (const type of ['pointerup', 'pointercancel']) root.addEventListener(type, end);
  // Touch starts with implicit capture on the button. Ignore its transfer to #app.
  root.addEventListener('lostpointercapture', event => { if (stroke?.active && event.target === stroke.capture) end(event); });
  root.addEventListener('click', event => {
    // Captured pointer clicks may be retargeted to #app; keyboard activation still works.
    if (Date.now() < suppressClickUntil && event.detail !== 0) { suppressClickUntil = 0; event.preventDefault(); event.stopImmediatePropagation(); }
  }, true);
  root.defaultView?.addEventListener('blur', () => { if (stroke) end({ pointerId: stroke.pointerId }); });
}
