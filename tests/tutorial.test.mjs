import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldOfferTutorial, createTutorial, selectTutorialCard, tutorialScore, canAdvanceTutorial, advanceTutorial, swapTutorialJokers, buyTutorialItem } from '../tutorial.js';
import * as E from '../engine.js';
test('tutorial appears for new visitors, skips returning runs, and never touches a real save', () => {
  assert.equal(shouldOfferTutorial(false,false),true); assert.equal(shouldOfferTutorial(true,false),false); assert.equal(shouldOfferTutorial(false,true),false);
  const real=E.newRun('REAL'), snapshot=JSON.stringify(real), lesson=createTutorial();
  selectTutorialCard(lesson,'S13'); selectTutorialCard(lesson,'H13'); advanceTutorial(lesson); advanceTutorial(lesson); swapTutorialJokers(lesson); advanceTutorial(lesson); buyTutorialItem(lesson);
  assert.equal(JSON.stringify(real),snapshot);
});
test('tutorial validates a pair and teaches real scoring, order, and one-time shop purchases', () => {
  const lesson=createTutorial(); assert.equal(advanceTutorial(lesson),false); selectTutorialCard(lesson,'FORGED'); assert.equal(lesson.state.selected.length,0);
  selectTutorialCard(lesson,'D9'); selectTutorialCard(lesson,'C7'); assert.equal(canAdvanceTutorial(lesson),false);
  selectTutorialCard(lesson,'D9'); selectTutorialCard(lesson,'C7'); selectTutorialCard(lesson,'S13'); selectTutorialCard(lesson,'H13');
  assert.equal(canAdvanceTutorial(lesson),true); assert.equal(tutorialScore(lesson).total,60); advanceTutorial(lesson);
  selectTutorialCard(lesson,'S13'); assert.equal(lesson.state.selected.length,2); advanceTutorial(lesson);
  assert.equal(tutorialScore(lesson).total,540); swapTutorialJokers(lesson); assert.equal(tutorialScore(lesson).total,300); advanceTutorial(lesson);
  assert.equal(canAdvanceTutorial(lesson),false); assert.equal(buyTutorialItem(lesson),true); assert.equal(lesson.state.money,5); assert.equal(tutorialScore(lesson).total,945); assert.equal(canAdvanceTutorial(lesson),true);
  assert.equal(buyTutorialItem(lesson),false); assert.equal(lesson.state.money,5);
});

test('Six-seat tutorial teaches joker purchases without planets, vouchers or consumables',()=>{
 const lesson=createTutorial('six-seat');selectTutorialCard(lesson,'S13');selectTutorialCard(lesson,'H13');
 advanceTutorial(lesson);advanceTutorial(lesson);
 const before=tutorialScore(lesson).total;swapTutorialJokers(lesson);assert.notEqual(tutorialScore(lesson).total,before);
 advanceTutorial(lesson);assert.equal(lesson.state.shop.items[0].type,'joker');
 assert.equal(buyTutorialItem(lesson),true);assert.equal(lesson.state.money,6);
 assert.ok(lesson.state.jokers.some(j=>j.id==='ss-joker'));assert.equal(lesson.state.levels.pair,1);
 assert.deepEqual(lesson.state.consumables,[]);assert.deepEqual(lesson.state.vouchers,[]);
});
