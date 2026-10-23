import * as E from './engine.js';
export const TUTORIAL_STEPS = ['选出对子', '看懂计分', '组合小丑', '商店升级'];
export const shouldOfferTutorial = (seen, hasSavedRun) => !seen && !hasSavedRun;
export function createTutorial(mode = 'classic') {
  const state = E.newRun('TUTORIAL',undefined,'medium',mode);
  state.hand = ['S13', 'H13', 'D9', 'C7', 'S2']; state.money = 8;
  return { step: 0, state, purchased: false };
}
export function selectTutorialCard(model, id) {
  if (model.step !== 0 || !model.state.hand.includes(id)) return;
  const selection = model.state.selected;
  if (selection.includes(id)) model.state.selected = selection.filter(c => c !== id);
  else if (selection.length < 2) selection.push(id);
}
export function tutorialScore(model) {
  const ids = model.step === 0 ? model.state.selected : ['S13', 'H13'];
  return E.scoreHand(model.state, ids.map(id => model.state.deck.find(c => c.id === id)));
}
export function canAdvanceTutorial(model) {
  return model.step === 0 ? model.state.selected.length === 2 && tutorialScore(model)?.id === 'pair' : model.step === 3 ? model.purchased : model.step < 4;
}
export function advanceTutorial(model) {
  if (!canAdvanceTutorial(model) || model.step >= 3) return false;
  model.step++;
  if (model.step >= 2) {
    model.state.jokers = (E.jokersOnly(model.state) ? ['ss-half','ss-sharp'] : ['joker','banana']).map(id=>({id}));
    model.state.roundPlayed = ['pair'];
  }
  if (model.step === 3) { model.state.phase = 'shop'; model.state.shop = { items: [E.jokersOnly(model.state) ? { type:'joker',id:'ss-joker' } : { type: 'planet', id: 'pair' }] }; }
  return true;
}
export function swapTutorialJokers(model) { if (model.step === 2) model.state.jokers.reverse(); }
export function buyTutorialItem(model) {
  if (model.step !== 3 || model.purchased) return false;
  if (E.buyItem(model.state, 0)) return false;
  model.purchased = true; return true;
}
