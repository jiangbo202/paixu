import { bossFor, isFace, HANDS, playError, rankLabel, handBase, TAROTS, VOUCHERS } from './engine.js';

export const DEFAULT_SCORE_DURATION = 3000;
export function normalizeScoreDuration(value) {
  return Number.isFinite(value) ? Math.round(Math.max(0, Math.min(8000, value)) / 500) * 500 : DEFAULT_SCORE_DURATION;
}
export function scoringTiming(duration, stepCount) {
  const base = normalizeScoreDuration(duration), count = Math.max(1, Math.floor(stepCount) || 1);
  const tally = Math.min(600, base * .2);
  // Six beats are a normal five-card hand plus its base score. The preference
  // controls playback pace, never a deadline that squeezes later joker effects.
  const step = (base - tally) / 6;
  const hold = Math.max(0, base - step * count - tally);
  return { total: Math.max(base, step * count + tally), tally, step, hold };
}

// Dense retrigger chains keep their complete breakdown. Compact the visible
// snapshots without using their count to speed up the playback clock.
export function animationScoreSteps(result, duration) {
  const steps=scoreSteps(result), base=normalizeScoreDuration(duration), timing=scoringTiming(base,steps.length);
  if (!base) return [];
  const limit=Math.max(2,Math.floor((base-timing.tally)/160));
  if (steps.length<=limit) return steps;
  const summarize=group=>{
    if (group.length===1) return group[0];
    const first=group[0],last=group.at(-1),sameCard=first.cardId && group.every(step=>step.cardId===first.cardId);
    const sameJoker=first.jokerIndex!==undefined && group.every(step=>step.jokerIndex===first.jokerIndex);
    return {kind:sameCard?'card':sameJoker?'joker':'effects',...(sameCard?{cardId:first.cardId}:{}),...(sameJoker?{jokerIndex:first.jokerIndex}:{}),label:`${sameCard||sameJoker ? first.label : '合并计分'} · ${group.reduce((n,step)=>n+(step.eventCount||1),0)} 次效果`,text:`${last.chips} × ${last.mult}`,chips:last.chips,mult:last.mult,eventCount:group.reduce((n,step)=>n+(step.eventCount||1),0)};
  };
  const groups=[];
  for (const step of steps) {
    const group=groups.at(-1);
    if (step.cardId && group?.[0].cardId===step.cardId) group.push(step);
    else groups.push([step]);
  }
  const compact=groups.map(summarize);
  if (compact.length<=limit) return compact;
  const output=[compact[0]],rest=compact.slice(1),buckets=limit-1;
  for(let i=0;i<buckets;i++) output.push(summarize(rest.slice(Math.floor(i*rest.length/buckets),Math.floor((i+1)*rest.length/buckets))));
  return output;
}

export async function runScoreSequence(steps, interval, {onStep, wait, skipped}) {
  for(let i=0;i<steps.length && !skipped();i++) {
    onStep(steps[i],i);
    // Do not catch up with zero-delay bursts after a slow render or resumed tab.
    await wait(interval);
  }
}

export function formatDuration(milliseconds) {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return '—';
  const seconds = Math.floor(milliseconds / 1000), minutes = Math.floor(seconds / 60), hours = Math.floor(minutes / 60);
  return hours ? `${hours}:${String(minutes % 60).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}` : `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
}
export const rarityKey = rarity => ({ '普通': 'common', '罕见': 'uncommon', '稀有': 'rare' }[rarity] || rarity);
export function bonusSummary(state) {
  return {
    planets: Object.entries(HANDS).filter(([id]) => state.levels[id] > 1).map(([id, h]) => ({ id, name: h.name, planet: h.planet, level: state.levels[id], chips: handBase(state, id).chips - h.chips, mult: handBase(state, id).mult - h.mult })),
    vouchers: VOUCHERS.filter(v => state.vouchers.includes(v.id)),
    enhanced: state.deck.filter(card => card.enhancement),
    used: TAROTS.filter(card => state.appliedEffects?.[card.id]?.count).map(card => ({ ...card, ...state.appliedEffects[card.id] })),
  };
}

const suitPaths = {
  H: 'M50 91C42 82 5 57 5 32C5 7 34 0 50 23C66 0 95 7 95 32C95 57 58 82 50 91Z',
  D: 'M50 3L89 50L50 97L11 50Z',
  S: 'M50 3C41 17 6 42 6 63C6 84 32 88 44 73L36 96H64L56 73C68 88 94 84 94 63C94 42 59 17 50 3Z',
  C: 'M50 5A21 21 0 1 1 50 47A21 21 0 1 1 50 5ZM27 34A22 22 0 1 1 27 78A22 22 0 1 1 27 34ZM73 34A22 22 0 1 1 73 78A22 22 0 1 1 73 34ZM44 52H56L65 96H35Z',
};
const pipRows = {
  2: [[50, 43], [50, 107]], 3: [[50, 43], [50, 75], [50, 107]],
  4: [[34, 43], [66, 43], [34, 107], [66, 107]],
  5: [[34, 43], [66, 43], [50, 75], [34, 107], [66, 107]],
  6: [[34, 43], [66, 43], [34, 75], [66, 75], [34, 107], [66, 107]],
  7: [[34, 43], [66, 43], [50, 59], [34, 75], [66, 75], [34, 107], [66, 107]],
  8: [[34, 43], [66, 43], [50, 59], [34, 75], [66, 75], [50, 91], [34, 107], [66, 107]],
  9: [[34, 43], [66, 43], [34, 64], [66, 64], [50, 75], [34, 86], [66, 86], [34, 107], [66, 107]],
  10: [[34, 43], [66, 43], [50, 53], [34, 64], [66, 64], [34, 86], [66, 86], [50, 97], [34, 107], [66, 107]],
};
export function cardPips(rank) {
  const size = rank <= 3 ? 23 : rank <= 5 ? 20 : 18;
  return (pipRows[rank] || []).map(([x, y]) => ({ x, y, size, flipped: y > 75 }));
}
// One coordinate system keeps the corner indices and center artwork separate at every card size.
export function cardArtwork(card) {
  const path = suitPaths[card.suit];
  const suit = (x, y, size, flipped = false) => `<path d="${path}" transform="translate(${x} ${y}) rotate(${flipped ? 180 : 0}) scale(${size / 100}) translate(-50 -50)"/>`;
  const corner = `<text x="9" y="28" font-family="Georgia,serif" font-weight="700" font-size="${card.rank === 10 ? 20 : 24}">${rankLabel(card.rank)}</text>${suit(16, 40, 14)}`;
  let center;
  if (card.rank === 14) center = suit(50, 75, 47);
  else if (card.rank >= 11) center = `<rect x="28" y="33" width="44" height="84" rx="1" fill="none" stroke="currentColor" stroke-width="1.2"/><svg x="30" y="35" width="40" height="80" viewBox="0 0 70 100"><path d="M13 32 8 12l18 10L35 5l10 17 18-10-5 20z" fill="#d5b367" stroke="currentColor" stroke-width="2"/><path d="M17 36h36v28L35 81 17 64z" fill="#eddbc0" stroke="currentColor" stroke-width="2"/><path d="m22 48 7 2m12 0 7-2M29 65h12M35 52v10" fill="none" stroke="currentColor" stroke-width="2"/><path d="m17 72-9 18h54l-9-18-18 12z"/><path d="M21 36h28" stroke="currentColor" stroke-width="5"/></svg>`;
  else center = cardPips(card.rank).map(p => suit(p.x, p.y, p.size, p.flipped)).join('');
  return `<svg class="playing-card-art" viewBox="0 0 100 150" fill="currentColor" aria-hidden="true"><g class="card-index">${corner}</g><g class="card-center">${center}</g><g class="card-index" transform="rotate(180 50 75)">${corner}</g></svg>`;
}

// These are display hints only. The engine and server remain authoritative.
export function roundGuidance(state, cards = []) {
  const boss = bossFor(state);
  if (!boss || !['blind', 'playing'].includes(state.phase)) return null;
  const used = state.phase === 'blind' ? [] : [...new Set(state.roundPlayed || [])];
  const titles = {
    club: '梅花牌不计分', hook: '出牌后，随机丢弃 2 张手牌', water: '本轮不能弃牌',
    plant: 'J / Q / K 不计分', psychic: '每次必须正好打出 5 张牌',
    eye: '每种牌型，本轮只能打出一次', mouth: '本轮只能使用第一手的牌型', manacle: '手牌上限减少 1 张',
  };
  let detail = boss.desc;
  let tags = [];
  if (boss.id === 'eye') {
    detail = used.length ? '已用牌型不能重复，请改用其他组合。' : '尚未使用任何牌型；出牌后会在这里标记。';
    tags = used.map(id => ({ label: HANDS[id].name, used: true }));
  }
  if (boss.id === 'mouth') {
    detail = used.length ? '已锁定牌型，之后每一手都必须相同。' : '第一手出牌将锁定本轮牌型，请谨慎选择。';
    if (used.length) tags = [{ label: HANDS[used[0]].name, used: false }];
  }
  if (boss.id === 'plant' && state.deck.every(card => isFace(state,card))) { titles.plant = '全牌失效：幻视将所有牌视为人头'; detail = '幻视生效时，植物会使所有扑克牌失效；出售幻视可恢复非人头牌计分。'; }
  if (boss.id === 'psychic') detail = '少于或多于 5 张均不能出牌；不符合要求时不会消耗次数。';
  if (boss.id === 'water') detail = '弃牌次数为 0；请用现有手牌组成得分组合。';
  const error = cards.length && state.phase === 'playing' ? playError(state, cards) : null;
  return { boss, title: titles[boss.id], detail, tags, error };
}

// Old autosaves have text-only events. Recover their snapshots for compatibility.
export function scoreSteps(result) {
  let chips = 0, mult = 0;
  return (result.events || []).map((event, index) => {
    if (Number.isFinite(event.chips) && Number.isFinite(event.mult)) ({ chips, mult } = event);
    else {
      const numbers = event.text.match(/[\d.]+/g)?.map(Number) || [];
      if (index === 0) [chips, mult] = numbers;
      else if (event.text.includes('筹码')) chips += numbers[0] || 0;
      else if (event.text.startsWith('×')) mult *= numbers[0] || 1;
      else mult += numbers[0] || 0;
    }
    return { ...event, chips, mult, kind: event.kind || (index ? 'card' : 'base') };
  });
}
