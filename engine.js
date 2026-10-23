import { SIX_SEAT_JOKERS, sixSeatMode, effectiveJokers, hasEffect, matchesSuit, handModifiers } from './six-seat.js';
export { sixSeatMode } from './six-seat.js';
import { modeFor, modeSetup, modeRulesFor, validateMode, jokersOnly } from './modes.js';
export { jokersOnly } from './modes.js';
import { rulesFor, difficultySetup, validateDifficulty } from './rules.js';
export const SUITS = [
  { id: 'S', symbol: '♠', name: '黑桃', color: 'black' },
  { id: 'H', symbol: '♥', name: '红桃', color: 'red' },
  { id: 'C', symbol: '♣', name: '梅花', color: 'black' },
  { id: 'D', symbol: '♦', name: '方片', color: 'red' },
];
export const HANDS = {
  high: { name: '高牌', chips: 5, mult: 1, chipStep: 10, multStep: 1, planet: '冥王星', example: 'A · J · 9 · 6 · 2', description: '没有其他牌型时，最高的一张牌计分。' },
  pair: { name: '对子', chips: 10, mult: 2, chipStep: 15, multStep: 1, planet: '水星', example: 'K · K', description: '两张点数相同的牌计分。' },
  twoPair: { name: '两对', chips: 20, mult: 2, chipStep: 20, multStep: 1, planet: '天王星', example: 'Q · Q · 8 · 8', description: '两组不同点数的对子，共四张牌计分。' },
  three: { name: '三条', chips: 30, mult: 3, chipStep: 20, multStep: 2, planet: '金星', example: '7 · 7 · 7', description: '三张点数相同的牌计分。' },
  straight: { name: '顺子', chips: 30, mult: 4, chipStep: 30, multStep: 3, planet: '土星', example: '9 · 8 · 7 · 6 · 5', description: '五张连续点数的牌，A 可作 1 或 14。' },
  flush: { name: '同花', chips: 35, mult: 4, chipStep: 15, multStep: 2, planet: '木星', example: '♥ · ♥ · ♥ · ♥ · ♥', description: '五张花色相同的牌，全部计分。' },
  fullHouse: { name: '葫芦', chips: 40, mult: 4, chipStep: 25, multStep: 2, planet: '地球', example: 'J · J · J · 4 · 4', description: '三条加一对，五张牌全部计分。' },
  four: { name: '四条', chips: 60, mult: 7, chipStep: 30, multStep: 3, planet: '火星', example: '6 · 6 · 6 · 6', description: '四张点数相同的牌计分。' },
  straightFlush: { name: '同花顺', chips: 100, mult: 8, chipStep: 40, multStep: 4, planet: '海王星', example: '9♠ · 8♠ · 7♠ · 6♠ · 5♠', description: '五张同花色的连续牌；最高级的基础牌型。' },
};
const BASE_JOKERS = [
  { id: 'joker', name: '微笑小丑', desc: '+4 倍率', price: 2, rarity: '普通', color: '#e77557', art: 'jester', effect: 'mult', amount: 4 },
  { id: 'greedy', name: '贪婪小丑', desc: '每张计分的方片牌 +3 倍率', price: 5, rarity: '普通', color: '#d99748', art: 'diamond', effect: 'suit', suit: 'D' },
  { id: 'lusty', name: '爱心小丑', desc: '每张计分的红桃牌 +3 倍率', price: 5, rarity: '普通', color: '#d87888', art: 'heart', effect: 'suit', suit: 'H' },
  { id: 'wrathful', name: '愤怒小丑', desc: '每张计分的黑桃牌 +3 倍率', price: 5, rarity: '普通', color: '#7189a6', art: 'spade', effect: 'suit', suit: 'S' },
  { id: 'glutton', name: '饕餮小丑', desc: '每张计分的梅花牌 +3 倍率', price: 5, rarity: '普通', color: '#71a591', art: 'club', effect: 'suit', suit: 'C' },
  { id: 'jolly', name: '欢乐小丑', desc: '打出的牌中包含对子时 +8 倍率', price: 3, rarity: '普通', color: '#e9ac58', art: 'jester', effect: 'pair', amount: 8 },
  { id: 'zany', name: '滑稽小丑', desc: '打出的牌中包含三条时 +12 倍率', price: 4, rarity: '普通', color: '#bd8bb6', art: 'jester', effect: 'three', amount: 12 },
  { id: 'crazy', name: '疯狂小丑', desc: '打出顺子或同花顺时 +12 倍率', price: 4, rarity: '普通', color: '#a6a966', art: 'spiral', effect: 'straight', amount: 12 },
  { id: 'droll', name: '古怪小丑', desc: '打出同花或同花顺时 +10 倍率', price: 4, rarity: '普通', color: '#6caaa4', art: 'jester', effect: 'flush', amount: 10 },
  { id: 'sly', name: '狡猾小丑', desc: '打出的牌中包含对子时 +50 筹码', price: 3, rarity: '普通', color: '#849cb7', art: 'jester', effect: 'pairChips', amount: 50 },
  { id: 'half', name: '半张小丑', desc: '出牌数量不超过 3 张时 +20 倍率', price: 5, rarity: '普通', color: '#b7987a', art: 'half', effect: 'half' },
  { id: 'banner', name: '旗帜', desc: '每次剩余弃牌机会提供 +30 筹码', price: 5, rarity: '普通', color: '#7da7b0', art: 'flag', effect: 'banner' },
  { id: 'mystic', name: '神秘山峰', desc: '剩余弃牌次数为 0 时 +15 倍率', price: 5, rarity: '普通', color: '#a493bd', art: 'mountain', effect: 'mystic' },
  { id: 'abstract', name: '抽象小丑', desc: '每张拥有的小丑牌提供 +3 倍率', price: 4, rarity: '普通', color: '#d79d70', art: 'abstract', effect: 'abstract' },
  { id: 'fibonacci', name: '斐波那契', desc: '计分的 A、2、3、5、8 每张 +8 倍率', price: 8, rarity: '罕见', color: '#8dada0', art: 'spiral', effect: 'fibonacci' },
  { id: 'even', name: '偶数史蒂文', desc: '计分的 2、4、6、8、10 每张 +4 倍率', price: 4, rarity: '普通', color: '#7a9ea3', art: 'number', effect: 'even' },
  { id: 'odd', name: '奇数托德', desc: '计分的 A、3、5、7、9 每张 +31 筹码', price: 4, rarity: '普通', color: '#d69a77', art: 'number', effect: 'odd' },
  { id: 'scary', face: true, name: '恐怖面孔', desc: '每张计分的人头牌 +30 筹码', price: 4, rarity: '普通', color: '#9692b2', art: 'jester', effect: 'scary' },
  { id: 'scholar', name: '学者', desc: '每张计分的 A 提供 +20 筹码、+4 倍率', price: 4, rarity: '普通', color: '#739890', art: 'star', effect: 'scholar' },
  { id: 'blackboard', name: '黑板', desc: '留在手里的牌全部为黑色时 ×3 倍率', price: 7, rarity: '罕见', color: '#708c88', art: 'blackboard', effect: 'blackboard' },
  { id: 'green', name: '绿色小丑', desc: '每次出牌永久 +1 倍率，每次弃牌 −1，最低为 0', price: 4, rarity: '普通', color: '#83a477', art: 'jester', effect: 'green' },
  { id: 'supernova', name: '超新星', desc: '本局该牌型的累计出牌次数加入倍率', price: 5, rarity: '普通', color: '#a485b6', art: 'star', effect: 'supernova' },
  { id: 'blue', name: '蓝色小丑', desc: '牌库每剩余一张牌 +2 筹码', price: 5, rarity: '普通', color: '#7e9fba', art: 'jester', effect: 'blue' },
  { id: 'sharp', name: '纸牌尖子', desc: '本盲注内再次打出相同牌型时 ×3 倍率', price: 8, rarity: '罕见', color: '#c79b72', art: 'diamond', effect: 'sharp' },
  { id: 'stencil', name: '小丑模具', desc: '倍率乘以空余小丑槽数量（含此牌，最低 ×1）', price: 8, rarity: '罕见', color: '#9196b2', art: 'stencil', effect: 'stencil' },
  { id: 'banana', name: '黄金香蕉', desc: '×3 倍率', price: 10, rarity: '稀有', color: '#c5ad5e', art: 'banana', effect: 'xmult', amount: 3 },
  { id: 'smiley', name: '笑脸人头', desc: '每张计分的人头牌 +5 倍率', price: 5, rarity: '普通', color: '#d9ae65', art: 'jester', effect: 'faceMult', face: true, modes: ['six-seat'] },
  { id: 'pareidolia', name: '幻视', desc: '所有扑克牌均视为人头牌（点数和牌型不变）', price: 6, rarity: '罕见', color: '#8facb6', art: 'stencil', effect: 'allFaces', face: true, modes: ['six-seat'] },
  { id: 'buskin', name: '喜剧与悲剧', desc: '每张计分的人头牌额外触发 1 次，重复点数、增强和逐牌小丑效果', price: 8, rarity: '罕见', color: '#b19cb8', art: 'half', effect: 'faceReplay', face: true, modes: ['six-seat'] },
  { id: 'photograph', name: '人头照片', desc: '首张计分的人头牌触发时 ×2 倍率，重复触发时再次生效', price: 7, rarity: '罕见', color: '#93ad96', art: 'blackboard', effect: 'facePhoto', face: true, modes: ['six-seat'] },
];
export const JOKERS = [...BASE_JOKERS, ...SIX_SEAT_JOKERS];
export const TAROTS = [
  { id: 'empress', name: '女皇', desc: '选中 1–2 张手牌，将其变为 +4 倍率牌', price: 3, art: 'crown', color: '#b88bad' },
  { id: 'hierophant', name: '教皇', desc: '选中 1–2 张手牌，将其变为 +30 筹码牌', price: 3, art: 'star', color: '#8ca9a2' },
  { id: 'strength', name: '力量', desc: '选中 1–2 张手牌，点数 +1（A 变为 2）', price: 3, art: 'sun', color: '#cead74' },
  { id: 'hermit', name: '隐者', desc: '使现有资金翻倍，最多获得 20 金币', price: 3, art: 'moon', color: '#929bb4' },
];
export const VOUCHERS = [
  { id: 'hand', name: '抓牌能手', desc: '每个盲注额外获得 1 次出牌', price: 10 },
  { id: 'discard', name: '挥霍大师', desc: '每个盲注额外获得 1 次弃牌', price: 10 },
  { id: 'size', name: '调色板', desc: '手牌上限永久 +1', price: 10 },
];
export const BOSSES = [
  { id: 'club', name: '梅花', desc: '所有梅花牌失效：不提供筹码和卡牌效果。', icon: '♣' },
  { id: 'hook', name: '钩子', desc: '每次出牌后，随机丢弃 2 张剩余手牌。', icon: '↝' },
  { id: 'water', name: '水', desc: '本盲注没有弃牌机会。', icon: '≈' },
  { id: 'plant', name: '植物', desc: '所有人头牌失效：不提供筹码和卡牌效果。', icon: '♧' },
  { id: 'psychic', name: '灵媒', desc: '每次必须正好打出 5 张牌。', icon: '◉' },
  { id: 'eye', name: '眼', desc: '同一牌型只能打出一次。', icon: '◎' },
  { id: 'mouth', name: '口', desc: '本盲注只能使用第一手打出的牌型。', icon: '◇' },
  { id: 'manacle', name: '镣铐', desc: '手牌上限减少 1。', icon: '∞' },
];
export const rankLabel = rank => ({ 11: 'J', 12: 'Q', 13: 'K', 14: 'A' }[rank] || String(rank));
export const cardChips = card => card.rank === 14 ? 11 : Math.min(10, card.rank);
export const format = value => Math.round(value).toLocaleString('en-US');
export function makeDeck() { return SUITS.flatMap(s => Array.from({ length: 13 }, (_, i) => ({ id: `${s.id}${i + 2}`, suit: s.id, rank: i + 2, enhancement: null }))); }
export function hashSeed(seed) { let value = 2166136261; for (const ch of seed) value = Math.imul(value ^ ch.charCodeAt(0), 16777619); return value >>> 0; }
export function random(state) {
  if (state.serverEntropy) { if (!state.serverEntropy.length) throw new Error('Randomness budget exhausted'); return state.serverEntropy.pop(); }
  state.rng = (state.rng + 0x6D2B79F5) >>> 0;
  let n = state.rng; n = Math.imul(n ^ n >>> 15, n | 1); n ^= n + Math.imul(n ^ n >>> 7, n | 61);
  return ((n ^ n >>> 14) >>> 0) / 4294967296;
}
export function shuffle(array, state) { const result = [...array]; for (let i = result.length - 1; i > 0; i--) { const j = Math.floor(random(state) * (i + 1)); [result[i], result[j]] = [result[j], result[i]]; } return result; }
export function evaluate(cards, modifiers = {}) {
  if (!cards.length) return null;
  if (cards.length > 5) throw new Error('最多选择五张牌');
  const sorted = [...cards].sort((a, b) => b.rank - a.rank);
  const groups = new Map();
  for (const card of sorted) { if (!groups.has(card.rank)) groups.set(card.rank, []); groups.get(card.rank).push(card); }
  const grouped = [...groups.values()].sort((a, b) => b.length - a.length || b[0].rank - a[0].rank);
  const ranks = [...groups.keys()];
  const subsets = n => {
    if (cards.length < n) return [];
    if (cards.length === n) return [sorted];
    return sorted.map((_, i) => sorted.filter((_, j) => i !== j));
  };
  const candidates = (modifiers.four ? [5, 4] : [5]).flatMap(subsets);
  const suitKey = c => modifiers.smeared ? (['H','D'].includes(c.suit) ? 'red' : 'black') : c.suit;
  const isFlush = values => values.every(c => suitKey(c) === suitKey(values[0]));
  const isStraight = values => {
    const numbers = [...new Set(values.map(c => c.rank))].sort((a,b) => b-a);
    if (numbers.length !== values.length) return false;
    const sequence = ranks => ranks.slice(1).every((n,i) => ranks[i] - n >= 1 && ranks[i] - n <= (modifiers.shortcut ? 2 : 1));
    return sequence(numbers) || numbers.includes(14) && sequence(numbers.map(n => n === 14 ? 1 : n).sort((a,b) => b-a));
  };
  const straightFlushCards = candidates.find(c => isFlush(c) && isStraight(c));
  const flushCards = candidates.find(isFlush), straightCards = candidates.find(isStraight);
  const flush = !!flushCards, straight = !!straightCards;
  let id = 'high'; let scoring = [sorted[0]];
  if (straightFlushCards) { id = 'straightFlush'; scoring = straightFlushCards; }
  else if (grouped[0].length === 4) { id = 'four'; scoring = grouped[0]; }
  else if (grouped[0].length === 3 && grouped[1]?.length === 2) { id = 'fullHouse'; scoring = sorted; }
  else if (flush) { id = 'flush'; scoring = flushCards; }
  else if (straight) { id = 'straight'; scoring = straightCards; }
  else if (grouped[0].length === 3) { id = 'three'; scoring = grouped[0]; }
  else if (grouped[0].length === 2 && grouped[1]?.length === 2) { id = 'twoPair'; scoring = [...grouped[0], ...grouped[1]]; }
  else if (grouped[0].length === 2) { id = 'pair'; scoring = grouped[0]; }
  return { id, scoring, containsStraight: straight, containsPair: grouped[0].length >= 2, containsThree: grouped[0].length >= 3, name: id === 'straightFlush' && ranks[0] === 14 && ranks[4] === 10 ? '皇家同花顺' : HANDS[id].name };
}
export function evaluateHand(state, cards) { return evaluate(cards, sixSeatMode(state) ? handModifiers(state) : {}); }
export function jokerSlots(state) { return sixSeatMode(state) ? 6 : 5; }
export function handLevel(state, id) { return jokersOnly(state) ? 1 : state.levels[id] || 1; }
export function handBase(state, id) { const h = HANDS[id]; const level = handLevel(state,id); return { chips: h.chips + (level - 1) * h.chipStep, mult: h.mult + (level - 1) * h.multStep }; }
export function bossPool(state) {
  // A face-card-focused mode must not disable its entire deck through Pareidolia.
  return sixSeatMode(state) ? ['club','hook','water','eye','psychic','mouth','manacle'].map(id=>BOSSES.find(boss=>boss.id===id)) : BOSSES;
}
export function bossFor(state) { const pool=bossPool(state); return state.blindIndex === 2 ? pool[(state.ante - 1) % pool.length] : null; }
export function isFace(state, card) { return card.rank >= 11 && card.rank <= 13 || (sixSeatMode(state) ? hasEffect(state, 'allFaces') : state.jokers.some(j => j.id === 'pareidolia')); }
export function jokerPool(state) { if (sixSeatMode(state)) return SIX_SEAT_JOKERS; return BASE_JOKERS.filter(j => !j.modes || j.modes.includes(modeFor(state).id)); }
export function isDebuffed(state, card) { const boss = bossFor(state); return boss?.id === 'club' && (sixSeatMode(state) ? matchesSuit(state,card,'C') : card.suit === 'C') || boss?.id === 'plant' && isFace(state, card); }
export function scoreHand(state, cards) {
  const hand = evaluateHand(state, cards); if (!hand) return null;
  if (sixSeatMode(state)) return scoreSixSeatHand(state, cards, hand);
  let { chips, mult } = handBase(state, hand.id);
  let source = { kind: 'base' };
  const events = [{ label: `${hand.name} · Lv.${handLevel(state,hand.id)}`, text: `${chips} × ${mult}`, chips, mult, ...source }];
  const scoring = hand.scoring.filter(c => !isDebuffed(state, c));
  const record = (label, text) => events.push({ label, text, chips, mult, ...source });
  const addChips = (n, name) => { if (n) { chips += n; record(name, `+${n} 筹码`); } };
  const addMult = (n, name) => { if (n) { mult += n; record(name, `+${n} 倍率`); } };
  const multiply = (n, name) => { mult *= n; record(name, `×${n} 倍率`); };
  const firstFace = scoring.find(card => isFace(state, card))?.id;
  for (const card of scoring) {
    const triggers = 1 + (isFace(state, card) ? state.jokers.filter(j => j.id === 'buskin').length : 0);
    for (let trigger = 0; trigger < triggers; trigger++) {
    source = { kind: 'card', cardId: card.id, retrigger: trigger > 0 };
    addChips(cardChips(card) + (card.enhancement === 'bonus' ? 30 : 0), `${rankLabel(card.rank)}${SUITS.find(s => s.id === card.suit).symbol}`);
    if (card.enhancement === 'mult') addMult(4, '倍率牌');
    // Card-triggered effects resolve before the main joker row.
    for (const [jokerIndex, owned] of state.jokers.entries()) {
      source = { kind: 'joker', cardId: card.id, jokerIndex, retrigger: trigger > 0 };
      const j = JOKERS.find(j => j.id === owned.id);
      if (j.effect === 'suit' && card.suit === j.suit) addMult(3, j.name);
      if (j.effect === 'fibonacci' && [14, 2, 3, 5, 8].includes(card.rank)) addMult(8, j.name);
      if (j.effect === 'even' && [2, 4, 6, 8, 10].includes(card.rank)) addMult(4, j.name);
      if (j.effect === 'odd' && [14, 3, 5, 7, 9].includes(card.rank)) addChips(31, j.name);
      if (j.effect === 'scary' && isFace(state, card)) addChips(30, j.name);
      if (j.effect === 'faceMult' && isFace(state, card)) addMult(5, j.name);
      if (j.effect === 'facePhoto' && card.id === firstFace) multiply(2, j.name);
      if (j.effect === 'scholar' && card.rank === 14) { addChips(20, j.name); addMult(4, j.name); }
    }
  }
  }
  for (const [jokerIndex, owned] of state.jokers.entries()) {
    source = { kind: 'joker', jokerIndex };
    const j = JOKERS.find(j => j.id === owned.id);
    if (j.effect === 'mult') addMult(j.amount, j.name);
    if (j.effect === 'pair' && hand.containsPair) addMult(j.amount, j.name);
    if (j.effect === 'three' && hand.containsThree) addMult(j.amount, j.name);
    if (j.effect === 'straight' && ['straight', 'straightFlush'].includes(hand.id)) addMult(j.amount, j.name);
    if (j.effect === 'flush' && ['flush', 'straightFlush'].includes(hand.id)) addMult(j.amount, j.name);
    if (j.effect === 'pairChips' && hand.containsPair) addChips(j.amount, j.name);
    if (j.effect === 'half' && cards.length <= 3) addMult(20, j.name);
    if (j.effect === 'banner') addChips(state.discards * 30, j.name);
    if (j.effect === 'mystic' && state.discards === 0) addMult(15, j.name);
    if (j.effect === 'abstract') addMult(state.jokers.length * 3, j.name);
    if (j.effect === 'blackboard') { const held = state.hand.filter(id => !cards.some(c => c.id === id)).map(id => state.deck.find(c => c.id === id)); if (held.length && held.every(c => ['S', 'C'].includes(c.suit))) multiply(3, j.name); }
    if (j.effect === 'green') addMult((owned.value || 0) + 1, j.name);
    if (j.effect === 'supernova') addMult((state.played[hand.id] || 0) + 1, j.name);
    if (j.effect === 'blue') addChips(state.drawPile.length * 2, j.name);
    if (j.effect === 'sharp' && state.roundPlayed.includes(hand.id)) multiply(3, j.name);
    if (j.effect === 'stencil') multiply(Math.max(1, 5 - state.jokers.length + state.jokers.filter(x => x.id === 'stencil').length), j.name);
    if (j.effect === 'xmult') multiply(j.amount, j.name);
  }
  return { ...hand, chips, mult, total: Math.floor(chips * mult), events, scoringIds: hand.scoring.map(c => c.id) };
}
function scoreSixSeatHand(state, cards, hand) {
  let { chips, mult } = handBase(state, hand.id), source = { kind: 'base' };
  const events = [{ label: `${hand.name} · Lv.${handLevel(state,hand.id)}`, text: `${chips} × ${mult}`, chips, mult, ...source }];
  const effectives = effectiveJokers(state), photographed = new Set();
  const scoring = (hasEffect(state,'splash') ? [...cards].sort((a,b) => b.rank-a.rank) : hand.scoring);
  const valid = scoring.filter(c => !isDebuffed(state, c));
  const record = (label,text) => events.push({label,text,chips,mult,...source});
  const add = (type,n,name) => { if (!n) return; if (type === 'chips') chips += n; else mult += n; record(name, `+${n} ${type === 'chips' ? '筹码' : '倍率'}`); };
  const multiply = (n,name) => { mult *= n; record(name,`×${n} 倍率`); };
  for (const card of valid) {
    const face = isFace(state,card);
    const repeats = effectives.filter(j => j.info.effect === 'faceReplay' && face || j.info.effect === 'hack' && [2,3,4,5].includes(card.rank)).length;
    for (let trigger = 0; trigger <= repeats; trigger++) {
      source = {kind:'card',cardId:card.id,retrigger:trigger>0};
      add('chips',cardChips(card)+(!jokersOnly(state) && card.enhancement === 'bonus' ? 30 : 0),`${rankLabel(card.rank)}${SUITS.find(s=>s.id===card.suit).symbol}`);
      if (!jokersOnly(state) && card.enhancement === 'mult') add('mult',4,'倍率牌');
      for (const {info:j,owned,index} of effectives) {
        source = {kind:'joker',cardId:card.id,jokerIndex:index,retrigger:trigger>0};
        if (j.effect === 'suit' && matchesSuit(state,card,j.suit)) add('mult',4,j.name);
        if (j.effect === 'fibonacci' && [14,2,3,5,8].includes(card.rank)) add('mult',8,j.name);
        if (j.effect === 'even' && [2,4,6,8,10].includes(card.rank)) add('mult',4,j.name);
        if (j.effect === 'scary' && face) add('chips',30,j.name);
        if (j.effect === 'faceMult' && face) add('mult',5,j.name);
        if (j.effect === 'ancient' && matchesSuit(state,card,owned.suit)) multiply(1.5,j.name);
        if (j.effect === 'photo' && face && !photographed.has(index)) { multiply(2,j.name); photographed.add(index); }
      }
    }
  }
  for (const {info:j,owned,index} of effectives) {
    source = {kind:'joker',jokerIndex:index};
    if (j.effect === 'mult') add('mult',4,j.name);
    if (j.effect === 'banner') add('chips',state.discards*30,j.name);
    if (j.effect === 'blue') add('chips',state.drawPile.length*2,j.name);
    if (j.effect === 'abstract') add('mult',state.jokers.length*3,j.name);
    if (j.effect === 'half' && cards.length<3) add('mult',20,j.name);
    if (j.effect === 'green') add('mult',(owned.value||0)+3,j.name);
    if (j.effect === 'square') add('chips',(owned.value||0)+(cards.length===4 ? 12 : 0),j.name);
    if (j.effect === 'castle') add('chips',owned.value||0,j.name);
    if (j.effect === 'supernova') add('mult',((state.stagePlayed?.[hand.id]||0)+1)*3,j.name);
    if (j.effect === 'misprint') add('mult',owned.roll||0,j.name);
    if (j.effect === 'sharp' && state.roundPlayed.includes(hand.id)) multiply(3,j.name);
    if (j.effect === 'order' && hand.containsStraight) multiply(3,j.name);
    if (j.effect === 'flower' && valid.length>=4 && SUITS.every(s=>valid.some(c=>matchesSuit(state,c,s.id)))) { add('chips',50,j.name); multiply(3,j.name); }
    if (j.effect === 'double' && valid.some((a,i)=>matchesSuit(state,a,'C') && valid.some((b,k)=>k!==i && SUITS.some(s=>s.id!=='C' && matchesSuit(state,b,s.id))))) multiply(2,j.name);
  }
  return {...hand,chips,mult,total:Math.floor(chips*mult),events,scoringIds:scoring.map(c=>c.id)};
}
function rollSixSeat(state, newBlind = false) {
  if (!sixSeatMode(state)) return;
  for (const owned of state.jokers) {
    const info = SIX_SEAT_JOKERS.find(j=>j.id===owned.id);
    if (info?.effect === 'misprint') owned.roll = Math.floor(random(state)*23);
    if (newBlind && ['castle','ancient'].includes(info?.effect)) owned.suit = SUITS[Math.floor(random(state)*4)].id;
  }
}
function ownJoker(state, id) {
  const owned = {id,value:0};
  if (id==='ss-misprint') owned.roll = Math.floor(random(state)*23);
  if (['ss-castle','ss-ancient'].includes(id)) owned.suit = SUITS[Math.floor(random(state)*4)].id;
  return owned;
}
export function targetFor(state, index = state.blindIndex) { const bases = modeRulesFor(state).targets; const base = bases[state.ante - 1] || Math.round(bases.at(-1) * 2 ** (state.ante - bases.length)); return Math.round(base * [1, 1.5, 2][index] * rulesFor(state).targetScale * (state.difficultyRules?.targetGrowth || 1) ** (state.ante - 1)); }
export function newRun(seed = Math.random().toString(36).slice(2, 10).toUpperCase(), rules, difficulty = 'medium', mode = 'classic') {
  validateDifficulty(difficulty); validateMode(mode);
  const setup = difficultySetup(rules, difficulty), config = setup.rules, modeConfig = modeSetup(mode);
  if (mode === 'quick') { config.startingMoney = Math.min(100, config.startingMoney + 4); config.priceScale *= .8; }
  const starters = [...new Set([...(setup.starter ? [setup.starter] : []), ...modeFor(mode).starters])];
  return { version: 1, mode, modeRules: modeConfig, difficulty, difficultyRules: { targetGrowth: modeConfig.difficultyGrowth?.[difficulty] || setup.targetGrowth }, rules: config, seed, rng: hashSeed(seed), phase: 'blind', ante: 1, blindIndex: 0, round: 1, money: config.startingMoney, score: 0, hands: config.hands, discards: config.discards, deck: makeDeck(), hand: [], drawPile: [], selected: [], jokers: starters.map(id => ({ id: mode === 'six-seat' ? 'ss-' + id : id })), consumables: [], vouchers: [], levels: Object.fromEntries(Object.keys(HANDS).map(k => [k, 1])), played: {}, roundPlayed: [], stagePlayed: {}, totalHands: 0, totalDiscards: 0, bestHand: 0, totalScore: 0, lastPlay: null, shop: null, endless: false, sort: 'rank', cleared: 0 };
}
export function handSize(state) { return Math.max(1, rulesFor(state).handSize + (!jokersOnly(state) && state.vouchers.includes('size') ? 1 : 0) - (bossFor(state)?.id === 'manacle' ? 1 : 0) - (sixSeatMode(state) ? effectiveJokers(state).filter(j=>j.info.effect==='andy').length : 0)); }
export function refill(state) { while (state.hand.length < handSize(state) && state.drawPile.length) state.hand.push(state.drawPile.pop()); }
export function startBlind(state) {
  if (state.phase !== 'blind') return false;
  state.phase = 'playing'; state.score = 0; prepareBlindStats(state); rollSixSeat(state,true);
  state.drawPile = shuffle(state.deck.map(c => c.id), state); state.hand = []; state.selected = []; state.roundPlayed = []; state.lastPlay = null; refill(state); return true;
}
export function playError(state, cards) {
  if (state.phase !== 'playing') return '请先选择盲注';
  if (!cards.length || cards.length > 5) return '请选择 1–5 张牌';
  const hand = evaluateHand(state, cards); const boss = bossFor(state);
  if (boss?.id === 'psychic' && cards.length !== 5) return '灵媒：必须正好打出 5 张牌';
  if (boss?.id === 'eye' && state.roundPlayed.includes(hand.id)) return '眼：这个牌型已经用过了';
  if (boss?.id === 'mouth' && state.roundPlayed.length && state.roundPlayed[0] !== hand.id) return `口：只能打出${HANDS[state.roundPlayed[0]].name}`;
  return null;
}
export function playHand(state) {
  const cards = state.selected.map(id => state.deck.find(c => c.id === id)).filter(c => c && state.hand.includes(c.id));
  const error = playError(state, cards); if (error) return { error };
  const result = scoreHand(state, cards);
  state.lastPlay = { cards: cards.map(c => ({ ...c })), ...result, scoring: undefined };
  state.hands--; state.totalHands++; state.score += result.total; state.totalScore += result.total; state.bestHand = Math.max(state.bestHand, result.total);
  state.played[result.id] = (state.played[result.id] || 0) + 1; state.roundPlayed.push(result.id);
  if (sixSeatMode(state)) {
    state.stagePlayed ||= {}; state.stagePlayed[result.id] = (state.stagePlayed[result.id]||0)+1;
    for (const j of state.jokers) { if (j.id==='ss-green') j.value=(j.value||0)+3; if (j.id==='ss-square' && cards.length===4) j.value=(j.value||0)+12; }
    rollSixSeat(state);
  }
  for (const j of state.jokers) if (j.id === 'green') j.value = (j.value || 0) + 1;
  state.hand = state.hand.filter(id => !state.selected.includes(id)); state.selected = [];
  if (state.score >= targetFor(state)) { state.phase = 'roundWon'; state.cleared++; }
  else if (state.hands <= 0) state.phase = 'lost';
  else {
    if (bossFor(state)?.id === 'hook') for (let i = 0; i < 2 && state.hand.length; i++) state.hand.splice(Math.floor(random(state) * state.hand.length), 1);
    refill(state); if (!state.hand.length) state.phase = 'lost';
  }
  return result;
}
export function discard(state) {
  if (state.phase !== 'playing' || !state.discards || !state.selected.length) return false;
  if (sixSeatMode(state)) for (const j of state.jokers) {
    if (j.id==='ss-green') j.value=Math.max(0,(j.value||0)-3);
    if (j.id==='ss-castle') j.value=(j.value||0)+8*state.selected.map(id=>state.deck.find(c=>c.id===id)).filter(c=>matchesSuit(state,c,j.suit)).length;
  }
  state.hand = state.hand.filter(id => !state.selected.includes(id)); state.selected = []; state.discards--; state.totalDiscards++;
  for (const j of state.jokers) if (j.id === 'green') j.value = Math.max(0, (j.value || 0) - 1);
  refill(state); if (!state.hand.length) state.phase = 'lost'; return true;
}
export function payout(state) { const blind = [3, 4, 5][state.blindIndex]; const interest = Math.min(rulesFor(state).interestCap, Math.floor(state.money / 5)); return { blind, hands: state.hands, interest, total: blind + state.hands + interest }; }
const pick = (items, state) => items[Math.floor(random(state) * items.length)];
export function shopItem(type, state) {
  if (jokersOnly(state)) type = 'joker';
  if (type === 'joker') {
    const r = rulesFor(state); const weights = { '普通': r.commonWeight, '罕见': r.uncommonWeight, '稀有': r.rareWeight };
    let choices = jokerPool(state).filter(j => !state.jokers.some(x => x.id === j.id));
    // A restricted rarity pool may already be owned; it must never fall back to an effect card.
    if (jokersOnly(state) && !choices.some(j => weights[j.rarity] > 0)) choices = jokerPool(state).filter(j => weights[j.rarity] > 0);
    if (!choices.length) return { type: 'planet', id: pick(Object.keys(HANDS), state) };
    if (modeRulesFor(state).faceChance > 0 && choices.some(j => j.face && weights[j.rarity] > 0) && random(state) < modeRulesFor(state).faceChance) choices = choices.filter(j => j.face && weights[j.rarity] > 0);
    const rarities = [...new Set(choices.map(j => j.rarity))]; const sum = rarities.reduce((n, rarity) => n + weights[rarity], 0);
    if (!sum) return { type: 'planet', id: pick(Object.keys(HANDS), state) };
    let roll = random(state) * sum; let rarity = rarities.at(-1); for (const value of rarities) { roll -= weights[value]; if (roll < 0) { rarity = value; break; } }
    return { type, id: pick(choices.filter(j => j.rarity === rarity), state).id };
  }
  if (type === 'planet') return { type, id: pick(Object.keys(HANDS), state) };
  return { type: 'tarot', id: pick(TAROTS, state).id };
}
export function createShop(state) {
  if (jokersOnly(state)) {
    const items = [];
    for (let slot=0;slot<3;slot++) {
      let item=shopItem('joker',state);
      for (let retry=0;retry<30 && items.some(other=>other.id===item.id);retry++) item=shopItem('joker',state);
      items.push(item);
    }
    state.shop={items,rerollCost:rulesFor(state).rerollPrice,voucher:null,booster:true,pack:null};
    return;
  }
  const first = shopItem('joker', state); let second = shopItem('joker', state);
  for (let i = 0; i < 20 && second.id === first.id; i++) second = shopItem('joker', state);
  const available = VOUCHERS.filter(v => !state.vouchers.includes(v.id));
  state.shop = { items: [first, second, shopItem(random(state) < rulesFor(state).planetChance ? 'planet' : 'tarot', state)], rerollCost: rulesFor(state).rerollPrice, voucher: available.length ? pick(available, state).id : null, booster: true, pack: null };
}
export function cashOut(state) {
  if (state.phase !== 'roundWon') return false;
  state.money += payout(state).total;
  if (state.ante === modeRulesFor(state).antes && state.blindIndex === 2 && !state.endless) state.phase = 'victory';
  else { state.phase = 'shop'; createShop(state); }
  return true;
}
function prepareBlindStats(state) { state.hands = rulesFor(state).hands + (!jokersOnly(state) && state.vouchers.includes('hand') ? 1 : 0); state.discards = bossFor(state)?.id === 'water' ? 0 : rulesFor(state).discards + (!jokersOnly(state) && state.vouchers.includes('discard') ? 1 : 0) + (sixSeatMode(state) ? effectiveJokers(state).filter(j=>j.info.effect==='andy').length*3 : 0); }
export function nextBlind(state) { if (!['shop', 'victory'].includes(state.phase) || state.shop?.pack) return false; state.blindIndex++; if (state.blindIndex > 2) { state.blindIndex = 0; state.ante++; state.stagePlayed = {}; } state.round++; state.phase = 'blind'; state.selected = []; state.hand = []; state.shop = null; state.lastPlay = null; state.score = 0; prepareBlindStats(state); return true; }
export function skipBlind(state) { if (state.phase !== 'blind' || state.blindIndex === 2) return false; state.money += rulesFor(state).skipReward; state.blindIndex++; state.round++; prepareBlindStats(state); return true; }
export function itemInfo(item, state) {
  let info;
  if (item.type === 'joker') info = JOKERS.find(j => j.id === item.id);
  else if (item.type === 'tarot') info = TAROTS.find(t => t.id === item.id);
  else { const h = HANDS[item.id]; info = { name: h.planet, desc: `${h.name}等级 +1：+${h.chipStep} 筹码，+${h.multStep} 倍率`, price: 3, color: '#83a69c', art: 'planet' }; }
  return { ...info, price: Math.max(1, Math.round(info.price * rulesFor(state || {}).priceScale)) };
}
export function buyItem(state, index) {
  if (state.phase !== 'shop' || state.shop.pack) return '请先完成当前操作';
  const item = state.shop.items[index]; if (!item || item.sold) return '商品已售出';
  if (jokersOnly(state) && item.type !== 'joker') return '六席玩法仅支持小丑牌';
  const info = itemInfo(item, state);
  if (state.money < info.price) return '资金不足';
  if (item.type === 'joker' && state.jokers.length >= jokerSlots(state)) return '小丑牌已满，请先出售一张';
  if (item.type === 'tarot' && state.consumables.length >= 2) return '消耗牌已满，最多持有 2 张';
  state.money -= info.price; item.sold = true;
  if (item.type === 'joker') state.jokers.push(ownJoker(state,item.id));
  if (item.type === 'planet') state.levels[item.id]++;
  if (item.type === 'tarot') state.consumables.push(item.id);
  return null;
}
export function reroll(state) { if (state.phase !== 'shop' || state.shop.pack || state.money < state.shop.rerollCost) return false; state.money -= state.shop.rerollCost; const cost = state.shop.rerollCost + 1; const voucher = jokersOnly(state) ? null : state.shop.voucher; const booster = state.shop.booster; createShop(state); Object.assign(state.shop, { rerollCost: cost, voucher, booster }); return true; }
export function buyVoucher(state) { if (jokersOnly(state) || state.phase !== 'shop' || state.shop.pack || !state.shop.voucher || state.money < 10) return false; state.money -= 10; state.vouchers.push(state.shop.voucher); state.shop.voucher = null; return true; }
export function buyBooster(state) { const price = rulesFor(state).boosterPrice; if (state.phase !== 'shop' || state.shop.pack || !state.shop.booster || state.money < price) return false; state.money -= price; state.shop.booster = false; state.shop.pack = shuffle(jokerPool(state).filter(j => !state.jokers.some(x => x.id === j.id)), state).slice(0, 3).map(j => j.id); return true; }
export function chooseBooster(state, index) { if (state.phase !== 'shop' || !state.shop.pack || !state.shop.pack[index] || state.jokers.length >= jokerSlots(state)) return false; state.jokers.push(ownJoker(state,state.shop.pack[index])); state.shop.pack = null; return true; }
export function jokerSellPrice(state, id) { return Math.max(1, Math.floor(itemInfo({ type: 'joker', id }, state).price / 2)); }
export function sellJoker(state, index) { if (!['playing', 'blind', 'shop'].includes(state.phase) || !state.jokers[index]) return false; state.money += jokerSellPrice(state, state.jokers[index].id); state.jokers.splice(index, 1); return true; }
export function tarotError(state, index) {
  if (jokersOnly(state)) return '六席玩法仅支持小丑牌';
  const id = state.consumables[index]; if (!id || !['playing', 'shop', 'blind'].includes(state.phase)) return '现在无法使用';
  if (id !== 'hermit' && (state.phase !== 'playing' || !state.selected.length || state.selected.length > 2 || state.selected.some(id => !state.hand.includes(id)))) return '在出牌时先选中 1–2 张手牌';
  return null;
}
export function useTarot(state, index) {
  const error = tarotError(state, index); if (error) return error;
  const id = state.consumables[index];
  state.appliedEffects ||= {};
  const record = state.appliedEffects[id] ||= { count: 0, money: 0, cardIds: [] };
  record.count++;
  if (id === 'hermit') { const gained = Math.min(20, state.money); state.money += gained; record.money += gained; }
  else {
    record.cardIds = [...new Set([...record.cardIds, ...state.selected])];
    for (const cid of state.selected) { const card = state.deck.find(c => c.id === cid); if (id === 'strength') card.rank = card.rank === 14 ? 2 : card.rank + 1; else card.enhancement = id === 'empress' ? 'mult' : 'bonus'; }
  }
  state.consumables.splice(index, 1); return null;
}
