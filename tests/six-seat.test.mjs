import test from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../engine.js';
import { SIX_SEAT_JOKERS } from '../six-seat.js';
const run = () => E.newRun('DOCUMENT',undefined,'medium','six-seat');
const cards = text => text.split(' ').map((part,i)=>({id:'card'+i,rank:Number(part.slice(0,-1)),suit:part.slice(-1)}));
const own = (state,...ids) => state.jokers=ids.map(id=>({id:'ss-'+id,value:0}));
function putHand(state,text) { const hand=cards(text); state.deck=[...hand,...E.makeDeck()]; state.hand=hand.map(c=>c.id); state.selected=[...state.hand]; return hand; }

test('document mode has exactly the 33 reference jokers and six slots, with no classic-only cards',()=>{
 const s=run();
 const expected='abstract ancient banner blue blueprint sharp castle even fibonacci flower fingers glutton greedy green hack half joker lusty andy misprint pareidolia photograph scary double shortcut smeared smiley buskin splash square supernova order wrathful'.split(' ').map(id=>'ss-'+id).sort();
 assert.deepEqual(E.jokerPool(s).map(j=>j.id).sort(),expected); assert.equal(new Set(expected).size,33);
 assert.equal(E.jokerSlots(s),6); assert.equal(E.jokerSlots(E.newRun()),5); assert.equal(s.modeRules.faceChance,0);
 assert.deepEqual(s.jokers,[]);
 const found=new Set(); for(let i=0;i<2500;i++) { const item=E.shopItem('joker',s); assert.ok(expected.includes(item.id)); found.add(item.id); } assert.equal(found.size,33);
 for(const j of SIX_SEAT_JOKERS) assert.ok(Number.isInteger(j.price)&&j.price>0&&j.englishDesc);
});

test('Six-seat replaces Plant with Eye so Pareidolia cannot disable the entire deck, including existing saves',()=>{
 const s=run();own(s,'pareidolia','blueprint','scary');s.ante=4;s.blindIndex=2;
 assert.equal(E.bossFor(s).id,'eye');assert.ok(!E.bossPool(s).some(b=>b.id==='plant'));
 E.startBlind(s);assert.ok(s.deck.every(card=>!E.isDebuffed(s,card)));
 const pair=[s.deck.find(c=>c.id==='S2'),s.deck.find(c=>c.id==='H2')];
 assert.equal(E.playError(s,pair),null);assert.ok(E.scoreHand(s,pair).chips>10);
 s.roundPlayed=['pair'];assert.match(E.playError(s,pair),/已经用过/);
 for(let ante=1;ante<=21;ante++){s.ante=ante;assert.notEqual(E.bossFor(s).id,'plant');}
 const classic=E.newRun('PLANT');classic.ante=4;classic.blindIndex=2;
 assert.equal(E.bossFor(classic).id,'plant');assert.equal(E.bossPool(classic).length,8);
 assert.equal(E.isDebuffed(classic,classic.deck.find(c=>c.id==='S13')),true);
});

test('Four Fingers can be bought as a Common joker and changes four-card flushes and straights in actual play',()=>{
 const s=run();s.phase='shop';s.money=12;s.shop={items:[{type:'joker',id:'ss-fingers'}],pack:null};
 assert.equal(E.jokerPool(s).find(j=>j.id==='ss-fingers').rarity,'普通');
 assert.equal(E.buyItem(s,0),null);assert.equal(s.money,5);
 s.phase='blind';E.startBlind(s);s.hand=['H2','H5','H9','H13','S14'];s.selected=s.hand.slice(0,4);
 const four=s.selected.map(id=>s.deck.find(card=>card.id===id));
 assert.equal(E.evaluate(four).id,'high');assert.equal(E.evaluateHand(s,four).id,'flush');
 assert.equal(E.playHand(s).total,244);
 assert.equal(E.evaluateHand(s,['S4','H5','C6','D7'].map(id=>s.deck.find(card=>card.id===id))).id,'straight');
});

test('shop, packs, sales and sixth-slot actions enforce the same six-joker inventory limit',()=>{
 const s=run(); s.phase='shop';s.money=100;
 own(s,'joker','scary','smiley','green','banner');
 s.shop={items:[{type:'joker',id:'ss-blue'},{type:'joker',id:'ss-abstract'}],pack:null};
 assert.equal(E.buyItem(s,0),null); assert.equal(s.jokers.length,6);
 const before=s.money; assert.match(E.buyItem(s,1),/已满/); assert.equal(s.money,before); assert.equal(s.shop.items[1].sold,undefined);
 assert.equal(E.sellJoker(s,5),true); assert.equal(s.jokers.length,5);
 s.shop.pack=['ss-abstract']; assert.equal(E.chooseBooster(s,0),true); assert.equal(s.jokers.length,6);
 s.shop.pack=['ss-blue']; assert.equal(E.chooseBooster(s,0),false);
});

test('Four Fingers, Shortcut and Smeared modify real hand detection including scoring subsets and Ace-low straights',()=>{
 const s=run(); own(s,'fingers');
 const four=cards('2H 5H 9H 13H 14S'); let h=E.evaluateHand(s,four); assert.equal(h.id,'flush'); assert.equal(h.scoring.length,4);
 assert.equal(E.evaluate(four).id,'high');
 own(s,'shortcut'); assert.equal(E.evaluateHand(s,cards('10S 8H 6C 5D 3S')).id,'straight');
 assert.equal(E.evaluateHand(s,cards('14S 2H 4C 6D 8S')).id,'straight');
 assert.notEqual(E.evaluateHand(s,cards('10S 8H 6C 5D 2S')).id,'straight');
 own(s,'smeared'); assert.equal(E.evaluateHand(s,cards('2H 5D 7H 9D 13H')).id,'flush');
 own(s,'blueprint','fingers','shortcut','smeared'); assert.equal(E.evaluateHand(s,cards('2H 4D 6H 8D 13S')).id,'straightFlush');
 assert.equal(E.evaluateHand(s,cards('2H 2D 4H 8D 13S')).id,'flush');
});

test('Splash scores kickers, preserves poker-hand base points and still respects debuffs',()=>{
 const s=run();own(s,'splash');const selected=cards('13S 13H 9C 6D 2S');
 const all=E.scoreHand(s,selected);assert.equal(all.id,'pair');assert.equal(all.scoringIds.length,5);assert.equal(all.total,(10+10+10+9+6+2)*2);
 s.ante=1;s.blindIndex=2; const blocked=E.scoreHand(s,selected);assert.equal(blocked.total,(10+10+10+6+2)*2);
});

test('face and low-rank retriggers stack and Photograph activates only once per source per hand',()=>{
 const s=run();own(s,'pareidolia','scary','smiley','buskin','hack','photograph');
 const result=E.scoreHand(s,cards('2S'));
 // 3 triggers: base 5+3*(2+30), (1+5)*2+5+5. Photograph is not repeated.
 assert.equal(result.chips,101);assert.equal(result.mult,22);assert.equal(result.total,2222);
 assert.equal(result.events.filter(e=>e.kind==='card').length,3);
 own(s,'blueprint','photograph','buskin');const photo=E.scoreHand(s,cards('13S'));
 assert.equal(photo.mult,4); assert.equal(photo.events.filter(e=>e.text==='×2 倍率').length,2);
 own(s,'blueprint','blueprint','joker'); assert.equal(E.scoreHand(s,cards('13S')).mult,9);
 own(s,'joker','blueprint'); assert.equal(E.scoreHand(s,cards('13S')).mult,5);
});

test('Blueprint duplicates active and passive effects at its position and suit sharing applies to card effects',()=>{
 const s=run();own(s,'blueprint','smiley','pareidolia');
 assert.equal(E.scoreHand(s,cards('2S')).mult,11);
 own(s,'smeared','wrathful','glutton');assert.equal(E.scoreHand(s,cards('13S')).mult,9);
 own(s,'blueprint','andy');assert.equal(E.handSize(s),6);E.startBlind(s);assert.equal(s.discards,10);
 s.ante=3;s.blindIndex=2;s.phase='blind';E.startBlind(s);assert.equal(s.discards,0);
});

test('green, square and castle growth persists correctly and preview never mutates the run',()=>{
 const s=run();E.startBlind(s);own(s,'green','square','castle','smeared');s.jokers[2].suit='S';
 const hand=putHand(s,'2H 4D 9S 13C');
 const before=JSON.stringify(s),preview=E.scoreHand(s,hand);for(let i=0;i<10;i++) assert.equal(E.scoreHand(s,hand).total,preview.total);
 assert.equal(JSON.stringify(s),before);const played=E.playHand(s);assert.equal(played.total,preview.total);
 assert.equal(s.jokers[0].value,3);assert.equal(s.jokers[1].value,12);
 s.phase='playing';putHand(s,'2S 3C 4H');assert.equal(E.discard(s),true);
 assert.equal(s.jokers[0].value,0);assert.equal(s.jokers[2].value,16);
});

test('Supernova counts the current hand and prior hands in the same ante, then resets on the next ante',()=>{
 const s=run();own(s,'supernova'); const hand=cards('13S'); s.stagePlayed={high:2};assert.equal(E.scoreHand(s,hand).mult,10);
 s.phase='shop';s.shop={};s.blindIndex=0;E.nextBlind(s);assert.equal(E.scoreHand(s,hand).mult,10);
 s.phase='shop';s.shop={};s.blindIndex=2;E.nextBlind(s);assert.deepEqual(s.stagePlayed,{});assert.equal(E.scoreHand(s,hand).mult,4);
});

test('Misprint previews use the committed roll without consuming entropy, while real turns refresh it',()=>{
 const s=run();own(s,'misprint','ancient','castle');E.startBlind(s);
 assert.ok(Number.isInteger(s.jokers[0].roll)&&s.jokers[0].roll>=0&&s.jokers[0].roll<=22);
 for(const j of s.jokers.slice(1))assert.ok(E.SUITS.some(suit=>suit.id===j.suit));
 const selected=[s.deck.find(c=>c.id===s.hand[0])]; const before=JSON.stringify(s),preview=E.scoreHand(s,selected);
 E.scoreHand(s,selected);assert.equal(JSON.stringify(s),before);
 s.selected=selected.map(c=>c.id);assert.equal(E.playHand(s).total,preview.total);
});

test('each remaining document effect contributes the specified numeric amount in actual scoring',()=>{
 const s=run(),straight=cards('10S 11H 12C 13D 14S');s.drawPile=Array(44).fill(null);
 for(const [id,total] of [['abstract',567],['banner',804],['blue',676],['flower',1572],['order',972]]) {own(s,id);assert.equal(E.scoreHand(s,straight).total,total,id);}
 own(s,'sharp');s.roundPlayed=['straight'];assert.equal(E.scoreHand(s,straight).total,972);
 own(s,'ancient');s.jokers[0].suit='S';assert.equal(E.scoreHand(s,straight).total,Math.floor(81*4*1.5*1.5));
 own(s,'half');assert.equal(E.scoreHand(s,cards('13S 12H')).total,315);assert.equal(E.scoreHand(s,cards('13S 12H 9D')).total,15);
 own(s,'misprint');s.jokers[0].roll=22;assert.equal(E.scoreHand(s,cards('13S')).total,345);
 own(s,'double');assert.equal(E.scoreHand(s,cards('13C 13H')).total,120);
 own(s,'fibonacci');assert.equal(E.scoreHand(s,cards('14S')).mult,9);
 own(s,'even');assert.equal(E.scoreHand(s,cards('10S')).mult,5);
 for(const [id,suit] of [['greedy','D'],['lusty','H'],['wrathful','S'],['glutton','C']]) {own(s,id);assert.equal(E.scoreHand(s,cards('13'+suit)).mult,5);}
});

test('joker-only shops keep three joker offers, paid rerolls and three-choice packs without effect cards',()=>{
 const s=run();s.phase='shop';s.money=10000;
 for(let round=0;round<80;round++){
  E.createShop(s);assert.equal(s.shop.items.length,3);assert.equal(s.shop.voucher,null);
  assert.ok(s.shop.items.every(item=>item.type==='joker'&&item.id.startsWith('ss-')));
  const before=s.money,cost=s.shop.rerollCost;assert.equal(E.reroll(s),true);assert.equal(s.money,before-cost);assert.equal(s.shop.rerollCost,cost+1);
  assert.ok(s.shop.items.every(item=>item.type==='joker'));assert.equal(s.shop.voucher,null);
 }
 const before=s.money;assert.equal(E.buyBooster(s),true);assert.equal(s.money,before-s.rules.boosterPrice);
 assert.equal(s.shop.pack.length,3);assert.equal(new Set(s.shop.pack).size,3);
 assert.equal(E.reroll(s),false);assert.equal(E.chooseBooster(s,0),true);assert.equal(s.jokers.length,1);
 assert.equal(s.shop.pack,null);assert.equal(s.shop.booster,false);
 const scarce=run();Object.assign(scarce.rules,{commonWeight:0,uncommonWeight:0,rareWeight:100});
 scarce.jokers=E.jokerPool(scarce).filter(j=>j.rarity==='稀有').map(j=>({id:j.id}));
 for(let i=0;i<30;i++)assert.equal(E.shopItem('planet',scarce).type,'joker');
});

test('joker-only rules reject effect purchases and ignore voucher, planet and enhancement bonuses',()=>{
 const s=run();s.phase='shop';s.money=100;s.consumables=['hermit'];s.vouchers=['hand','discard','size'];s.levels.high=10;
 s.shop={items:[{type:'planet',id:'high'},{type:'tarot',id:'hermit'}],voucher:'hand',pack:null};
 const original=JSON.stringify(s);
 assert.match(E.buyItem(s,0),/仅支持小丑/);assert.match(E.buyItem(s,1),/仅支持小丑/);
 assert.equal(E.buyVoucher(s),false);assert.match(E.useTarot(s,0),/仅支持小丑/);assert.equal(JSON.stringify(s),original);
 assert.equal(E.handSize(s),8);assert.deepEqual(E.handBase(s,'high'),{chips:5,mult:1});
 const card={...cards('13S')[0],enhancement:'bonus'};assert.equal(E.scoreHand(s,[card]).total,15);
 card.enhancement='mult';assert.equal(E.scoreHand(s,[card]).total,15);
 s.phase='blind';E.startBlind(s);assert.equal(s.hands,4);assert.equal(s.discards,4);assert.equal(s.hand.length,8);
});

test('joker-only targets and difficulty growth compensate for fixed hand levels while legacy snapshots remain fixed',()=>{
 const runs=['easy','medium','hard','nightmare'].map(d=>E.newRun('BALANCE',undefined,d,'six-seat'));
 assert.deepEqual(runs.map(s=>E.targetFor(s)),[175,250,288,338]);
 assert.deepEqual(runs.map(s=>s.difficultyRules.targetGrowth),[1,1,1.04,1.08]);
 assert.deepEqual(runs[1].modeRules.targets,[250,750,2000,5000,12000]);
 assert.deepEqual(runs.map(s=>[s.money,s.hands,s.discards]),[[8,5,5],[4,4,4],[4,4,3],[3,3,2]]);
 for(let ante=1;ante<=5;ante++) for(let blindIndex=0;blindIndex<3;blindIndex++){
  const targets=runs.map(s=>E.targetFor({...s,ante,blindIndex}));
  assert.ok(targets.every((n,i)=>!i||n>targets[i-1]));
 }
 const legacy=run();delete legacy.modeRules.jokersOnly;legacy.modeRules.targets=[300,1200,5000,18000,60000];legacy.levels.high=2;
 assert.equal(E.jokersOnly(legacy),false);assert.equal(E.targetFor(legacy),300);
 assert.deepEqual(E.handBase(legacy,'high'),{chips:15,mult:2});
 E.createShop(legacy);assert.ok(legacy.shop.items.some(item=>item.type!=='joker'));assert.ok(legacy.shop.voucher);
});
