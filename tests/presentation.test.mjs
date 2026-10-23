import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../engine.js';
import { roundGuidance, scoreSteps, animationScoreSteps, runScoreSequence, cardPips, formatDuration, rarityKey, bonusSummary, normalizeScoreDuration, scoringTiming } from '../presentation.js';
import { setLanguage, t } from '../i18n.js';

const bossRun = ante => { const state = E.newRun('UI'); state.ante = ante; state.blindIndex = 2; E.startBlind(state); return state; };
const kings = [{ id: '13S', rank: 13, suit: 'S' }, { id: '13H', rank: 13, suit: 'H' }];

test('number cards have the right pip count, separated from corners and each other', () => {
  for (let rank = 2; rank <= 10; rank++) {
    const pips = cardPips(rank); assert.equal(pips.length, rank);
    for (const pip of pips) {
      if (pip.y - pip.size / 2 < 47) assert.ok(pip.x - pip.size / 2 >= 24, `${rank}: top-left corner`);
      if (pip.y + pip.size / 2 > 103) assert.ok(pip.x + pip.size / 2 <= 76, `${rank}: bottom-right corner`);
      for (const other of pips) if (other !== pip) assert.ok(Math.hypot(pip.x - other.x, pip.y - other.y) > (pip.size + other.size) / 2, `${rank}: overlapping pips`);
    }
  }
});

test('dense face retriggers keep the complete trace without changing the chosen playback pace',()=>{
 const state=E.newRun('DENSE',undefined,'medium','six-seat');E.startBlind(state);
 state.jokers=['pareidolia','blueprint','buskin','hack','scary','smiley'].map(id=>({id:'ss-'+id}));
 const cards=['S2','H3','C4','D5','S6'].map(id=>state.deck.find(card=>card.id===id));
 const result=E.scoreHand(state,cards),raw=scoreSteps(result),before=JSON.stringify(result);
 assert.ok(raw.length>50);
 for(const duration of [500,1500,3000,8000]){
  const display=animationScoreSteps(result,duration),timing=scoringTiming(duration,display.length);
  assert.ok(display.length<raw.length);assert.equal(timing.step,scoringTiming(duration,6).step);
  assert.equal(display.at(-1).chips,result.chips);assert.equal(display.at(-1).mult,result.mult);
  assert.equal(display.reduce((n,step)=>n+(step.eventCount||1),0),raw.length);
  assert.equal(timing.step*display.length+timing.tally+timing.hold,timing.total);
  assert.ok(timing.total>=duration);
 }
 assert.deepEqual(animationScoreSteps(result,0),[]);assert.equal(JSON.stringify(result),before);
 assert.equal(scoreSteps(result).length,raw.length);
});

test('successive hands wait their full interval even after slow renders and never inherit skip state',async()=>{
 for(const count of [2,4,12,5,15,3]){
  const timing=scoringTiming(3000,count),waits=[],starts=[];let elapsed=0;
  await runScoreSequence(Array.from({length:count},(_,i)=>i),timing.step,{
   skipped:()=>false,onStep:step=>{starts.push(elapsed);elapsed+=step%2?35:2;},wait:async ms=>{waits.push(ms);elapsed+=ms;},
  });
  assert.equal(waits.length,count);assert.ok(waits.every(ms=>ms===timing.step));
  assert.ok(waits.every(ms=>ms===400),'adding effects must not shorten a beat');
  assert.ok(starts.slice(1).every((time,i)=>time-starts[i]>=timing.step));
  assert.ok(elapsed+timing.tally+timing.hold>=3000);
 }
 let skip=false,shown=[];
 await runScoreSequence([1,2,3],200,{onStep:step=>shown.push(step),skipped:()=>skip,wait:async()=>{skip=true;}});
 assert.deepEqual(shown,[1]);
 shown=[];await runScoreSequence([1,2,3],200,{onStep:step=>shown.push(step),skipped:()=>false,wait:async()=>{}});
 assert.deepEqual(shown,[1,2,3]);
});

test('acquiring face-card jokers across hands extends playback instead of speeding up its steps',()=>{
 const state=E.newRun('PACE',undefined,'medium','six-seat');E.startBlind(state);
 const cards=['S11','H12','C13','D10','S9'].map(id=>state.deck.find(card=>card.id===id));
 const timings=[];
 for(const ids of [[],['scary'],['smiley','scary','joker']]){
  state.jokers=ids.map(id=>({id:'ss-'+id}));
  const result=E.scoreHand(state,cards),steps=animationScoreSteps(result,3000);
  timings.push(scoringTiming(3000,steps.length));
  assert.equal(steps.at(-1).chips,result.chips);assert.equal(steps.at(-1).mult,result.mult);
 }
 assert.deepEqual(timings.map(timing=>timing.step),[400,400,400]);
 assert.deepEqual(timings.map(timing=>timing.tally),[600,600,600]);
 assert.deepEqual(timings.map(timing=>timing.total),[3000,4200,5800]);
});

test('ordinary short scores retain their per-event animation and grouped labels translate',()=>{
 const state=E.newRun('SHORT');const result=E.scoreHand(state,[state.deck.find(c=>c.id==='S13')]);
 assert.deepEqual(animationScoreSteps(result,3000),scoreSteps(result));
 setLanguage('en');assert.doesNotMatch(t('合并计分 · 18 次效果'),/[\u3400-\u9fff]/);setLanguage('zh');
});

test('Eye, Mouth and Psychic guidance tracks actual restrictions and used hands', () => {
  const eye = bossRun(6); eye.roundPlayed = ['pair', 'flush'];
  const eyeHint = roundGuidance(eye, kings);
  assert.deepEqual(eyeHint.tags.map(tag => tag.label), ['对子', '同花']);
  assert.ok(eyeHint.tags.every(tag => tag.used)); assert.ok(eyeHint.error);
  const mouth = bossRun(7);
  assert.deepEqual(roundGuidance(mouth).tags, []);
  mouth.roundPlayed = ['flush'];
  assert.deepEqual(roundGuidance(mouth, kings).tags, [{ label: '同花', used: false }]);
  assert.ok(roundGuidance(mouth, kings).error);
  assert.ok(roundGuidance(bossRun(5), kings).error);
  eye.phase = 'blind'; assert.deepEqual(roundGuidance(eye).tags, []);
  mouth.phase = 'blind'; assert.deepEqual(roundGuidance(mouth).tags, []);
  assert.equal(roundGuidance(E.newRun()), null);
  eye.phase = 'shop'; assert.equal(roundGuidance(eye), null);
});

test('score snapshots preserve card triggers and the order of additive/multiplicative jokers', () => {
  const state = E.newRun('ANIMATION'); E.startBlind(state);
  state.jokers = [{ id: 'lusty' }, { id: 'joker' }, { id: 'banana' }];
  const result = E.scoreHand(state, kings);
  const steps = scoreSteps(result);
  assert.deepEqual(steps.map(({ chips, mult }) => [chips, mult]), [[10, 2], [20, 2], [30, 2], [30, 5], [30, 9], [30, 27]]);
  assert.equal(result.total, 810);
  assert.equal(steps[2].cardId, '13H');
  assert.equal(steps[3].kind, 'joker'); assert.equal(steps[3].jokerIndex, 0);
  assert.equal(steps.at(-1).jokerIndex, 2);
  const legacy = scoreSteps({ events: result.events.map(({ label, text }) => ({ label, text })) });
  assert.deepEqual(legacy.map(({ chips, mult }) => [chips, mult]), steps.map(({ chips, mult }) => [chips, mult]));
});

test('debuffed cards never receive scoring steps and rule/animation labels localize', () => {
  const state = bossRun(1);
  const result = E.scoreHand(state, [{ id: '2C', rank: 2, suit: 'C' }]);
  assert.equal(result.events.length, 1);
  setLanguage('en');
  for (let ante = 1; ante <= 8; ante++) {
    const hint = roundGuidance(bossRun(ante));
    for (const text of [hint.title, hint.detail]) assert.doesNotMatch(t(text), /[\u3400-\u9fff]/, text);
  }
  for (const text of ['牌型基础', '卡牌加成', '小丑效果', '总分入账', '请调整选牌；不会消耗出牌次数。']) assert.doesNotMatch(t(text), /[\u3400-\u9fff]/);
  setLanguage('zh');
});


test('duration formatting covers minutes, hours, missing data and invalid input', () => {
  for (const [input, expected] of [[0, '0:00'], [59999, '0:59'], [60000, '1:00'], [3725000, '1:02:05'], [86400000, '24:00:00'], [-1, '—'], [null, '—'], [undefined, '—'], [Infinity, '—']]) assert.equal(formatDuration(input), expected);
  assert.deepEqual(['普通', '罕见', '稀有'].map(rarityKey), ['common', 'uncommon', 'rare']);
});

test('bonus summary derives active upgrades and separates consumed effects from current enhancements', () => {
  const state = E.newRun('BONUSES');
  assert.deepEqual(bonusSummary(state), {planets: [], vouchers: [], enhanced: [], used: []});
  state.levels.pair = 3; state.vouchers = ['hand'];
  const card = state.deck[0]; card.enhancement = 'mult';
  state.appliedEffects = {hermit: {count: 2, money: 28, cardIds: []}, hierophant: {count: 1, money: 0, cardIds: [card.id]}};
  const bonus = bonusSummary(state);
  assert.equal(bonus.planets[0].level, 3); assert.equal(bonus.planets[0].chips, 30);
  assert.equal(bonus.vouchers[0].id, 'hand'); assert.equal(bonus.enhanced[0].enhancement, 'mult');
  assert.equal(bonus.used.find(c => c.id === 'hermit').money, 28);
  const labels = ['声音设置', '加成清单', '当前牌面增强', '已使用的效果牌', '用时从开局计算至提交或结束，包含等待时间。', '默认曲目：夜色牌桌。音乐与音效可分别关闭；离开页面时暂停播放。'];
  setLanguage('en'); for (const label of labels) assert.doesNotMatch(t(label), /[\u3400-\u9fff]/); setLanguage('zh');
});


test('scoring pace stays constant across event counts and supports off and legacy preferences', () => {
  assert.equal(normalizeScoreDuration(undefined), 3000); assert.equal(normalizeScoreDuration(NaN), 3000);
  assert.equal(normalizeScoreDuration(-500), 0); assert.equal(normalizeScoreDuration(9500), 8000);
  assert.equal(normalizeScoreDuration(1710), 1500);
  for (const duration of [0, 500, 1500, 3000, 8000]) for (const count of [1, 7, 40, 100]) {
    const timing = scoringTiming(duration, count);
    assert.ok(Math.abs(timing.step * count + timing.tally + timing.hold - timing.total) < .0001);
    assert.equal(timing.step,scoringTiming(duration,6).step);
    assert.ok(timing.total>=duration);
    assert.ok(timing.step >= 0 && timing.tally >= 0);
  }
  assert.deepEqual(scoringTiming(0, 12), {total: 0, step: 0, tally: 0, hold: 0});
  assert.deepEqual(scoringTiming(3000,2),{total:3000,step:400,tally:600,hold:1600});
  assert.ok(Number.isFinite(scoringTiming(3000, 0).step));
  setLanguage('en');
  for (const text of ['游戏设置', '计分动画', '默认 3 秒', '基础时长', '设置计分动画的基础时长，自动保存。', '每步按固定节奏播放，效果较多时自动延长，避免加速。', '基础时长包含逐步计分与总分入账；可随时点击「跳过动画」或按 Esc。', '目标达成！', '按手牌上方规则选择，再点击出牌']) assert.doesNotMatch(t(text), /[\u3400-\u9fff]/);
  setLanguage('zh');
});
