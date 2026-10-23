// Document card set. Artwork and descriptions are independently authored for this web game.
// Values not specified by the reference use the web game's documented defaults.
const common = '普通', uncommon = '罕见', rare = '稀有';
const card = (key, name, englishName, desc, englishDesc, price, rarity, effect, extra = {}) => ({ id: 'ss-' + key, name, englishName, desc, englishDesc, price, rarity, effect, color: { 普通: '#83a8ad', 罕见: '#a5ad78', 稀有: '#c68f83' }[rarity], art: 'jester', modes: ['six-seat-v1'], ...extra });
export const SIX_SEAT_JOKERS = [
  card('abstract','抽象小丑','Abstract Joker','每张拥有的小丑牌 +3 倍率','+3 Mult per owned joker',4,common,'abstract',{art:'abstract'}),
  card('ancient','古老小丑','Ancient Joker','每张计分的指定花色牌 ×1.5 倍率；每轮更换花色','Each scoring card of the chosen suit gives ×1.5 Mult; suit changes each blind',8,rare,'ancient',{art:'planet'}),
  card('banner','旗帜','Banner','每次剩余弃牌机会 +30 筹码','+30 Chips per remaining discard',5,common,'banner',{art:'flag'}),
  card('blue','蓝色小丑','Blue Joker','牌库每剩一张牌 +2 筹码','+2 Chips per card remaining in the draw pile',5,common,'blue'),
  card('blueprint','蓝图','Blueprint','复制右侧小丑的能力；不能复制另一张蓝图','Copies the joker immediately to its right; cannot copy another Blueprint',10,rare,'blueprint',{art:'blackboard'}),
  card('sharp','老千小丑','Card Sharp','本轮再次打出已使用的牌型时 ×3 倍率','×3 Mult when this hand type was already played this blind',6,uncommon,'sharp',{art:'diamond'}),
  card('castle','城堡','Castle','每弃掉一张指定花色牌，永久 +8 筹码；每轮更换花色','Permanently gains +8 Chips per discarded card of the chosen suit; suit changes each blind',6,uncommon,'castle',{art:'crown'}),
  card('even','偶数史蒂文','Even Steven','计分的 2、4、6、8、10 每张 +4 倍率','Each scoring 2, 4, 6, 8 or 10 gives +4 Mult',4,common,'even',{art:'number'}),
  card('fibonacci','斐波那契','Fibonacci','计分的 A、2、3、5、8 每张 +8 倍率','Each scoring A, 2, 3, 5 or 8 gives +8 Mult',7,uncommon,'fibonacci',{art:'spiral'}),
  card('flower','花盆','Flower Pot','至少 4 张计分牌涵盖四种花色时，+50 筹码并 ×3 倍率','+50 Chips and ×3 Mult if at least 4 scoring cards cover all four suits',6,uncommon,'flower',{art:'sun'}),
  card('fingers','四指','Four Fingers','顺子、同花及同花顺可由 4 张牌组成','Straights, Flushes and Straight Flushes may use 4 cards',7,common,'fingers',{art:'fingers'}),
  card('glutton','饕餮小丑','Gluttonous Joker','每张计分的梅花牌 +4 倍率','Each scoring Club gives +4 Mult',5,common,'suit',{suit:'C',art:'club'}),
  card('greedy','贪婪小丑','Greedy Joker','每张计分的方片牌 +4 倍率','Each scoring Diamond gives +4 Mult',5,common,'suit',{suit:'D',art:'diamond'}),
  card('green','绿色小丑','Green Joker','每次出牌永久 +3 倍率，每次弃牌 −3，最低为 0','Gains +3 Mult per played hand; −3 per discard, minimum 0',4,common,'green'),
  card('hack','喜剧演员','Hack','每张计分的 2、3、4、5 额外触发 1 次','Retrigger each scoring 2, 3, 4 or 5 once',6,uncommon,'hack',{art:'half'}),
  card('half','半张小丑','Half Joker','出牌少于 3 张时 +20 倍率','+20 Mult when playing fewer than 3 cards',5,common,'half',{art:'half'}),
  card('joker','小丑','Joker','+4 倍率','+4 Mult',2,common,'mult'),
  card('lusty','爱心小丑','Lusty Joker','每张计分的红桃牌 +4 倍率','Each scoring Heart gives +4 Mult',5,common,'suit',{suit:'H',art:'heart'}),
  card('andy','快乐安迪','Merry Andy','每轮额外 3 次弃牌，手牌上限 −1','+3 discards per blind and −1 hand size',7,uncommon,'andy',{art:'jester'}),
  card('misprint','印错小丑','Misprint','每手随机 +0–22 倍率；选牌预览与结算使用同一个值','Random +0–22 Mult per hand; preview and scoring share the same roll',4,common,'misprint',{art:'number'}),
  card('pareidolia','幻视','Pareidolia','所有扑克牌视为人头牌，点数与牌型不变','All playing cards count as face cards; ranks and hand types stay unchanged',5,uncommon,'allFaces',{art:'stencil'}),
  card('photograph','照片','Photograph','首张计分的人头牌 ×2 倍率；每手最多触发一次','×2 Mult on the first scoring face card, once per hand',5,common,'photo',{art:'blackboard'}),
  card('scary','恐怖面孔','Scary Face','每张计分的人头牌 +30 筹码','Each scoring face card gives +30 Chips',4,common,'scary'),
  card('double','重影','Seeing Double','计分牌包含梅花和另一花色时 ×2 倍率','×2 Mult with a scoring Club and another scoring card of a different suit',6,uncommon,'double',{art:'abstract'}),
  card('shortcut','捷径','Shortcut','顺子中相邻点数最多可间隔 1 个数字','Straights may skip one rank between adjacent cards',7,uncommon,'shortcut',{art:'mountain'}),
  card('smeared','模糊小丑','Smeared Joker','红桃与方片视为同一花色；黑桃与梅花视为同一花色','Hearts and Diamonds share a suit; Spades and Clubs share a suit',7,uncommon,'smeared',{art:'abstract'}),
  card('smiley','微笑表情','Smiley Face','每张计分的人头牌 +5 倍率','Each scoring face card gives +5 Mult',4,common,'faceMult'),
  card('buskin','喜与悲','Sock and Buskin','每张计分的人头牌额外触发 1 次','Retrigger each scoring face card once',6,uncommon,'faceReplay',{art:'half'}),
  card('splash','飞溅','Splash','所有打出的牌均参与计分，基础分仍按牌型计算','Every played card scores; the poker hand still determines base Chips and Mult',3,common,'splash',{art:'sun'}),
  card('square','方形小丑','Square Joker','每次正好打出 4 张牌时，永久 +12 筹码','Permanently gains +12 Chips whenever exactly 4 cards are played',4,common,'square',{art:'number'}),
  card('supernova','超新星','Supernova','本底注该牌型的累计出牌次数 ×3 加入倍率（含当前手）','Adds 3 times this ante’s plays of this hand type to Mult, including this play',5,uncommon,'supernova',{art:'star'}),
  card('order','秩序','The Order','打出的牌包含顺子时 ×3 倍率','×3 Mult if the played hand contains a Straight',8,rare,'order',{art:'diamond'}),
  card('wrathful','愤怒小丑','Wrathful Joker','每张计分的黑桃牌 +4 倍率','Each scoring Spade gives +4 Mult',5,common,'suit',{suit:'S',art:'spade'}),
];
const byId = new Map(SIX_SEAT_JOKERS.map(j => [j.id,j]));
export const sixSeatMode = state => state?.mode === 'six-seat' && state.modeRules?.jokerSet === 'six-seat-v1';
export function effectiveJokers(state) {
  return state.jokers.flatMap((owned, index) => {
    let info = byId.get(owned.id), target = owned;
    if (!info) return [];
    if (info.effect === 'blueprint') {
      target = state.jokers[index + 1]; const copied = byId.get(target?.id);
      if (!copied || copied.effect === 'blueprint') return [];
      info = { ...copied, name: `${info.name} → ${copied.name}` };
    }
    return [{ info, owned: target, index }];
  });
}
export const hasEffect = (state, effect) => effectiveJokers(state).some(j => j.info.effect === effect);
export const matchesSuit = (state, card, suit) => card.suit === suit || hasEffect(state,'smeared') && (['H','D'].includes(card.suit) && ['H','D'].includes(suit) || ['S','C'].includes(card.suit) && ['S','C'].includes(suit));
export function handModifiers(state) {
  return { four: hasEffect(state,'fingers'), shortcut: hasEffect(state,'shortcut'), smeared: hasEffect(state,'smeared') };
}
