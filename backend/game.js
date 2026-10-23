import * as E from '../engine.js';
import { HttpError } from './security.js';

export function clientState(state) {
  const copy = structuredClone(state);
  delete copy.rng; delete copy.serverEntropy;
  copy.seed = 'SERVER'; copy.drawPile = Array(state.drawPile.length).fill(null);
  return copy;
}
export function applyAction(state, input) {
  const previous = JSON.stringify(state);
  // Every server mutation gets fresh cryptographic entropy; no future draws or seeds leave the server.
  state.serverEntropy = Array.from(crypto.getRandomValues(new Uint32Array(256)), n => n / 4294967296);
  const { action, index } = input;
  const indexed = ['buy', 'sell', 'use-tarot', 'sell-tarot', 'pack-pick', 'move-left', 'move-right'];
  if (indexed.includes(action) && (!Number.isInteger(index) || index < 0 || index > 5)) throw new HttpError(400, 'Invalid card index');
  if (['play', 'discard', 'use-tarot'].includes(action)) {
    const cards = input.cards ?? [];
    if (!Array.isArray(cards) || cards.length > 5 || new Set(cards).size !== cards.length || cards.some(id => !state.hand.includes(id))) throw new HttpError(400, 'Invalid selection');
    state.selected = cards;
  }
  let ok = true, error;
  switch (action) {
    case 'start': ok = E.startBlind(state); break;
    case 'skip': ok = E.skipBlind(state); break;
    case 'play': error = E.playHand(state).error; break;
    case 'discard': ok = E.discard(state); break;
    case 'cashout': ok = E.cashOut(state); break;
    case 'next': ok = E.nextBlind(state); break;
    case 'buy': error = E.buyItem(state, index); break;
    case 'reroll': ok = E.reroll(state); break;
    case 'voucher': ok = E.buyVoucher(state); break;
    case 'booster': ok = E.buyBooster(state); break;
    case 'pack-pick': ok = E.chooseBooster(state, index); break;
    case 'pack-skip': ok = state.phase === 'shop' && !!state.shop.pack; if (ok) state.shop.pack = null; break;
    case 'sell': ok = E.sellJoker(state, index); break;
    case 'use-tarot': error = E.useTarot(state, index); break;
    case 'sell-tarot': ok = !E.jokersOnly(state) && ['playing', 'blind', 'shop'].includes(state.phase) && !!state.consumables[index]; if (ok) { state.consumables.splice(index, 1); state.money++; } break;
    case 'move-left': case 'move-right': { const to = index + (action === 'move-left' ? -1 : 1); ok = ['playing', 'blind', 'shop'].includes(state.phase) && !!state.jokers[index] && !!state.jokers[to]; if (ok) [state.jokers[index], state.jokers[to]] = [state.jokers[to], state.jokers[index]]; break; }
    default: throw new HttpError(400, 'Unknown action');
  }
  delete state.serverEntropy;
  if (!ok || error) { Object.assign(state, JSON.parse(previous)); throw new HttpError(400, error || 'Action is unavailable in this phase', 'invalid_action'); }
  state.selected = [];
  for (const value of [state.score, state.totalScore, state.bestHand]) if (!Number.isFinite(value) || value > Number.MAX_SAFE_INTEGER) throw new HttpError(400, 'Score limit reached');
  return state;
}
