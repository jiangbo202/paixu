import { BRAND } from './branding.js';
import { RANKINGS, rankingFor, DEFAULT_RANKING_LIMIT } from './rankings.js';
import { createBoardLoader } from './board-loader.js';
import { MODES, modeFor, modeRulesFor } from './modes.js';
import * as E from './engine.js';
import { rulesFor, DIFFICULTIES, difficultyFor } from './rules.js';
import { bindSwipeSelection, paintSelection } from './selection.js';
import { t, localize, getLanguage, setLanguage } from './i18n.js';
import { roundGuidance, animationScoreSteps, runScoreSequence, cardArtwork, formatDuration, rarityKey, bonusSummary, DEFAULT_SCORE_DURATION, normalizeScoreDuration, scoringTiming } from './presentation.js';
import { TUTORIAL_STEPS, shouldOfferTutorial, createTutorial, selectTutorialCard, tutorialScore, canAdvanceTutorial, advanceTutorial, swapTutorialJokers, buyTutorialItem } from './tutorial.js';
import { GameAudio, AUDIO_TRACKS, normalizeAudioSettings } from './audio.js';

const $ = selector => document.querySelector(selector);
const esc = value => String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
function decorateCoins(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT), nodes = []; let node;
  while ((node = walker.nextNode())) if (node.textContent.includes('🪙') && !node.parentElement.closest('[data-no-translate],script,style')) nodes.push(node);
  for (const node of nodes) {
    const fragment = document.createDocumentFragment();
    node.textContent.split('🪙').forEach((part, i) => {
      if (i) { const coin = document.createElement('span'); coin.className = 'coin-symbol'; coin.setAttribute('role', 'img'); coin.setAttribute('aria-label', t('金币')); fragment.append(coin); }
      fragment.append(document.createTextNode(part));
    });
    node.replaceWith(fragment);
  }
}
const STORAGE = 'paixu-web.run.v1';
const SETTINGS = 'paixu-web.settings.v1';
let state, hadSavedRun = false, tutorial = null;
let settings = { best: 0, ...normalizeAudioSettings() };
let storageAvailable = true;
try {
  const savedSettings = JSON.parse(localStorage.getItem(SETTINGS) || 'null');
  if (savedSettings) settings = { best: 0, ...normalizeAudioSettings(savedSettings) };
  const saved = JSON.parse(localStorage.getItem(STORAGE) || 'null');
  // Invalid or old saves should never prevent opening a new game.
  if (saved?.version === 1 && Array.isArray(saved.deck) && saved.deck.length === 52 && Array.isArray(saved.hand) && Array.isArray(saved.jokers) && ['blind', 'playing', 'roundWon', 'shop', 'lost', 'victory'].includes(saved.phase) && saved.levels && Number.isFinite(saved.rng)) state = saved;
} catch { storageAvailable = false; }
settings.scoreDurationMs = normalizeScoreDuration(settings.scoreDurationMs);
hadSavedRun = !!state;
state ||= E.newRun();
let modal = null;
let toastTimer;
const audio = new GameAudio();
audio.onStateChange = updateAudioStatus;
audio.configure(settings);
let scoring = false;
let scoreAnimation = null;
let focusBeforeModal;
let profile = null, ranked = null, backendAvailable = false, rankingEnabled = false, busy = false, currentRules;
let board = null, boardPeriod = 'all', boardMetric = 'best', boardVersion = '', boardError = '', boardLoading = false, boardDifficulty = difficultyFor(state).id;
let draftDifficulty = difficultyFor(state).id, draftMode = 'classic', boardMode = modeFor(state).id;
let jokerPopoverIndex = null, jokerPopoverTimer, suppressJokerFocus = false;
let consumablePopoverIndex = null, bonusPopoverOpen = false;
let celebrationTimer, celebrating = false, lastRuleRound = '', lastRuleInvalid = false, ruleAttentionStarted = -Infinity;
const hasHover = () => window.matchMedia('(hover: hover) and (pointer: fine)').matches;
async function api(path, method = 'GET', body, { signal } = {}) {
  const response = await fetch(path, { method, credentials: 'same-origin', signal, ...(body !== undefined ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) });
  let data; try { data = await response.json(); } catch { throw new Error(t('服务器暂不可用，仍可离线练习。')); }
  if (!response.ok) { if (data.code === 'ranking_disabled') { rankingEnabled = false; if (['profile','leaderboard','submit-run','restart'].includes(modal?.type)) closeModal(); render(); } const error = new Error(data.error || t('操作失败')); error.code = data.code; error.status = response.status; throw error; } return data;
}
function rememberMode(mode) { try { localStorage.setItem('paixu-web.mode', mode); if (mode === 'ranked' && ranked) localStorage.setItem('paixu-web.ranked-id', ranked.id); else localStorage.removeItem('paixu-web.ranked-id'); } catch { /* optional storage */ } }
async function refreshFeatures() {
  const config = await api('/api/config'); currentRules = config.rules; backendAvailable = true;
  const changed = rankingEnabled !== !!config.rankingEnabled; rankingEnabled = !!config.rankingEnabled;
  if (changed && !rankingEnabled && ['profile','leaderboard','submit-run'].includes(modal?.type)) closeModal();
  return changed;
}
const boardLoader = createBoardLoader({
  fetchBoard: (query, { signal }) => api(`/api/leaderboard?${new URLSearchParams(query)}`, 'GET', undefined, { signal }),
  onChange: view => { board = view.data; boardError = view.error; boardLoading = view.loading; if (modal?.type === 'leaderboard') updateBoard(); },
});
async function loadBoard({ force = false } = {}) {
  if (!rankingEnabled) { toast('排名已关闭，直接游玩即可。'); return; }
  if (modal?.type !== 'leaderboard') openModal('leaderboard');
  await boardLoader.load({ period: boardPeriod, version: boardVersion, difficulty: boardDifficulty, mode: boardMode, metric: boardMetric }, { force });
}
let profileRequest;
async function ensureProfile() {
  if (profile) return profile;
  profileRequest ||= (async () => {
    profile = (await api('/api/me')).profile;
    if (!profile && rankingEnabled) profile = (await api('/api/profile', 'POST', {})).profile;
    return profile;
  })().finally(() => { profileRequest = null; });
  return profileRequest;
}
async function startRanked() {
  await refreshFeatures(); if (!rankingEnabled) { closeModal(); render(); toast('排名已关闭，直接游玩即可。'); return; }
  if (busy) return; busy = true;
  try { await ensureProfile(); const data = await api('/api/runs', 'POST', { difficulty: draftDifficulty, mode: draftMode }); ranked = data.run; state = ranked.state; rememberMode('ranked'); closeModal(); update(); }
  catch (error) { toast(error.message); } finally { busy = false; }
}

const icons = {
  settings: '<path d="m9 3 1-2h4l1 2 3 2 2 0 2 4-1 2v3l1 2-2 4h-2l-3 2-1 2h-4l-1-2-3-2H4l-2-4 1-2v-3L2 9l2-4h2z"/><circle cx="12" cy="12" r="3"/>',
  music: '<path d="M9 18V5l11-2v13M9 8l11-2"/><ellipse cx="6" cy="18" rx="3" ry="2.5"/><ellipse cx="17" cy="16" rx="3" ry="2.5"/>',
  expand: '<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>',
  collapse: '<path d="M3 8h5V3m8 0v5h5M8 21v-5H3m13 5v-5h5"/>',
  sound: '<path d="m4 9 4 0 5-4v14l-5-4H4z"/><path d="M16 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/>',
  mute: '<path d="m4 9 4 0 5-4v14l-5-4H4z"/><path d="m17 9 5 6m0-6-5 6"/>',
  help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 0 1 5 0c0 2-2.5 2-2.5 4m0 3h.01"/>',
  reset: '<path d="M3 10a9 9 0 1 1 1 7M3 4v6h6"/>',
  cards: '<rect x="7" y="4" width="13" height="17" rx="2"/><path d="M15 4V2H3v15h4m7-9 3 4-3 4-3-4z"/>',
  arrow: '<path d="M4 12h15m-6-6 6 6-6 6"/>',
  shuffle: '<path d="M3 5h3c4 0 8 14 12 14h3m-4-4 4 4-4 4M3 19h3c4 0 8-14 12-14h3m-4-4 4 4-4 4"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  chevron: '<path d="m9 5 7 7-7 7"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  spark: '<path d="m12 2 2.7 7.3L22 12l-7.3 2.7L12 22l-2.7-7.3L2 12l7.3-2.7z"/>',
};
const icon = name => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${icons[name] || icons.spark}</svg>`;
function art(type, color = '#d99772', uid = '') {
  const symbols = { diamond: '♦', heart: '♥', spade: '♠', club: '♣', number: '8', star: '✦', crown: '♛', moon: '☾', sun: '☀', banana: '☽' };
  let inside;
  if (['jester', 'half'].includes(type)) inside = `<path d="M20 49 14 24 34 31 48 12 63 31 82 23 77 50" fill="#f5e9c8" stroke="#344944" stroke-width="2.5"/><circle cx="14" cy="24" r="5" fill="#e6b45f" stroke="#344944" stroke-width="2"/><circle cx="48" cy="12" r="5" fill="#e6b45f" stroke="#344944" stroke-width="2"/><circle cx="82" cy="23" r="5" fill="#e6b45f" stroke="#344944" stroke-width="2"/><path d="M24 47v27q24 35 48 0V47z" fill="#f5e9c8" stroke="#344944" stroke-width="2.5"/><path d="m25 48 23 8 23-8M48 56v32" fill="none" stroke="#344944" stroke-width="2"/><path d="m31 64 10 4-10 4m34-8-10 4 10 4" fill="none" stroke="#344944" stroke-width="3"/><path d="M35 81q13 17 26 0" fill="#dc795e" stroke="#344944" stroke-width="2.5"/><circle cx="30" cy="78" r="4" fill="#dc795e"/><circle cx="66" cy="78" r="4" fill="#dc795e"/><path d="m29 97-9 10 28-7 28 7-9-10" fill="#f5e9c8" stroke="#344944" stroke-width="2"/>${type === 'half' ? '<rect x="49" y="6" width="42" height="106" fill="#b7987a"/><path d="M49 6v106" stroke="#344944" stroke-dasharray="4 3" stroke-width="2"/>' : ''}`;
  else if (type === 'fingers') inside = '<g fill="#f5e9c8" stroke="#344944" stroke-width="2.5"><rect x="20" y="26" width="13" height="52" rx="6"/><rect x="34" y="15" width="13" height="63" rx="6"/><rect x="48" y="19" width="13" height="59" rx="6"/><rect x="62" y="33" width="13" height="45" rx="6"/><path d="M20 63h55v17q-1 24-27 25T20 80Z"/></g><text x="48" y="93" text-anchor="middle" font-size="32" font-weight="700" font-family="Georgia" fill="#344944">4</text>';
  else if (type === 'planet') inside = '<circle cx="48" cy="58" r="28" fill="#e9d8b7" stroke="#344944" stroke-width="2"/><path d="M26 40c20 5 32 16 43 35M20 58q25-2 47 19" stroke="#acb5a5" fill="none" stroke-width="7"/><ellipse cx="48" cy="60" rx="45" ry="12" transform="rotate(-28 48 60)" fill="none" stroke="#344944" stroke-width="4"/><circle cx="12" cy="25" r="2" fill="#f8eed7"/><path d="m79 14 0 10m-5-5h10M17 92v10m-5-5h10" stroke="#f8eed7" stroke-width="2"/>';
  else if (type === 'spiral') inside = '<path d="M49 60c-10 0-10-15 0-15 20 0 20 30 0 30-35 0-35-49 0-49 50 0 50 70 0 70-55 0-55-87 0-87" stroke="#f4e6c6" fill="none" stroke-width="5"/><path d="m12 108 72-96" stroke="#344944" stroke-width="1"/>';
  else if (type === 'flag') inside = '<path d="M27 106V18h4v88" fill="#344944"/><path d="M31 20h47L65 40l13 21H31z" fill="#f0ddac" stroke="#344944" stroke-width="2"/><path d="m37 30 10 10-10 10m20-20 10 10-10 10" fill="none" stroke="#d17859" stroke-width="5"/>';
  else if (type === 'mountain') inside = '<circle cx="68" cy="29" r="16" fill="#eed9a5"/><path d="m8 104 27-60 16 27L65 53l27 51z" fill="#3c5a58"/><path d="m24 68 11-24 12 20-11-5z" fill="#f1e7c9"/><path d="M8 106h84" stroke="#f1e7c9" stroke-width="3"/>';
  else if (type === 'abstract') inside = '<circle cx="35" cy="40" r="25" fill="#ecdfb7"/><path d="m39 25 43 64H21z" fill="#d27159" stroke="#344944" stroke-width="2"/><rect x="46" y="63" width="35" height="35" transform="rotate(16 63 80)" fill="#426c65"/><circle cx="34" cy="76" r="10" fill="#ecdfb7"/>';
  else if (type === 'blackboard') inside = '<rect x="9" y="21" width="80" height="74" rx="3" fill="#304b45" stroke="#e6cb8f" stroke-width="6"/><text x="49" y="70" text-anchor="middle" fill="#eee6cd" font-size="32" font-family="Georgia">×3</text><path d="m21 98-5 12m58-12 5 12" stroke="#e6cb8f" stroke-width="5"/>';
  else if (type === 'stencil') inside = '<path d="M20 33 32 42 48 17 64 42 79 33 72 79 48 100 25 79z" fill="#ece1c5" stroke="#344944" stroke-width="3"/><path d="m34 63 7 4m14 0 7-4M38 81q10 8 20 0" stroke="#344944" stroke-width="4" fill="none"/>';
  else inside = `<circle cx="48" cy="59" r="37" fill="none" stroke="#f1e5c5" stroke-width="1"/><circle cx="48" cy="59" r="32" fill="none" stroke="#344944" stroke-width="1"/><text x="48" y="83" text-anchor="middle" font-size="73" fill="#f5e7c4" stroke="#344944" stroke-width="1.5" font-family="Georgia">${symbols[type] || '✦'}</text>`;
  return `<svg class="card-art" viewBox="0 0 96 120" aria-hidden="true"><defs><pattern id="hatch${uid}" width="5" height="5" patternUnits="userSpaceOnUse"><path d="M0 5 5 0" stroke="#233e36" stroke-opacity=".10" stroke-width="1"/></pattern></defs><rect x="2" y="2" width="92" height="116" rx="4" fill="${color}"/><rect x="5" y="5" width="86" height="110" rx="3" fill="url(#hatch${uid})"/><rect x="7" y="7" width="82" height="106" rx="3" fill="none" stroke="#344944" stroke-opacity=".4"/>${inside}</svg>`;
}

function playingCard(card, { selectable = false, mini = false, dim = false, played = false, index = 0 } = {}) {
  const suit = E.SUITS.find(s => s.id === card.suit); const rank = E.rankLabel(card.rank);
  const selected = state.selected.includes(card.id); const debuffed = E.isDebuffed(state, card);
  const label = `${suit.name}${rank}${card.enhancement === 'mult' ? '，倍率牌' : card.enhancement === 'bonus' ? '，奖励牌' : ''}${debuffed ? '，已失效' : ''}`;
  const cls = `playing-card ${suit.color} ${selected && selectable ? 'selected' : ''} ${mini ? 'mini' : ''} ${dim ? 'dim' : ''} ${debuffed ? 'debuffed' : ''} ${played ? 'played-card' : ''} ${card.enhancement || ''} ${!mini && scoreAnimation?.step.cardId === card.id ? 'is-triggering' : ''}`;
  return `<${selectable ? 'button' : 'div'} class="${cls}" style="--card-index:${index}" ${selectable ? `data-action="select" data-id="${card.id}" aria-pressed="${selected}"` : ''} aria-label="${label}" title="${label} · ${E.cardChips(card)} 筹码${debuffed ? '（失效）' : ''}">${mini ? `<span class="card-corner top"><b>${rank}</b><span>${suit.symbol}</span></span>` : cardArtwork(card)}${card.enhancement ? `<span class="enhancement">${card.enhancement === 'mult' ? '+4 ×' : '+30'}</span>` : ''}${debuffed ? '<span class="debuff-mark">×</span>' : ''}</${selectable ? 'button' : 'div'}>`;
}
function renderJokerStatus(owned,index) {
  const parts = [];
  if (['green','ss-green','ss-castle','ss-square'].includes(owned.id)) parts.push(`${t('当前累计')} +${owned.value||0} ${t(owned.id.includes('green') ? '倍率' : '筹码')}`);
  if (['ss-castle','ss-ancient'].includes(owned.id)) parts.push(`${t('指定花色')} ${E.SUITS.find(s=>s.id===owned.suit)?.symbol || '—'}`);
  if (owned.id==='ss-misprint') parts.push(`${t('本手随机倍率')} +${owned.roll||0}`);
  if (owned.id==='ss-blueprint') {
    const target = state.jokers[index+1], info = E.JOKERS.find(j=>j.id===target?.id);
    parts.push(info && target.id!=='ss-blueprint' ? `${t('复制目标')}：${t(info.name)}` : t('右侧无可复制的小丑'));
  }
  return parts.map(text=>`<p class="joker-growth">${esc(text)}</p>`).join('');
}
function jokerCard(joker, index, extraClass = '') {
  if (scoreAnimation?.step.jokerIndex === index) extraClass += ' is-triggering';
  const open = hasHover() && jokerPopoverIndex === index;
  const canManage = ['blind', 'playing', 'shop'].includes(state.phase) && !ranked?.finished && !scoring;
  const owned = state.jokers[index];
  return `<div class="joker-slot ${open ? 'popover-open' : ''}" data-joker-slot="${index}" data-popover-kind="joker" data-popover-index="${index}"><button class="joker-card rarity-card-${rarityKey(joker.rarity)} ${extraClass}" data-popover-trigger style="--jcolor:${joker.color}" data-action="joker" data-index="${index}" aria-controls="joker-popover-${index}" aria-expanded="${open}" aria-label="${esc(joker.name + '，' + joker.desc + '。' + (hasHover() ? '悬停或聚焦查看操作' : '点击管理'))}"><span class="joker-card-label">JOKER <span>✦</span></span>${art(joker.art, joker.color, 'owned' + index)}<span class="joker-card-name">${joker.name}</span></button><div class="joker-popover" data-popover-panel id="joker-popover-${index}" role="group" aria-label="${esc(joker.name)}" ${open ? '' : 'hidden'}><div class="joker-popover-heading"><strong>${joker.name}</strong>${rarityBadge(joker.rarity)}</div><p>${joker.desc}</p>${renderJokerStatus(owned,index)}<div class="joker-popover-order"><button class="button muted-button" data-action="move-left" data-joker-index="${index}" ${index === 0 || !canManage ? 'disabled' : ''}>← 向左移</button><span>第 ${index + 1} / ${state.jokers.length} 位</span><button class="button muted-button" data-action="move-right" data-joker-index="${index}" ${index === state.jokers.length - 1 || !canManage ? 'disabled' : ''}>向右移 →</button></div><div class="joker-popover-footer"><small>从左到右结算</small><button class="button coral-button" data-action="sell" data-joker-index="${index}" ${!canManage ? 'disabled' : ''}>出售 <b>🪙${E.jokerSellPrice(state, joker.id)}</b></button></div></div></div>`;
}
function consumableCard(index) {
  const card = E.TAROTS.find(t => t.id === state.consumables[index]);
  const open = hasHover() && consumablePopoverIndex === index;
  const canManage = ['blind', 'playing', 'shop'].includes(state.phase) && !ranked?.finished && !scoring;
  const error = E.tarotError(state, index);
  return `<div class="consumable-slot ${open ? 'popover-open' : ''}" data-popover-kind="consumable" data-popover-index="${index}"><button class="consumable-card" data-action="consumable" data-index="${index}" data-popover-trigger aria-controls="consumable-popover-${index}" aria-expanded="${open}" aria-label="${esc(card.name + '，' + card.desc)}">${art(card.art, card.color, 'tarot' + index)}<span>${t(card.name).replace(/^The /, '')}</span></button><div class="joker-popover consumable-popover" data-popover-panel id="consumable-popover-${index}" role="group" aria-label="${card.name}" ${open ? '' : 'hidden'}><div class="joker-popover-heading"><strong>${card.name}</strong>${rarityBadge('tarot', '塔罗牌')}</div><p>${card.desc}</p><p class="consumable-hint">${error || (card.id === 'hermit' ? `现在使用可以获得 🪙${Math.min(20, state.money)}。` : '已选好手牌，可以使用。')}</p><div class="consumable-actions"><button class="button green-button" data-action="use-tarot" data-consumable-index="${index}" ${!canManage || error ? 'disabled' : ''}>使用 ${icon('spark')}</button><button class="button coral-button" data-action="sell-tarot" data-consumable-index="${index}" ${!canManage ? 'disabled' : ''}>出售 🪙1</button></div></div></div>`;
}
function isPopoverOpen(kind, index) { return kind === 'bonus' ? bonusPopoverOpen : (kind === 'joker' ? jokerPopoverIndex : consumablePopoverIndex) === index; }
function showInventoryPopover(kind, index) {
  if (!hasHover() || scoring || modal || (kind !== 'bonus' && !(kind === 'joker' ? state.jokers : state.consumables)[index])) return;
  clearTimeout(jokerPopoverTimer);
  jokerPopoverIndex = kind === 'joker' ? index : null; consumablePopoverIndex = kind === 'consumable' ? index : null; bonusPopoverOpen = kind === 'bonus';
  for (const slot of document.querySelectorAll('[data-popover-kind]')) {
    const open = slot.dataset.popoverKind === kind && Number(slot.dataset.popoverIndex) === index;
    slot.classList.toggle('popover-open', open);
    slot.querySelector('[data-popover-panel]').hidden = !open;
    slot.querySelector('[data-popover-trigger]').setAttribute('aria-expanded', String(open));
  }
  const slot = $(`[data-popover-kind="${kind}"][data-popover-index="${index}"]`), panel = slot?.querySelector('[data-popover-panel]');
  if (panel) {
    const x = slot.getBoundingClientRect().left;
    const left = Math.max(12, Math.min(x, window.innerWidth - panel.offsetWidth - 12));
    panel.style.left = left - x + 'px'; panel.style.right = 'auto';
    if (kind === 'bonus') panel.style.maxHeight = Math.max(120, Math.min(480, innerHeight - slot.getBoundingClientRect().bottom - 24)) + 'px';
  }
}
const showJokerPopover = index => showInventoryPopover('joker', index);
function hideJokerPopover(focusTrigger = false) {
  clearTimeout(jokerPopoverTimer);
  const trigger = $('[data-popover-kind].popover-open [data-popover-trigger]');
  jokerPopoverIndex = null; consumablePopoverIndex = null; bonusPopoverOpen = false;
  for (const slot of document.querySelectorAll('[data-popover-kind]')) {
    slot.classList.remove('popover-open'); slot.querySelector('[data-popover-panel]').hidden = true;
    slot.querySelector('[data-popover-trigger]').setAttribute('aria-expanded', 'false');
  }
  if (focusTrigger && trigger) { suppressJokerFocus = true; trigger.focus({ preventScroll: true }); suppressJokerFocus = false; }
}
function save() {
  settings.best = Math.max(settings.best || 0, state.bestHand);
  try { localStorage.setItem(STORAGE, JSON.stringify(state)); localStorage.setItem(SETTINGS, JSON.stringify(settings)); } catch { storageAvailable = false; }
}
function toast(message) { $('#toast').textContent = t(message); decorateCoins($('#toast')); $('#toast').classList.add('visible'); clearTimeout(toastTimer); toastTimer = setTimeout(() => $('#toast').classList.remove('visible'), 3500); }
function sound(kind = 'select', variant = 0) { audio.play(kind, variant); }
function dealSound(count) { if (count > 0) setTimeout(() => sound('deal', count), 100); }
function actionSound(action, type = '', dealt = 0) {
  sound(({ start: 'deal', discard: 'discard', cashout: 'buy', next: 'click', buy: type === 'planet' ? 'upgrade' : 'buy', reroll: 'shuffle', voucher: 'upgrade', booster: 'pack', 'pack-pick': 'buy', sell: 'sell', 'sell-tarot': 'sell', 'use-tarot': 'tarot', skip: 'buy', 'move-left': 'sort', 'move-right': 'sort' })[action] || 'click', action === 'start' ? state.hand.length : 0);
  if (action === 'discard') dealSound(dealt);
}
const rarityBadge = (rarity, label = rarity) => `<span class="rarity rarity-${rarityKey(rarity)}">${label}</span>`;
function updateFullscreenButton() {
  const button = $('.fullscreen-button'); if (!button) return;
  const active = !!document.fullscreenElement, label = t(active ? '退出全屏' : '全屏');
  button.innerHTML = icon(active ? 'collapse' : 'expand'); button.title = label; button.setAttribute('aria-label', label); button.setAttribute('aria-pressed', String(active));
  button.hidden = !document.fullscreenEnabled;
}
function audioStatus() { return !settings.musicEnabled ? '背景音乐已暂停' : audio.context?.state === 'running' && !audio.hidden ? '正在播放' : audio.context ? '轻触页面以恢复声音' : '首次点击页面后播放'; }
function updateAudioStatus() { const status = $('#audio-status'); if (status) status.textContent = t(audioStatus()); }
function savePreferences() {
  audio.configure(settings);
  if (audio.enabled && audio.context?.state !== 'running') void audio.unlock();
  try { localStorage.setItem(SETTINGS, JSON.stringify(settings)); } catch { storageAvailable = false; }
  const button = $('[data-action="audio"]'); if (button) button.innerHTML = icon('settings');
  updateAudioStatus();
}
function renderAudioSettings() {
  return `<p class="modal-subtitle">原创合成音乐与音效，无需下载音频。切换曲目立即生效，设置自动保存。</p><div class="audio-toggle"><label for="music-enabled">背景音乐</label><input id="music-enabled" type="checkbox" ${settings.musicEnabled ? 'checked' : ''} /></div><div class="music-tracks">${AUDIO_TRACKS.map((track, i) => `<button class="music-track ${settings.musicTrack === track.id ? 'chosen' : ''}" data-action="choose-track" data-track="${track.id}" aria-pressed="${settings.musicTrack === track.id}"><span class="track-number">0${i + 1}</span><span><b>${track.name}</b><small>${track.desc}</small></span><span>${settings.musicTrack === track.id ? icon('check') : icon('music')}</span></button>`).join('')}</div><div class="volume-row"><label for="music-volume">音乐音量</label><input id="music-volume" type="range" min="0" max="100" value="${Math.round(settings.musicVolume * 100)}" /><output for="music-volume">${Math.round(settings.musicVolume * 100)}%</output></div><div class="audio-toggle"><label for="effects-enabled">动作音效</label><input id="effects-enabled" type="checkbox" ${settings.sound ? 'checked' : ''} /></div><div class="volume-row"><label for="effects-volume">音效音量</label><input id="effects-volume" type="range" min="0" max="100" value="${Math.round(settings.effectsVolume * 100)}" /><output for="effects-volume">${Math.round(settings.effectsVolume * 100)}%</output></div><div class="sound-previews"><span>试听</span><button class="button muted-button" data-action="preview-sfx" data-sfx="deal" ${settings.sound ? '' : 'disabled'}>发牌</button><button class="button muted-button" data-action="preview-sfx" data-sfx="pack" ${settings.sound ? '' : 'disabled'}>开包</button><button class="button muted-button" data-action="preview-sfx" data-sfx="chip" ${settings.sound ? '' : 'disabled'}>筹码</button><button class="button muted-button" data-action="preview-sfx" data-sfx="buy" ${settings.sound ? '' : 'disabled'}>购买</button><button class="button muted-button" data-action="preview-sfx" data-sfx="clear" ${settings.sound ? '' : 'disabled'}>达标</button></div><p class="audio-status"><i></i><span id="audio-status" role="status">${audioStatus()}</span></p><p class="privacy-note">默认曲目：夜色牌桌。音乐与音效可分别关闭；离开页面时暂停播放。</p>`;
}
const durationLabel = duration => duration === 0 ? t('关闭动画') : `${duration / 1000} ${t('秒')}`;
function renderSettingsTabs() {
  return `<div class="settings-tabs"><button data-action="settings-audio" aria-pressed="${modal.type === 'audio'}">声音</button><button data-action="settings-animation" aria-pressed="${modal.type === 'animation'}">计分动画</button></div>`;
}
function renderAnimationSettings() {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  return `<p class="modal-subtitle">设置计分动画的基础时长，自动保存。</p><div class="animation-setting-heading"><label for="score-duration">基础时长</label><small>默认 3 秒</small></div><div class="animation-duration-row"><input id="score-duration" type="range" min="0" max="8" step="0.5" value="${settings.scoreDurationMs / 1000}" aria-label="计分动画时长" /><output for="score-duration">${durationLabel(settings.scoreDurationMs)}</output></div><div class="animation-scale"><span>0 · 关闭</span><span>8 秒</span></div><div class="animation-presets">${[[1500, '快速'], [DEFAULT_SCORE_DURATION, '默认'], [6000, '慢速']].map(([value, label]) => `<button class="button muted-button" data-action="animation-preset" data-duration="${value}" aria-pressed="${settings.scoreDurationMs === value}"><b>${label}</b><small>${value / 1000} ${t('秒')}</small></button>`).join('')}</div><p class="help-note">每步按固定节奏播放，效果较多时自动延长，避免加速。</p><p class="help-note">基础时长包含逐步计分与总分入账；可随时点击「跳过动画」或按 Esc。</p><p class="help-note">密集的逐牌效果会合并展示，完整过程仍可在计分明细查看。</p>${reduced ? '<p class="help-note">系统已启用减少动态效果，将直接显示结果。</p>' : ''}<p class="privacy-note">达标彩纸遵循系统的减少动态效果设置；音效可在「声音」中关闭。</p>`;
}
function renderBonusOverview() {
  const bonus = bonusSummary(state);
  const groups = [['星球', bonus.planets.length], ['优惠券', bonus.vouchers.length], ['增强牌', bonus.enhanced.length]];
  const total = groups.reduce((sum, [, count]) => sum + count, 0);
  const hint = groups.map(([name, count]) => `${t(name)} ${count}`).join(' · ');
  const open = hasHover() && bonusPopoverOpen;
  return `<div class="inventory-bonuses ${open ? 'popover-open' : ''}" data-popover-kind="bonus" data-popover-index="0"><button class="bonus-overview ${total ? 'has-bonuses' : ''}" data-action="bonuses" data-popover-trigger aria-controls="bonus-popover" aria-expanded="${open}" aria-label="${t('加成清单')} · ${hint}"><span class="bonus-overview-title">${icon('spark')}<b>加成</b><em>${total}</em></span><span class="bonus-overview-stats">${total ? groups.filter(([, count]) => count).map(([name, count]) => `<span>${name}<b>${count}</b></span>`).join('') : '<small>暂无加成</small>'}</span></button><div class="joker-popover bonus-popover" id="bonus-popover" data-popover-panel role="group" aria-label="加成清单" ${open ? '' : 'hidden'}><div class="joker-popover-heading"><strong>加成清单</strong></div>${renderBonuses()}<button class="text-button bonus-expand" data-action="bonus-details">展开清单 ${icon('arrow')}</button></div></div>`;
}
function renderInventory() {
  return `<section class="inventory ${E.jokersOnly(state) ? 'jokers-only' : ''}" aria-label="持有卡牌">
    <div class="joker-inventory"><div class="inventory-heading"><span>小丑牌 <b>${state.jokers.length}<i>/ ${E.jokerSlots(state)}</i></b></span></div><div class="joker-rack" style="--joker-slots:${E.jokerSlots(state)}">${Array.from({ length: E.jokerSlots(state) }, (_, i) => state.jokers[i] ? jokerCard(E.JOKERS.find(j => j.id === state.jokers[i].id), i) : '<div class="empty-joker"><span>✦</span></div>').join('')}</div></div>
    ${E.jokersOnly(state) ? '' : `${renderBonusOverview()}
    <div class="consumable-inventory"><div class="inventory-heading"><span><span class="inventory-label-full">消耗牌</span><span class="inventory-label-short">道具</span><b>${state.consumables.length}<i>/ 2</i></b></span></div><div class="consumable-rack">${Array.from({ length: 2 }, (_, i) => state.consumables[i] ? consumableCard(i) : '<div class="empty-consumable"><span>✧</span></div>').join('')}</div></div>`}
  </section>`;
}
function renderBonuses() {
  const bonus = bonusSummary(state), sections = [];
  const section = (title, content) => `<section class="bonus-section"><h3>${title}</h3>${content}</section>`;
  if (bonus.planets.length) sections.push(section('星球升级', bonus.planets.map(p => `<div class="bonus-row"><span><b>${p.name}</b><small>Lv.${p.level}</small></span><span><b class="blue-text">+${p.chips} ${t('筹码')}</b><b class="red-text">+${p.mult} ${t('倍率')}</b></span></div>`).join('')));
  const voucherText = { hand: '每轮 +1 出牌', discard: '每轮 +1 弃牌', size: '手牌上限 +1' };
  if (bonus.vouchers.length) sections.push(section('优惠券', bonus.vouchers.map(v => `<div class="bonus-row"><b>${v.name}</b><span>${voucherText[v.id]}</span></div>`).join('')));
  if (bonus.enhanced.length) sections.push(section('牌面增强', ['mult', 'bonus'].map(type => {
    const cards = bonus.enhanced.filter(card => card.enhancement === type); if (!cards.length) return '';
    return `<div class="bonus-enhancement"><div class="bonus-row"><b>${type === 'mult' ? '倍率牌' : '奖励牌'} <small>×${cards.length}</small></b><span class="${type === 'mult' ? 'red-text' : 'blue-text'}">${type === 'mult' ? '+4 ' + t('倍率') : '+30 ' + t('筹码')}${t(' / 张')}</span></div><div class="bonus-card-tags">${cards.map(card => { const suit = E.SUITS.find(s => s.id === card.suit); return `<span class="${suit.color === 'red' ? 'red-text' : ''}">${suit.symbol} ${E.rankLabel(card.rank)}</span>`; }).join('')}</div></div>`;
  }).join('')));
  const history = bonus.used.length ? `<details class="bonus-history"><summary>使用记录 <span>${bonus.used.reduce((sum, card) => sum + card.count, 0)}</span></summary><div>${bonus.used.map(card => `<span><b>${card.name} ×${card.count}</b><small>${card.id === 'hermit' ? '🪙' + card.money : card.cardIds.length + ' ' + t('张牌')}</small></span>`).join('')}</div></details>` : '';
  return `${sections.length ? sections.join('') + '<p class="bonus-note">加成仅作用于对应牌型或计分卡牌。</p>' : '<p class="bonus-empty">暂无加成</p>'}${history}`;
}
const selectedCards = () => state.selected.map(id => state.deck.find(c => c.id === id)).filter(Boolean);
const blindName = (index = state.blindIndex) => ['小盲注', '大盲注', `${E.bossFor({ ...state, blindIndex: 2 }).name} · Boss`][index];
const blindBadge = (index = state.blindIndex, large = false) => `<span class="blind-badge blind-${index} ${large ? 'large' : ''}"><span>${index === 2 ? E.bossFor({ ...state, blindIndex: 2 }).icon : index === 1 ? '♠' : '♣'}</span></span>`;

function render() {
  const focused = document.activeElement;
  const previousFocus = focused?.closest('#app') && focused.dataset.action ? { ...focused.dataset } : null;
  const selection = selectedCards(); const preview = selection.length ? E.scoreHand(state, selection) : null;
  const invalidSelection = state.phase === 'playing' && selection.length ? E.playError(state, selection) : null;
  const display = scoreAnimation ? { ...state.lastPlay, ...scoreAnimation.step, total: Math.floor(scoreAnimation.step.chips * scoreAnimation.step.mult) } : preview || state.lastPlay;
  const shownScore = scoreAnimation ? scoreAnimation.shownScore : state.score;
  const progress = Math.min(100, shownScore / E.targetFor(state) * 100);
  $('#app').innerHTML = `<div class="app-shell" data-phase="${state.phase}">
    <header class="topbar">
      <a class="brand" href="./" aria-label="牌序首页"><img class="brand-mark" src="./favicon.svg" alt="" /><span><span class="brand-word">${BRAND.wordmark}</span><span class="brand-sub">牌序 · 扑克构筑</span></span></a>
      <div class="topbar-middle"><span class="deck-tag"><i></i> ${modeFor(state).name}</span><span class="autosave"><i></i>${storageAvailable ? '进度自动保存' : '临时会话'}</span></div>
      <div class="topbar-actions"><button class="icon-button" data-action="audio" aria-label="游戏设置" title="游戏设置" ${scoring ? 'disabled' : ''}>${icon('settings')}</button><button class="icon-button" data-action="help" aria-label="玩法帮助" title="玩法帮助">${icon('help')}</button><button class="icon-button fullscreen-button" data-action="fullscreen" aria-label="全屏" title="全屏">${icon('expand')}</button><button class="new-run-button" data-action="restart" aria-label="新一局">${icon('reset')}<span>新一局</span></button></div>
    </header>
    <main class="game-grid">
      <aside class="sidebar" aria-label="本局数据">
        <div class="blind-heading">${blindBadge()}<div><span class="eyebrow">${state.blindIndex === 2 ? 'BOSS BLIND' : 'CURRENT BLIND'}</span><h1>${blindName()}<small class="game-mode-badge" title="${t(modeFor(state).name)}">${modeFor(state).short}</small></h1></div></div>
        <div class="target-block"><span title="${t(modeFor(state).name)}">目标分数 <span class="difficulty-badge difficulty-${difficultyFor(state).id}" title="${t('难度')}：${t(difficultyFor(state).name)}">${difficultyFor(state).name}</span></span><strong>${E.format(E.targetFor(state))}</strong><span class="reward-label">${state.blindIndex === 2 ? '首领挑战' : '击败奖励'} <b>🪙${[3, 4, 5][state.blindIndex]}</b></span></div>
        <div class="score-block ${celebrating ? 'goal-reached' : ''}"><div class="section-caption">本轮得分<span>ROUND SCORE</span></div><div class="round-score">${E.format(shownScore)}</div><div class="progress-track"><div style="width:${progress}%"></div></div></div>
        <div class="hand-score-block"><div class="hand-type"><span>${display ? display.name : '准备出牌'}</span><small>${display ? `Lv.${E.handLevel(state,display.id)}` : '选出你的组合'}</small></div><div class="calculation"><div class="chips-box"><span>筹码</span><b>${display ? E.format(display.chips) : '0'}</b></div><span class="times">×</span><div class="mult-box"><span>倍率</span><b>${display ? E.format(display.mult) : '0'}</b></div></div><div class="estimated"><span>${scoring ? '正在计分…' : invalidSelection ? '选牌不符合本轮规则' : preview ? '预计得分' : state.lastPlay ? '上一手得分' : '筹码 × 倍率 = 得分'}</span>${display ? `<b>${invalidSelection ? '—' : E.format(display.total)}</b>` : ''}</div></div>
        <div class="stat-grid"><div class="stat"><span>剩余出牌</span><strong class="blue-text">${state.hands}<small>次</small></strong></div><div class="stat"><span>剩余弃牌</span><strong class="red-text">${state.discards}<small>次</small></strong></div><div class="stat money-stat"><span>持有金币</span><strong class="gold-text">🪙${state.money}</strong></div><div class="stat"><span>底注</span><strong>${state.ante}<small> / ${state.endless ? '∞' : modeRulesFor(state).antes}</small></strong></div><div class="stat"><span>回合</span><strong>${state.round}</strong></div></div>
        <div class="sidebar-buttons"><button class="subtle-button" data-action="hands">${icon('cards')}牌型一览</button><button class="subtle-button" data-action="deck">${icon('cards')}牌组 <b>52</b></button><span class="submit-slot">${rankingEnabled && ranked && ranked.eligible !== false && !ranked.finished ? '<button class="subtle-button submit-button" data-action="submit-run">结束并提交成绩</button>' : ''}</span></div>
        <button class="seed-button" data-action="seed" title="复制本局种子">种子 <span>${esc(state.seed)}</span><span>⧉</span></button>
      </aside>
      <div class="table">
        ${renderInventory()}
        <div class="play-area ${['playing', 'roundWon', 'lost', 'victory'].includes(state.phase) ? 'with-hand' : ''}">
          <section class="arena ${state.phase === 'shop' ? 'shop-arena' : ''} ${scoring ? 'is-scoring' : ''}" aria-label="游戏牌桌" aria-busy="${scoring}">${renderArena()}</section>
          ${['playing', 'roundWon', 'lost', 'victory'].includes(state.phase) ? renderHand() : ''}
        </div>
      </div>
    </main>
    <footer class="footer"><span><b>♣</b> 一手好牌，无限可能。</span><span class="keyboard-hints"><kbd>E</kbd> 出牌 <kbd>D</kbd> 弃牌 <kbd>R</kbd> 排序 <kbd>Esc</kbd> 取消选择</span><span>BROWSER EDITION <i>✦</i> 核心玩法版</span></footer>
  </div>`;
  $('#app .topbar-actions').insertAdjacentHTML('afterbegin', `<button class="language-button" data-action="language" aria-label="${getLanguage() === 'zh' ? 'Switch to English' : '切换中文'}">${getLanguage() === 'zh' ? 'EN' : '中文'}</button>${rankingEnabled ? `<button class="profile-button" data-action="profile" aria-label="访客资料" title="访客资料"><span class="player-symbol" aria-hidden="true">♠</span><span data-no-translate>${profile ? esc(profile.displayName) : t('用户名')}</span></button><button class="icon-button board-button" data-action="leaderboard" aria-label="排行榜" title="排行榜">♜</button>` : ''}`);
  $('#app .topbar-middle').insertAdjacentHTML('beforeend', `<span class="mode-pill ${ranked ? 'ranked' : ''}">${ranked ? rankingEnabled && ranked.eligible !== false ? '服务端验证' : '本局不计排名' : '离线练习'}</span>`);
  if (ranked) $('#app .seed-button').innerHTML = `<span>${rankingEnabled && ranked.eligible !== false ? '上榜对局' : '本局不计排名'}</span><span>${esc(ranked.configVersion.slice(0, 14))}</span>`;
  localize($('#app')); decorateCoins($('#app'));
  updateFullscreenButton();
  if (modal) renderModal();
  if (previousFocus && !modal) {
    if (previousFocus.jokerIndex !== undefined) {
      if (jokerPopoverIndex === null) return;
      previousFocus.jokerIndex = String(jokerPopoverIndex);
    }
    if (previousFocus.consumableIndex !== undefined) {
      if (consumablePopoverIndex === null) return;
      previousFocus.consumableIndex = String(consumablePopoverIndex);
    }
    const match = [...document.querySelectorAll('#app [data-action]')].find(el => Object.entries(previousFocus).every(([key, value]) => el.dataset[key] === value));
    if (match && !match.disabled) match.focus({ preventScroll: true });
  }
}
function renderRoundNotice() {
  const guidance = roundGuidance(state, selectedCards());
  if (!guidance) return '';
  const roundKey = `${ranked?.id || state.seed}:${state.round}:${guidance.boss.id}:${state.phase}`;
  const now = performance.now();
  if (roundKey !== lastRuleRound || (guidance.error && !lastRuleInvalid)) ruleAttentionStarted = now;
  const elapsed = now - ruleAttentionStarted, attention = elapsed < 2200;
  lastRuleRound = roundKey; lastRuleInvalid = !!guidance.error;
  return `<section class="round-notice ${guidance.error ? 'has-error' : ''} ${attention ? 'rule-attention' : ''}" ${attention ? `style="animation-delay:-${Math.round(elapsed)}ms"` : ''} ${guidance.error ? 'id="play-warning"' : ''} role="${guidance.error ? 'status' : 'note'}" aria-label="本轮特殊规则" aria-description="${esc(t(guidance.error || guidance.detail))}" title="${esc(t(guidance.detail))}"><span class="rule-symbol" aria-hidden="true">!</span><div class="rule-copy"><div class="rule-heading"><span>本轮限制</span><b>${guidance.boss.name}</b></div><strong>${guidance.title}</strong><p>${guidance.error || guidance.detail}</p></div>${guidance.tags.length ? `<div class="rule-tags"><span>${guidance.boss.id === 'eye' ? '本轮已用' : '锁定牌型'}</span>${guidance.tags.map(tag => `<b class="${tag.used ? 'used-hand' : ''}">${tag.label}${tag.used ? ' ×' : ''}</b>`).join('')}</div>` : ''}</section>`;
}
function renderScoring() {
  const { step, index, steps } = scoreAnimation;
  const labels = { base: '牌型基础', card: '卡牌加成', joker: '小丑效果', total: '总分入账' };
  return `<div class="scoring-panel"><div class="scoring-phases">${Object.entries(labels).map(([kind, label]) => `<span class="${step.kind === kind || step.kind === 'effects' && ['card','joker'].includes(kind) ? 'current' : ''}">${label}</span>`).join('')}</div><div class="scoring-event" role="status"><span>${step.kind === 'total' ? '本轮得分入账' : step.label}</span><strong>${step.kind === 'total' ? '+' + E.format(state.lastPlay.total) : step.text}</strong></div><div class="scoring-formula"><b class="blue-text">${E.format(step.chips)}</b><span>×</span><b class="red-text">${E.format(step.mult)}</b><span>=</span><b class="gold-text">${E.format(Math.floor(step.chips * step.mult))}</b></div><div class="scoring-controls"><span>${Math.min(index + 1, steps.length)} / ${steps.length}</span><button data-action="skip-animation">跳过动画 ${icon('chevron')}</button></div></div>`;
}
function scoringPause(duration) {
  return new Promise(resolve => {
    const timer = setTimeout(() => { if (scoreAnimation) scoreAnimation.resume = null; resolve(); }, duration);
    scoreAnimation.resume = () => { clearTimeout(timer); scoreAnimation.resume = null; resolve(); };
  });
}
function clearCelebration() {
  clearTimeout(celebrationTimer); celebrating = false;
  $('#celebration-root').replaceChildren(); $('.score-block')?.classList.remove('goal-reached');
}
function celebrateTarget(target) {
  clearCelebration(); celebrating = true; sound('clear');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const colors = ['#f8d77c', '#ed8d76', '#a8d7b1', '#9bbfee', '#d5b3e5', '#fff0c4'];
  const pieces = reduced ? '' : Array.from({ length: 64 }, (_, i) => {
    const side = i % 2 ? 1 : -1, x = side < 0 ? 18 + Math.random() * 18 : 64 + Math.random() * 18;
    return `<i class="confetti-piece" style="--x:${x}vw;--drift:${side * (40 + Math.random() * 220)}px;--delay:${Math.random() * .24}s;--fall:${1.7 + Math.random() * .7}s;--spin:${360 + Math.random() * 720}deg;--color:${colors[i % colors.length]};--piece-width:${5 + Math.random() * 5}px;--piece-shape:${i % 4 === 0 ? '50%' : '1px'}"></i>`;
  }).join('');
  $('#celebration-root').innerHTML = `<div class="target-celebration ${reduced ? 'reduced-celebration' : ''}">${pieces}<div class="celebration-banner"><span>✦</span><div><strong>${t('目标达成！')}</strong><small>${t('本轮目标')} ${E.format(target)}</small></div><span>✦</span></div></div>`;
  $('.score-block')?.classList.add('goal-reached');
  celebrationTimer = setTimeout(clearCelebration, 2800);
}
async function animateScoring(previousScore, dealt) {
  hideJokerPopover(); sound('play');
  const result = state.lastPlay, steps = animationScoreSteps(result,settings.scoreDurationMs), target = E.targetFor(state);
  const timing = scoringTiming(settings.scoreDurationMs, steps.length);
  const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const crossedTarget = previousScore < target && state.score >= target;
  let celebrated = false;
  const celebrate = () => { if (crossedTarget && !celebrated) { celebrated = true; celebrateTarget(target); } };
  save();
  if (!reduced && timing.total > 0 && steps.length) {
    scoring = true;
    scoreAnimation = { steps, step: steps[0], index: 0, shownScore: previousScore, skip: false };
    try {
      render();
      $('.arena')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      await runScoreSequence(steps,timing.step,{
        skipped:()=>scoreAnimation.skip,wait:scoringPause,
        onStep:(step,i)=>{
          scoreAnimation.index=i;scoreAnimation.step=step;render();
          sound(step.kind==='joker'?'joker':step.text.includes('倍率')?'mult':'chip',i%10);
        },
      });
      if (!scoreAnimation.skip) {
        scoreAnimation.step = { kind: 'total', chips: result.chips, mult: result.mult };
        scoreAnimation.index = steps.length; render(); sound('total');
        await new Promise(resolve => {
          const start = performance.now();
          function tick(now) {
            const progress = scoreAnimation.skip ? 1 : Math.min(1, (now - start) / timing.tally);
            scoreAnimation.shownScore = Math.round(previousScore + result.total * (1 - (1 - progress) ** 3));
            $('.round-score').textContent = E.format(scoreAnimation.shownScore);
            $('.progress-track>div').style.width = Math.min(100, scoreAnimation.shownScore / target * 100) + '%';
            if (scoreAnimation.shownScore >= target) celebrate();
            if (progress < 1) requestAnimationFrame(tick); else resolve();
          }
          requestAnimationFrame(tick);
        });
        // Short hands keep the configured minimum duration; extra effects add
        // beats instead of borrowing time from every preceding scoring event.
        if (!scoreAnimation.skip && timing.hold > 0) await scoringPause(timing.hold);
      }
    } finally { scoring = false; scoreAnimation = null; }
  }
  render(); celebrate();
  if (state.phase === 'lost') sound('lose');
  if (state.phase === 'playing') dealSound(dealt);
  $('#announcer').textContent = `${t(result.name)} +${E.format(result.total)}. ${t('本轮得分')} ${E.format(state.score)}. ${state.phase === 'roundWon' ? t('盲注击破！') : ''}`;
}
function renderArena() {
  if (ranked?.finished && !scoring && !['lost', 'victory'].includes(state.phase)) return `<div class="arena-content"><div class="result-panel win-panel"><span class="result-eyebrow">SERVER VERIFIED</span><h2>${ranked.scoreRecorded ? '成绩已提交' : '本局已结束'}</h2><p>${ranked.scoreRecorded ? '本局已提交，可在排行榜查看。' : ranked.rankingStatus==='outside_top' ? `未进入任意榜单前 ${ranked.rankingLimit} 名，本局成绩不保留。` : ranked.rankingStatus==='empty' ? '本局尚无有效得分，不记录排名。' : '本局不计排名，游戏记录已保存。'}</p><div class="run-summary"><span>最高单手<b>${E.format(state.bestHand)}</b></span><span>累计得分<b>${E.format(state.totalScore)}</b></span><span>底注<b>${state.ante}</b></span></div>${rankingEnabled ? '<button class="button gold-button wide-button" data-action="leaderboard">排行榜</button>' : ''}<button class="text-button" data-action="restart">开启新一局</button></div></div>`;
  if (state.phase === 'blind') return renderBlindSelection();
  if (state.phase === 'shop') return renderShop();
  const last = state.lastPlay;
  const playedCards = last ? [...last.cards].sort((a, b) => b.rank - a.rank) : [];
  let center = last ? `<div class="played-hand"><div class="played-label">${last.name}<span>Lv.${E.handLevel(state,last.id)}</span></div><div class="played-cards">${playedCards.map((c, i) => playingCard(c, { played: scoring, dim: !last.scoringIds.includes(c.id), index: i })).join('')}</div><button class="last-result ${scoring ? 'score-pop' : ''}" data-action="breakdown"><span>+${E.format(last.total)}</span><small>${E.format(last.chips)} × ${E.format(last.mult)} ${icon('help')}</small></button></div>` : `<div class="table-watermark"><div class="watermark-suits">♠ <span>♥</span> ♣ <span>♦</span></div><h2>好牌，始于一手。</h2><p>${E.bossFor(state) ? '按手牌上方规则选择，再点击出牌' : '选择 1–5 张牌，打出你的第一个组合'}</p><div class="watermark-line"><span></span> PLAY YOUR HAND <span></span></div></div>`;
  if (state.phase === 'roundWon' && !scoring) { const p = E.payout(state); center = `<div class="result-panel win-panel"><span class="result-eyebrow">BLIND CLEARED</span><h2>漂亮，盲注击破！<span>✦</span></h2><p class="result-score">${E.format(state.score)} <small>/ ${E.format(E.targetFor(state))}</small></p><div class="payout-lines"><span>盲注奖励 <b>🪙${p.blind}</b></span><span>剩余出牌 <b>🪙${p.hands}</b></span><span>利息 <small>每 🪙5 获得 🪙1，最多 🪙${rulesFor(state).interestCap}</small><b>🪙${p.interest}</b></span></div><button class="button gold-button wide-button" data-action="cashout">领取 🪙${p.total} ${icon('arrow')}</button></div>`; }
  if (state.phase === 'lost') center = `<div class="result-panel"><span class="result-eyebrow">RUN OVER</span><h2>下一手，会更好。</h2><p>出牌机会用完了。换个构筑，再试一次。</p><div class="run-summary"><span>到达底注 <b>${state.ante}</b></span><span>最佳单手 <b>${E.format(state.bestHand)}</b></span><span>累计得分 <b>${E.format(state.totalScore)}</b></span></div><button class="button coral-button wide-button" data-action="restart">再来一局 ${icon('reset')}</button><button class="text-button" data-action="breakdown">查看最后一手计分</button></div>`;
  if (state.phase === 'victory') center = `<div class="result-panel win-panel"><span class="result-eyebrow">YOU DID IT · ANTE ${modeRulesFor(state).antes}</span><h2>这副牌，你说了算。<span>✦</span></h2><p>${t(modeFor(state).name)} · ${state.ante} ${t('底注通关！')}</p><div class="run-summary"><span>最佳单手 <b>${E.format(state.bestHand)}</b></span><span>累计出牌 <b>${state.totalHands}</b></span><span>累计得分 <b>${E.format(state.totalScore)}</b></span></div><button class="button gold-button wide-button" data-action="endless">继续无尽模式 ${icon('arrow')}</button><button class="text-button" data-action="restart">开始新的一局</button></div>`;
  if (scoring) center = `<div class="played-hand"><div class="played-label">${last.name}<span>Lv.${E.handLevel(state,last.id)}</span></div><div class="played-cards">${playedCards.map((c, i) => playingCard(c, { dim: !last.scoringIds.includes(c.id), index: i })).join('')}</div>${renderScoring()}</div>`;
  return `<div class="arena-topline"><span>${scoring ? '正在计分…' : state.phase === 'playing' ? 'THE TABLE' : 'ROUND RESULT'}</span>${E.bossFor(state) ? `<span class="boss-hint">${E.bossFor(state).icon} ${E.bossFor(state).name} · Boss</span>` : `<span>底注 ${state.ante} <i>·</i> ${blindName()}</span>`}</div><div class="arena-content">${center}</div>`;
}
function renderBlindSelection() {
  return `<div class="arena-topline"><span>CHOOSE YOUR BLIND</span><span>底注 ${state.ante} <i>·</i> 蓄势待发</span></div><div class="blind-selection"><div class="section-intro"><span class="eyebrow">${modeFor(state).name} · 每一轮，新的可能</span><h2>${state.round === 1 ? '入座，打出你的王牌。' : '准备好下一场挑战了吗？'}</h2><p>${state.round === 1 ? '从一副普通扑克牌开始，构筑不普通的胜利。' : '收集筹码，突破目标，向下一底注前进。'}</p></div><div class="blind-choices">${[0, 1, 2].map(i => `<div class="blind-choice ${state.blindIndex === i ? 'current' : ''} ${i < state.blindIndex ? 'completed' : ''}"><span class="blind-choice-top">${i < state.blindIndex ? '已经过' : state.blindIndex === i ? '当前挑战' : '即将到来'}<span>0${i + 1}</span></span>${blindBadge(i, true)}<h3>${blindName(i)}</h3><span class="blind-target">${E.format(E.targetFor(state, i))}<small>筹码</small></span><p>${i === 2 ? E.bossFor({ ...state, blindIndex: 2 }).desc : `获胜奖励 🪙${i + 3}`}</p>${state.blindIndex === i ? `<button class="button ${i === 2 ? 'coral-button' : 'green-button'}" data-action="start">选择盲注 ${icon('arrow')}</button>${i < 2 ? `<button class="skip-button" data-action="skip">跳过 · 获得 🪙${rulesFor(state).skipReward} →</button>` : '<span class="no-skip">Boss 盲注不可跳过</span>'}` : `<div class="blind-locked">${i < state.blindIndex ? icon('check') + '已完成' : '等待解锁'}</div>`}</div>`).join('')}</div>${state.round === 1 ? `<div class="starter-tip">✦ <span><b>${modeFor(state).name}</b> · 每轮 ${rulesFor(state).hands} 次出牌、${rulesFor(state).discards} 次弃牌。小丑牌会在击败盲注后的商店出现。</span></div>` : ''}</div>`;
}
function sortedHand() {
  return state.hand.map(id => state.deck.find(c => c.id === id)).sort((a, b) => state.sort === 'suit' ? E.SUITS.findIndex(s => s.id === a.suit) - E.SUITS.findIndex(s => s.id === b.suit) || b.rank - a.rank : b.rank - a.rank || E.SUITS.findIndex(s => s.id === a.suit) - E.SUITS.findIndex(s => s.id === b.suit));
}
function renderHandRule() {
  const notice = renderRoundNotice();
  return `<div class="hand-rule-slot">${notice || `<div class="hand-rule-neutral">${icon('cards')}<span>${state.phase === 'playing' ? '点击或滑动选择 1–5 张牌，组合牌型达到目标分数。' : '本轮已结束，可在牌桌中央继续。'}</span></div>`}</div>`;
}
function renderHand() {
  const active = state.phase === 'playing' && !ranked?.finished && !scoring; const cards = selectedCards();
  const validation = cards.length && active ? E.playError(state, cards) : null;
  const preview = cards.length ? E.evaluateHand(state,cards) : null;
  return `<section class="hand-panel ${active ? '' : 'inactive-hand'}" aria-label="手牌"><div class="hand-toolbar"><div><span class="section-caption">你的手牌</span><b>${state.hand.length}<span> / ${E.handSize(state)}</span></b></div><div class="sort-control"><span>排序</span><button data-action="sort-rank" class="${state.sort === 'rank' ? 'active' : ''}" aria-pressed="${state.sort === 'rank'}">点数</button><button data-action="sort-suit" class="${state.sort === 'suit' ? 'active' : ''}" aria-pressed="${state.sort === 'suit'}">花色</button></div></div>${renderHandRule()}<div class="hand-and-deck"><div class="hand-cards" style="--hand-count:${state.hand.length}">${sortedHand().map((c, i) => playingCard(c, { selectable: active, index: i })).join('')}</div><button class="draw-deck" data-action="deck" aria-label="查看牌组，牌库剩余 ${state.drawPile.length} 张"><span class="deck-back"><i>✦</i></span><span><b>${state.drawPile.length}</b> / 52</span></button></div><div class="hand-actions"><div class="action-buttons"><button class="button blue-button" data-action="play" ${validation ? 'aria-describedby="play-warning"' : ''} ${!active || !cards.length || validation ? 'disabled' : ''}>出牌 <kbd>E</kbd></button><button class="button coral-button" data-action="discard" ${!active || !cards.length || !state.discards ? 'disabled' : ''}>弃牌 <kbd>D</kbd></button></div><div class="selection-hint">${cards.length ? `<b>${preview.name}</b><span>已选择 ${cards.length} / 5 张</span>` : '<span>点击或滑动选牌，最多 5 张</span>'}${cards.length ? '<button class="clear-selection" data-action="clear" title="取消选择">×</button>' : ''}</div></div></section>`;
}
function renderShop() {
  if (state.shop.pack) return `<div class="arena-topline"><span>BUFFOON PACK</span><span>小丑补充包</span></div><div class="pack-selection"><div class="section-intro"><span class="eyebrow">一点运气，更多可能</span><h2>选择你的下一张王牌。</h2><p>选择 1 张小丑牌加入构筑${state.jokers.length >= E.jokerSlots(state) ? '；槽位已满，请先点击上方的小丑出售一张' : ''}</p></div><div class="pack-cards">${state.shop.pack.map((id, i) => { const j = E.JOKERS.find(j => j.id === id); return `<div class="shop-item"><div class="shop-art" style="--jcolor:${j.color}">${art(j.art, j.color, 'pack' + i)}</div>${rarityBadge(j.rarity)}<h3>${j.name}</h3><p>${j.desc}</p><button class="button green-button" data-action="pack-pick" data-index="${i}" ${state.jokers.length >= E.jokerSlots(state) ? 'disabled' : ''}>选择这张 ${icon('check')}</button></div>`; }).join('')}</div><button class="text-button" data-action="pack-skip">跳过选择</button></div>`;
  const voucher = E.VOUCHERS.find(v => v.id === state.shop.voucher);
  return `<div class="arena-topline"><span>THE SHOP</span><span>给你的牌组，一点惊喜。</span></div><div class="shop-content"><div class="shop-heading"><div><span class="eyebrow">欢迎光临</span><h2>下一手，来点不一样的。</h2></div><button class="button green-button next-round" data-action="next">下一回合 ${icon('arrow')}</button></div><div class="shop-layout ${E.jokersOnly(state) ? 'jokers-only-shop' : ''}"><div class="shop-products">${state.shop.items.map((item, i) => { const info = E.itemInfo(item, state); return `<div class="shop-item ${item.sold ? 'sold' : ''}"><div class="shop-art" style="--jcolor:${info.color}">${art(info.art, info.color, 'shop' + i)}${item.sold ? `<span class="sold-stamp">${item.type === 'planet' ? '已升级' : '已售出'}</span>` : ''}</div>${rarityBadge(item.type === 'joker' ? info.rarity : item.type, item.type === 'joker' ? info.rarity + '小丑' : item.type === 'planet' ? '星球牌 · 立即生效' : '塔罗牌')}<h3>${info.name}</h3><p>${info.desc}</p><button class="button ${item.type === 'joker' ? 'gold-button' : 'muted-button'} buy-button" data-action="buy" data-index="${i}" ${item.sold || state.money < info.price || (item.type === 'joker' && state.jokers.length >= E.jokerSlots(state)) || (item.type === 'tarot' && state.consumables.length >= 2) ? 'disabled' : ''}>${item.sold ? '已购入' : `购买 <b>🪙${info.price}</b>`}</button></div>`; }).join('')}</div><div class="shop-extras">${E.jokersOnly(state) ? '' : `<div class="voucher-offer"><span class="eyebrow">VOUCHER</span><div class="voucher-graphic">✦</div><h3>${voucher ? voucher.name : '优惠券已兑换'}</h3><p>${voucher ? voucher.desc : '本轮的永久加成已收入囊中。'}</p><button class="button muted-button" data-action="voucher" ${!voucher || state.money < 10 ? 'disabled' : ''}>${voucher ? '兑换 🪙10' : '已兑换'}</button></div>`}<button class="booster-offer" data-action="booster" ${!state.shop.booster || state.money < rulesFor(state).boosterPrice ? 'disabled' : ''}><span class="mini-pack">✦</span><span><b>小丑补充包</b><small>${state.shop.booster ? `3 选 1 · 🪙${rulesFor(state).boosterPrice}` : '本轮已购买'}</small></span>${icon('chevron')}</button></div></div><div class="shop-footer"><button class="button muted-button" data-action="reroll" ${state.money < state.shop.rerollCost ? 'disabled' : ''}>${icon('shuffle')} 刷新商店 <b>🪙${state.shop.rerollCost}</b></button><span>✦ 小丑效果从左到右结算，点击卡牌可以调整顺序。</span></div></div>`;
}

function renderTutorial() {
  const model = tutorial, preview = tutorialScore(model), pair = ['S13', 'H13'], only = E.jokersOnly(model.state);
  const titles = ['选中两张 K，组成对子。', '只有参与牌型的牌提供点数筹码。', '把乘倍率放在加倍率右边，试着交换看看。', only ? '在商店购买小丑，继续组合你的构筑。' : '用资金升级牌型，让相同的牌打出更高分。'];
  const notes = ['点击两张点数相同的 K，再继续。每手最多选择 5 张牌。', '对子基础为 10 筹码 ×2 倍率；两张 K 各提供 10 筹码，所以得到 30 ×2 = 60 分。', only ? '半张小丑 +20 倍率，老千小丑在重复牌型时 ×3 倍率。本轮已打过对子，交换顺序比较得分。' : '微笑小丑 +4 倍率，黄金香蕉 ×3 倍率。小丑按从左到右结算。', only ? '六席牌型基础分固定。购买小丑增加倍率；商店可用金币刷新，也有 3 选 1 小丑补充包。这次练习不影响真实对局。' : '水星使对子永久提升一级；这次练习购买只影响教学，不会扣除你的真实资金。'];
  return `<div class="tutorial-progress" aria-label="教学进度">${TUTORIAL_STEPS.map((label, i) => `<span class="${model.step === i ? 'current' : model.step > i ? 'complete' : ''}" ${model.step === i ? 'aria-current="step"' : ''}>${i + 1} · ${label}</span>`).join('')}</div><h3 class="tutorial-title">${titles[model.step]}</h3><p class="tutorial-copy">${notes[model.step]}</p>${model.step < 2 ? `<div class="tutorial-hand">${model.state.hand.map(id => { const c = model.state.deck.find(c => c.id === id), selected = model.step === 0 ? model.state.selected.includes(id) : pair.includes(id), suit = E.SUITS.find(s => s.id === c.suit); return `<button class="playing-card ${suit.color} ${selected ? 'tutorial-selected' : ''}" data-action="tutorial-select" data-id="${c.id}" aria-label="${suit.name}${E.rankLabel(c.rank)}" aria-pressed="${selected}" ${model.step === 0 ? '' : 'disabled'}>${cardArtwork(c)}</button>`; }).join('')}</div>` : model.step === 2 ? `<div class="tutorial-jokers">${model.state.jokers.map((owned, i) => { const j = E.JOKERS.find(j => j.id === owned.id); return `<div>${art(j.art,j.color,'learn'+i)}<b>${j.name}</b><span>${j.desc}</span></div>`; }).join('')}</div><button class="button muted-button wide-button" data-action="tutorial-swap">交换小丑顺序 ↔</button>` : `<div class="tutorial-shop"><div>${art(only ? 'jester' : 'planet',only ? '#e77557' : '#8ca9a2','learnplanet')}</div><section><h3>${only ? '小丑' : '水星'}</h3><p>${only ? '+4 倍率' : '对子等级 +1'}</p><p>${t('持有金币')} <b>🪙${model.state.money}</b></p><button class="button gold-button" data-action="tutorial-buy" ${model.purchased ? 'disabled' : ''}>${model.purchased ? (only ? '已购入' : '已升级') : (only ? '购买 🪙2' : '购买 🪙3')}</button></section></div>`}<div class="tutorial-calculation" role="status"><span class="blue-text">${preview ? E.format(preview.chips) : '—'}</span><i>×</i><span class="red-text">${preview ? E.format(preview.mult) : '—'}</span><i>=</i><strong>${preview ? E.format(preview.total) : '—'}</strong></div><p class="tutorial-safe">教学使用独立练习牌，不影响存档或排行榜。</p><div class="tutorial-actions"><button class="text-button" data-action="close">跳过引导</button><button class="button green-button" data-action="tutorial-next" ${canAdvanceTutorial(model) ? '' : 'disabled'}>${model.step === 3 ? '完成，开始游玩' : '下一步 →'}</button></div>`;
}

function renderDifficultyPreview() {
  const preset = difficultyFor(draftDifficulty), preview = E.newRun('PREVIEW', currentRules, preset.id, draftMode), rules = rulesFor(preview);
  const weights = [rules.commonWeight, rules.uncommonWeight, rules.rareWeight], sum = weights.reduce((a, b) => a + b, 0);
  return `<p class="difficulty-description">${preset.description}</p>${E.jokersOnly(preview) ? '<p class="difficulty-footnote">六席专属目标已按无星球、塔罗和优惠券重新平衡。</p>' : ''}<div class="difficulty-resources"><span>初始资金 <b>🪙${preview.money}</b></span><span>每轮出牌 <b>${preview.hands}</b></span><span>每轮弃牌 <b>${preview.discards}</b></span></div><div class="difficulty-targets" aria-label="首底注目标">${[0, 1, 2].map((index) => `<span>${['小盲注', '大盲注', 'Boss'][index]}<b>${E.format(E.targetFor(preview, index))}</b></span>`).join('')}</div><div class="difficulty-jokers"><span>${'小丑出现概率'}</span>${weights.map((weight, i) => `${rarityBadge(['普通', '罕见', '稀有'][i])}<b>${(weight / sum * 100).toFixed(1)}%</b>`).join('')}</div><p class="difficulty-footnote">${preview.jokers.length ? preview.jokers.map(j => t(E.JOKERS.find(item => item.id === j.id).name)).join(' + ') : t('开局无小丑，在商店与补充包中获取。')}</p><details class="difficulty-curve"><summary>查看全部盲注目标</summary><table><thead><tr><th>底注</th><th>小盲注</th><th>大盲注</th><th>Boss</th></tr></thead><tbody>${Array.from({ length: modeRulesFor(preview).antes }, (_, i) => `<tr><th>${i + 1}</th>${[0, 1, 2].map(index => `<td>${E.format(E.targetFor({ ...preview, ante: i + 1 }, index))}</td>`).join('')}</tr>`).join('')}</tbody></table></details><p class="difficulty-footnote">本局难度固定；排行榜按玩法、难度与规则版本分别排名。</p>`;
}
function renderJokerCatalog() {
  if (draftMode!=='six-seat') return '';
  const pool=E.jokerPool(E.newRun('CATALOG',currentRules,draftDifficulty,draftMode));
  return `<details class="joker-catalog"><summary>查看六席 33 张小丑牌</summary><p>最多同时持有 6 张，通过商店与补充包获取。</p><p>以下为基础价格。</p><div>${pool.map(j=>`<article>${rarityBadge(j.rarity)}<strong>${t(j.name)}</strong><b>🪙${j.price}</b><p>${t(j.desc)}</p></article>`).join('')}</div><p>未列明的价格和随机参数采用 Web 版设定。</p></details>`;
}
function renderModePicker() { return `<fieldset class="game-mode-picker"><legend>选择玩法</legend><div class="game-mode-options">${MODES.map(m => `<button type="button" data-action="mode-choice" data-mode="${m.id}" aria-pressed="${m.id === draftMode}">${m.name}</button>`).join('')}</div><p id="game-mode-description">${modeFor(draftMode).description}</p><div id="mode-card-catalog">${renderJokerCatalog()}</div></fieldset>`; }
function regionLabel(network) {
  if (!network?.country) return '';
  let country = network.country;
  try { country = new Intl.DisplayNames([getLanguage() === 'zh' ? 'zh-CN' : 'en'], { type: 'region' }).of(country); } catch { /* country code fallback */ }
  return [country, network.region].filter(Boolean).join(' / ');
}
function renderDifficultyPicker() {
  return `<fieldset class="difficulty-picker"><legend>选择难度</legend><div class="difficulty-options">${DIFFICULTIES.map(d => `<button class="difficulty-option difficulty-${d.id}" type="button" data-action="difficulty-choice" data-difficulty="${d.id}" aria-pressed="${d.id === draftDifficulty}">${d.name}</button>`).join('')}</div><div id="difficulty-preview" aria-live="polite">${renderDifficultyPreview()}</div></fieldset>`;
}

function boardVersionOptions() {
  if (!board?.versions?.length) return '<option value="">当前规则</option>';
  return board.versions.map((version, index) => `<option value="${esc(version.id)}">${index === 0 ? t('当前') + ' · ' : ''}${new Date(version.created_at).toLocaleDateString(getLanguage() === 'zh' ? 'zh-CN' : 'en-US')} · ${esc(version.id.slice(0, 14))}</option>`).join('');
}
function renderBoardResults() {
  if (boardError) return `<p class="empty-board" role="alert">${esc(boardError)}<br><button class="text-button" data-action="board-refresh">重试</button></p>`;
  if (!board) return '<p class="empty-board">加载中…</p>';
  if (!board.entries.length) return '<p class="empty-board">暂无成绩，来创造第一条记录。</p>';
  const ranking = rankingFor(board.metric || boardMetric);
  return `<div class="leaderboard-table"><div class="leaderboard-row board-head"><span>#</span><span>玩家</span><span>${ranking.name}</span><span>底注</span><span>用时</span><span>完成时间</span></div>${board.entries.map(row => `<div class="leaderboard-row"><b class="rank-number">${row.rank}</b><span class="board-player"><span class="board-player-info"><span data-no-translate>${esc(row.displayName)}</span><small class="board-network" data-no-translate>${esc([row.network?.ip, row.network?.browser, regionLabel(row.network)].filter(Boolean).join(' · ') || t('未记录网络信息'))}</small></span></span><strong class="gold-text">${E.format(row[ranking.field])}</strong><span>${row.ante}</span><span class="board-duration">${formatDuration(row.durationMs)}</span><time title="${new Date(row.createdAt).toISOString()}">${new Date(row.createdAt).toLocaleString(getLanguage() === 'zh' ? 'zh-CN' : 'en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}</time></div>`).join('')}</div>`;
}
function renderBoardBody() {
  return `<div class="board-metrics" aria-label="排名类型">${RANKINGS.map(ranking => `<button data-action="board-metric" data-metric="${ranking.id}" aria-pressed="${ranking.id === boardMetric}">${ranking.name}</button>`).join('')}</div><div class="board-controls"><button class="button muted-button" data-action="board-all">全部时间</button><button class="button muted-button" data-action="board-daily">今日 UTC</button><label>玩法 <select id="board-mode">${MODES.map(mode => `<option value="${mode.id}">${mode.name}</option>`).join('')}</select></label><label>难度 <select id="board-difficulty">${DIFFICULTIES.map(difficulty => `<option value="${difficulty.id}">${difficulty.name}</option>`).join('')}</select></label><label>规则版本 <select id="board-version">${boardVersionOptions()}</select></label></div><p class="modal-subtitle">玩法、难度与规则版本分别排名；同分时先完成的对局优先。</p><div class="board-status-bar"><span id="board-status" role="status" aria-live="polite"></span><button class="text-button" data-action="board-refresh">刷新榜单</button></div><div id="board-results" class="board-results" aria-label="排名结果"></div><p id="board-limit" class="help-note"></p><p class="help-note board-timing-note">用时从开局计算至提交或结束，包含等待时间。</p>`;
}
function updateBoard() {
  const root = $('#modal-root .leaderboard-modal'); if (!root) return;
  for (const button of root.querySelectorAll('[data-action="board-metric"]')) button.setAttribute('aria-pressed', String(button.dataset.metric === boardMetric));
  for (const period of ['all', 'daily']) { const button = root.querySelector(`[data-action="board-${period}"]`); button.classList.toggle('chosen', boardPeriod === period); button.setAttribute('aria-pressed', String(boardPeriod === period)); }
  const version = root.querySelector('#board-version'), versionKey = JSON.stringify([getLanguage(), board?.versions || []]);
  if (version.dataset.versions !== versionKey) { version.innerHTML = boardVersionOptions(); version.dataset.versions = versionKey; localize(version); }
  for (const [id, value] of [['mode', boardMode], ['difficulty', boardDifficulty], ['version', boardVersion || board?.version || '']]) root.querySelector(`#board-${id}`).value = value;
  const results = root.querySelector('#board-results');
  results.setAttribute('aria-busy', String(boardLoading)); root.classList.toggle('board-loading', boardLoading);
  if (!boardLoading || !results.hasChildNodes()) { const scroll = results.scrollTop, restoreFocus = results.contains(document.activeElement); results.innerHTML = renderBoardResults(); localize(results); results.scrollTop = scroll; if (restoreFocus) root.querySelector('.board-status-bar [data-action="board-refresh"]').focus({ preventScroll: true }); }
  root.querySelector('#board-status').textContent = boardLoading ? t(board ? '正在更新…' : '加载中…') : boardError ? t('加载失败，请重试。') : '';
  for (const button of root.querySelectorAll('[data-action="board-refresh"]')) button.setAttribute('aria-disabled', String(boardLoading));
  root.querySelector('#board-limit').textContent = t(`每榜保留前 ${board?.limit || DEFAULT_RANKING_LIMIT} 名；进入任意一榜的对局才保留成绩。最多回合按到达回合计算。`);
}
function openModal(type, index) { if (modal?.type === 'leaderboard' && type !== 'leaderboard') { boardLoader.cancel(); boardLoading = false; } if (type === 'tutorial') tutorial = createTutorial(E.jokersOnly(state) ? 'six-seat' : 'classic'); if (type === 'restart') { draftDifficulty = difficultyFor(state).id; draftMode = 'classic'; } focusBeforeModal = document.activeElement?.closest('[data-popover-kind]')?.querySelector('[data-popover-trigger]') || document.activeElement; hideJokerPopover(); modal = { type, index }; renderModal(); requestAnimationFrame(() => $('#modal-root button, #modal-root input')?.focus()); }
function closeModal() { if (modal?.type === 'leaderboard') { boardLoader.cancel(); boardLoading = false; } if (modal?.type === 'tutorial') { settings.tutorialSeen = true; save(); tutorial = null; } const wasOpen = !!modal; modal = null; $('#modal-root').innerHTML = ''; if (wasOpen && focusBeforeModal?.isConnected) focusBeforeModal.focus(); }
function renderModal() {
  let title = '', body = '', wide = false;
  if (['audio', 'animation'].includes(modal.type)) { title = '游戏设置'; body = renderSettingsTabs() + (modal.type === 'audio' ? renderAudioSettings() : renderAnimationSettings()); }
  if (modal.type === 'tutorial') { title = '新手引导'; body = renderTutorial(); }
  if (modal.type === 'bonuses') { title = '加成清单'; body = renderBonuses(); }
  if (modal.type === 'profile') {
    title = '修改用户名';
    body = `<div class="profile-editor"><label class="seed-label" for="display-name-input">用户名</label><input id="display-name-input" class="seed-input" maxlength="24" autocomplete="nickname" value="${esc(profile?.displayName || '')}" placeholder="请输入 1–24 个字符" /></div><p class="help-note">已自动生成默认用户名，可随时修改；昵称可以重复。</p><p class="privacy-note">排行榜公开遮蔽后的 IP、浏览器与大致地区；完整 IP 仅管理员可见，网络信息保留 30 天。</p><button class="button green-button wide-button" data-action="save-profile">保存资料</button>`;
  }
  if (modal.type === 'leaderboard') { title = '排行榜'; wide = true; body = renderBoardBody(); }
  if (modal.type === 'submit-run') { title = '结束并提交成绩'; body = '<p class="modal-subtitle">此操作结束当前上榜对局，提交最佳单手、累计得分和到达回合；进入任意一榜才保留成绩。</p><button class="button gold-button wide-button" data-action="finish">确认提交</button>'; }
  if (modal.type === 'help') { title = '一手好牌，无限可能。'; body = `<div class="help-lead">欢迎来到牌序。用普通扑克，构筑不普通的胜利。</div><button class="button gold-button wide-button" data-action="tutorial">体验新手引导</button><div class="help-step"><b>01</b><div><h3>组合牌型，达到目标</h3><p>点击选择 1–5 张手牌，组成对子、同花、顺子等牌型。出牌次数遵循本局规则；总分达到盲注目标即获胜。</p></div></div><div class="help-step"><b>02</b><div><h3>筹码 × 倍率 = 得分</h3><p>牌型提供基础筹码和倍率；参与计分的牌再增加点数筹码。A = 11，J/Q/K = 10，其余按点数计算。未参与牌型的牌会消耗，但不计分。</p></div></div><div class="help-step"><b>03</b><div><h3>用弃牌寻找更好的组合</h3><p>弃牌次数遵循本局规则，每次可换掉 1–5 张牌。所有打出、弃掉的牌在本轮不再回来，下一轮重洗整副牌。</p></div></div><div class="help-step"><b>04</b><div><h3>逛商店，让得分飞起来</h3><p>盲注奖励、剩余出牌和利息提供资金。${E.jokersOnly(state) ? '商店每次随机提供 3 张小丑牌，可消耗金币刷新，也可购买 3 选 1 小丑补充包。牌型基础分固定，小丑效果从左到右结算。' : '购买小丑叠加效果、星球升级牌型，塔罗改造手牌。小丑的加倍率和乘倍率按从左到右结算，通常把乘倍率放在右侧更好。'}</p></div></div><div class="help-step"><b>05</b><div><h3>${t(modeFor(state).name)} · ${modeRulesFor(state).antes} ${t('底注')}</h3><p>${modeFor(state).description}</p><p>每底注有小盲注、大盲注和带特殊规则的 Boss。小、大盲注可跳过并领取配置的奖励；Boss 必须击败。离线练习通关后可继续无尽模式。</p></div></div><div class="help-note">${E.jokersOnly(state) ? t('六席玩法包含 33 种小丑、6 个槽位与 7 个 Boss 规则；没有星球、塔罗或优惠券。') : `本版包含 ${E.jokerPool(state).length} 种小丑、9 种星球升级、4 种塔罗、3 种优惠券与 8 个 Boss 规则。`}进度保存在此浏览器。</div><button class="button green-button wide-button" data-action="close">入座吧 ${icon('arrow')}</button>`; }
  if (modal.type === 'hands') { title = '每一种牌型，都是一种可能。'; wide = true; body = `<p class="modal-subtitle">${E.jokersOnly(state) ? '六席牌型基础分固定，通过小丑组合提高得分。' : '本局的牌型等级与基础得分 · 星球牌可以永久升级'}</p><div class="hands-table"><div class="hands-table-head"><span>${E.jokersOnly(state) ? '牌型' : '牌型 / 星球'}</span><span>等级</span><span>筹码</span><span>倍率</span><span>组合示例</span></div>${Object.entries(E.HANDS).reverse().map(([id, h]) => { const base = E.handBase(state, id); return `<div class="hand-table-row"><span title="${h.description}"><b>${h.name}</b>${E.jokersOnly(state) ? '' : `<small>${h.planet}</small>`}</span><span class="level-badge">Lv.${E.handLevel(state,id)}</span><span class="blue-text">${base.chips}</span><span class="red-text">${base.mult}</span><span class="hand-example">${h.example}</span></div>`; }).join('')}</div><p class="help-note">只有组成牌型的牌计分。例如选择 K、K、9、6、2，只有两张 K 提供点数筹码。A2345 是有效顺子。</p>`; }
  if (modal.type === 'deck') { title = '你的牌组'; wide = true; const inRound = ['playing', 'roundWon', 'lost'].includes(state.phase); body = `<p class="modal-subtitle">52 张牌${E.jokersOnly(state) ? '' : ` · ${state.deck.filter(c => c.enhancement).length} 张增强牌`}${inRound ? ` · 牌库 ${state.drawPile.length} 张 · 手中 ${state.hand.length} 张` : ' · 每轮开始时重新洗牌'}</p><div class="deck-browser">${E.SUITS.map(s => `<div class="deck-suit-row"><span class="${s.color === 'red' ? 'red-text' : ''}">${s.symbol}</span><div>${state.deck.filter(c => c.suit === s.id).sort((a, b) => b.rank - a.rank).map(c => playingCard(c, { mini: true, dim: inRound && !state.drawPile.includes(c.id) && !state.hand.includes(c.id) })).join('')}</div></div>`).join('')}</div><p class="help-note">${E.jokersOnly(state) ? '变淡的牌已在本轮打出或弃掉，下一轮重新洗牌。' : '变淡的牌已在本轮打出或弃掉。增强和点数变化会保留到下一轮。'}</p>`; }
  if (modal.type === 'restart') { title = '准备一场新的冒险。'; body = `<p class="modal-subtitle">${state.phase === 'lost' || state.phase === 'victory' ? '带着这一局的经验，再次出发。' : '新一局会替换当前的自动存档。'}</p><div class="run-setup-fields"><div><label class="seed-label" for="run-mode">模式</label><select id="run-mode" class="seed-input">${rankingEnabled ? `<option value="ranked" ${backendAvailable ? '' : 'disabled'} ${ranked && backendAvailable ? 'selected' : ''}>上榜对局</option>` : ''}<option value="practice" ${ranked && backendAvailable && rankingEnabled ? '' : 'selected'}>离线练习</option></select></div><div><label class="seed-label" for="seed-input">自定义种子 <small>可选</small></label><input id="seed-input" class="seed-input" maxlength="24" autocomplete="off" placeholder="留空以随机生成" ${ranked && backendAvailable && rankingEnabled ? 'disabled' : ''} /></div></div><p class="run-mode-note">${rankingEnabled ? '上榜对局使用服务器规则和自动存档，无法使用自定义种子。' : '排名已关闭，直接游玩即可。'}</p>${renderModePicker()}${renderDifficultyPicker()}<button class="button coral-button wide-button" data-action="new-run">开启新一局 ${icon('arrow')}</button>`; }
  if (modal.type === 'joker') {
    const owned = state.jokers[modal.index]; if (!owned) { closeModal(); return; } const j = E.JOKERS.find(j => j.id === owned.id); title = j.name;
    const canManage = ['blind', 'playing', 'shop'].includes(state.phase) && !ranked?.finished && !scoring;
    body = `<div class="detail-card">${art(j.art, j.color, 'detail')}</div>${rarityBadge(j.rarity, j.rarity + '小丑')}<p class="detail-description">${j.desc}</p>${renderJokerStatus(owned,modal.index)}<div class="joker-order"><button class="button muted-button" data-action="move-left" ${modal.index === 0 || !canManage ? 'disabled' : ''}>← 向左移</button><span>第 ${modal.index + 1} / ${state.jokers.length} 位</span><button class="button muted-button" data-action="move-right" ${modal.index === state.jokers.length - 1 || !canManage ? 'disabled' : ''}>向右移 →</button></div><p class="help-note">小丑从左到右结算。调整加倍率和乘倍率的顺序，可以改变最终得分。</p><button class="button coral-button wide-button" data-action="sell" ${!canManage ? 'disabled' : ''}>出售 <b>🪙${E.jokerSellPrice(state, j.id)}</b></button>`;
  }
  if (modal.type === 'consumable') {
    const card = E.TAROTS.find(t => t.id === state.consumables[modal.index]); if (!card) { closeModal(); return; }
    const canManage = ['blind', 'playing', 'shop'].includes(state.phase) && !ranked?.finished && !scoring;
    const error = E.tarotError(state, modal.index); title = card.name;
    body = `<div class="detail-card">${art(card.art, card.color, 'consumedetail')}</div>${rarityBadge('tarot', '塔罗牌')}<p class="detail-description">${card.desc}</p><p class="help-note">${error || (card.id === 'hermit' ? `现在使用可以获得 🪙${Math.min(20, state.money)}。` : '已选好手牌，可以使用。')}</p><button class="button green-button wide-button" data-action="use-tarot" ${!canManage || error ? 'disabled' : ''}>使用 ${icon('spark')}</button><button class="text-button" data-action="sell-tarot" ${!canManage ? 'disabled' : ''}>出售 🪙1</button>`;
  }
  if (modal.type === 'breakdown') { title = '这一手，如何得分。'; const last = state.lastPlay; body = last ? `<div class="breakdown-heading"><b>${last.name}</b><strong>+${E.format(last.total)}</strong></div><div class="breakdown-events">${last.events.map(e => `<div><span>${e.label}</span><b>${e.text}</b></div>`).join('')}</div><div class="breakdown-total">${E.format(last.chips)} 筹码 × ${E.format(last.mult)} 倍率 <b>= ${E.format(last.total)}</b></div>` : '<p class="modal-subtitle">打出第一手牌后，在这里查看完整计分过程。</p>'; }
  $('#modal-root').innerHTML = `<div class="modal-overlay" data-action="overlay-close"><section class="modal ${wide ? 'wide-modal' : ''} ${['audio', 'animation'].includes(modal.type) ? 'audio-modal' : modal.type === 'bonuses' ? 'bonuses-modal' : modal.type === 'restart' ? 'restart-modal' : modal.type === 'tutorial' ? 'tutorial-modal' : modal.type === 'leaderboard' ? 'leaderboard-modal' : ''}" role="dialog" aria-modal="true" aria-labelledby="modal-title"><div class="modal-header"><span class="eyebrow">${BRAND.wordmark} <i>✦</i></span><button class="icon-button" data-action="close" aria-label="关闭">${icon('close')}</button></div><h2 id="modal-title">${title}</h2><div class="modal-body">${body}</div></section></div>`;

  localize($('#modal-root')); decorateCoins($('#modal-root'));
  if (modal.type === 'leaderboard') updateBoard();
}

function update() { save(); render(); }
function selectCard(id) {
  if (state.phase !== 'playing' || ranked?.finished || busy || scoring || !state.hand.includes(id)) return;
  if (state.selected.includes(id)) state.selected = state.selected.filter(x => x !== id);
  else if (state.selected.length < 5) state.selected.push(id);
  else { toast('每次最多选择 5 张牌'); return; }
  sound(state.selected.includes(id) ? 'select' : 'deselect'); update();
}
async function handleAction(action, element) {
  const previousHand = [...state.hand];
  const index = Number(element?.dataset.index);
  const purchaseType = action === 'buy' ? state.shop?.items[index]?.type : '';
  const jokerIndex = element?.dataset.jokerIndex !== undefined ? Number(element.dataset.jokerIndex) : modal?.type === 'joker' ? modal.index : undefined;
  const consumableIndex = element?.dataset.consumableIndex !== undefined ? Number(element.dataset.consumableIndex) : modal?.type === 'consumable' ? modal.index : undefined;
  if (['sell', 'move-left', 'move-right'].includes(action) && (!Number.isInteger(jokerIndex) || !state.jokers[jokerIndex])) return;
  if (['use-tarot', 'sell-tarot'].includes(action) && (!Number.isInteger(consumableIndex) || !state.consumables[consumableIndex])) return;
  if (action === 'skip-animation') { if (scoreAnimation) { scoreAnimation.skip = true; scoreAnimation.resume?.(); } return; }
  if (action === 'fullscreen') {
    try { if (document.fullscreenElement) await document.exitFullscreen(); else await document.documentElement.requestFullscreen(); }
    catch { toast('此浏览器暂不支持全屏，请使用浏览器的全屏功能。'); }
    updateFullscreenButton(); return;
  }
  if (scoring) return;
  if (action === 'tutorial') { openModal('tutorial'); return; }
  if (action.startsWith('tutorial-') && tutorial) {
    if (action === 'tutorial-select') { selectTutorialCard(tutorial, element.dataset.id); sound('select'); }
    if (action === 'tutorial-next') { if (tutorial.step === 3 && canAdvanceTutorial(tutorial)) { closeModal(); toast('引导完成，开始你的第一局吧。'); return; } advanceTutorial(tutorial); }
    if (action === 'tutorial-swap') swapTutorialJokers(tutorial);
    if (action === 'tutorial-buy' && buyTutorialItem(tutorial)) sound('upgrade');
    renderModal();
    const selector = `[data-action="${action}"]${element?.dataset.id ? `[data-id="${element.dataset.id}"]` : ''}`;
    const target = document.querySelector(selector);
    (target && !target.disabled ? target : $('#modal-root [data-action="tutorial-buy"]:not(:disabled), #modal-root [data-action="tutorial-next"]:not(:disabled)'))?.focus({ preventScroll: true }); return;
  }
  if (['restart','profile','leaderboard'].includes(action)) { try { if (await refreshFeatures()) render(); } catch { /* Offline play remains available. */ } }
  if (['profile','leaderboard','submit-run','save-profile','finish'].includes(action) && !rankingEnabled) { toast('排名已关闭，直接游玩即可。'); return; }
  if (['new-run', 'practice', 'start', 'next', 'cashout', 'endless'].includes(action)) clearCelebration();
  if (action === 'settings-audio' || action === 'settings-animation') { modal.type = action === 'settings-audio' ? 'audio' : 'animation'; renderModal(); $(`[data-action="${action}"]`)?.focus(); return; }
  if (action === 'animation-preset') { settings.scoreDurationMs = normalizeScoreDuration(Number(element.dataset.duration)); savePreferences(); renderModal(); $(`[data-duration="${settings.scoreDurationMs}"]`)?.focus(); return; }
  if (action === 'choose-track') {
    if (!AUDIO_TRACKS.some(track => track.id === element.dataset.track)) return;
    settings.musicTrack = element.dataset.track; settings.musicEnabled = true; savePreferences();
    renderModal(); $(`[data-track="${settings.musicTrack}"]`)?.focus(); return;
  }
  if (action === 'preview-sfx') { sound(element.dataset.sfx); return; }
  if (action === 'play') { const error = E.playError(state, selectedCards()); if (error) { toast(error); return; } }
  if (action === 'language') { setLanguage(getLanguage() === 'zh' ? 'en' : 'zh'); render(); return; }
  if (action === 'profile') { try { await ensureProfile(); render(); openModal('profile'); } catch (error) { toast(error.message); } return; }
  if (action === 'submit-run') { openModal(action); return; }
  if (action === 'leaderboard') { boardDifficulty = difficultyFor(state).id; boardMode = modeFor(state).id; await loadBoard(); return; }
  if (action === 'board-metric') { const next = rankingFor(element.dataset.metric).id; if (next === boardMetric) return; boardMetric = next; await loadBoard(); return; }
  if (action === 'board-refresh') { if (!boardLoading) await loadBoard({ force: true }); return; }
  if (action === 'board-all' || action === 'board-daily') { const next = action === 'board-all' ? 'all' : 'daily'; if (next === boardPeriod) return; boardPeriod = next; await loadBoard(); return; }
  if (action === 'mode-choice') {
    if (!MODES.some(m => m.id === element.dataset.mode)) return;
    draftMode = element.dataset.mode;
    for (const button of document.querySelectorAll('[data-action="mode-choice"]')) button.setAttribute('aria-pressed', String(button.dataset.mode === draftMode));
    $('#game-mode-description').textContent = t(modeFor(draftMode).description);
    $('#mode-card-catalog').innerHTML=renderJokerCatalog(); localize($('#mode-card-catalog')); decorateCoins($('#mode-card-catalog'));
    $('#difficulty-preview').innerHTML = renderDifficultyPreview(); localize($('#difficulty-preview')); decorateCoins($('#difficulty-preview')); return;
  }
  if (action === 'difficulty-choice') {
    if (!DIFFICULTIES.some(d => d.id === element.dataset.difficulty)) return;
    draftDifficulty = element.dataset.difficulty;
    for (const button of document.querySelectorAll('[data-action="difficulty-choice"]')) button.setAttribute('aria-pressed', String(button.dataset.difficulty === draftDifficulty));
    $('#difficulty-preview').innerHTML = renderDifficultyPreview(); localize($('#difficulty-preview')); decorateCoins($('#difficulty-preview')); return;
  }
  if (action === 'save-profile') {
    if (busy) return; busy = true;
    try {
      const data = await api('/api/profile', 'POST', { displayName: $('#display-name-input').value }); profile = data.profile;
      closeModal(); update(); toast('已保存资料');
    } catch (error) { toast(error.message); } finally { busy = false; } return;
  }
  if (action === 'practice') { if (ranked) state = E.newRun(undefined, currentRules, difficultyFor(state).id, modeFor(state).id); ranked = null; rememberMode('practice'); closeModal(); update(); return; }
  if (action === 'new-run') {
    if (busy) return;
    if ($('#run-mode')?.value === 'ranked') { await startRanked(); return; }
    ranked = null; rememberMode('practice'); state = E.newRun($('#seed-input')?.value.trim().toUpperCase() || undefined, currentRules, draftDifficulty, draftMode); closeModal(); update(); return;
  }
  if (action === 'endless' && ranked) { state.seed = Math.random().toString(36).slice(2, 10).toUpperCase(); state.rng = E.hashSeed(state.seed); ranked = null; rememberMode('practice'); toast('无尽模式将转为离线练习，不再进入排行榜。'); }
  const serverActions = new Set(['start', 'skip', 'play', 'discard', 'cashout', 'next', 'buy', 'reroll', 'voucher', 'booster', 'pack-pick', 'pack-skip', 'sell', 'use-tarot', 'sell-tarot', 'move-left', 'move-right', 'finish']);
  if (ranked && serverActions.has(action)) {
    if (busy || ranked.finished) return;
    busy = true;
    try {
      const previousScore = state.score;
      const cardIndex = ['sell', 'move-left', 'move-right'].includes(action) ? jokerIndex : ['use-tarot', 'sell-tarot'].includes(action) ? consumableIndex : index;
      const data = await api(`/api/runs/${ranked.id}/actions`, 'POST', { revision: ranked.revision, action, cards: [...state.selected], ...(Number.isInteger(cardIndex) ? { index: cardIndex } : {}) });
      if (typeof data.rankingEnabled === 'boolean') rankingEnabled = data.rankingEnabled;
      const sort = state.sort; ranked = data.run; state = ranked.state; state.sort = sort; rememberMode('ranked');
      if (['sell', 'use-tarot', 'sell-tarot', 'finish'].includes(action)) closeModal();
      if (['sell', 'use-tarot', 'sell-tarot'].includes(action)) hideJokerPopover();
      if (['move-left', 'move-right'].includes(action)) {
        const moved = jokerIndex + (action === 'move-left' ? -1 : 1);
        if (modal?.type === 'joker') modal.index = moved;
        else jokerPopoverIndex = moved;
      }
      const dealt = state.hand.filter(id => !previousHand.includes(id)).length;
      if (action === 'play') await animateScoring(previousScore, dealt);
      else { actionSound(action, purchaseType, dealt); update(); }
      if (data.submitted) toast('成绩已提交');
      else if(data.run.rankingStatus==='outside_top') toast(`未进入任意榜单前 ${data.run.rankingLimit} 名，本局成绩不保留。`);
    } catch (error) { toast(error.message); if (error.code === 'revision_conflict') { try { const data = await api(`/api/runs/${ranked.id}`); ranked = data.run; state = ranked.state; update(); } catch { /* leave saved state for retry */ } } }
    finally { busy = false; } return;
  }
  if (action === 'select') { selectCard(element.dataset.id); return; }
  if (action === 'start') { if (E.startBlind(state)) { actionSound('start'); update(); } return; }
  if (action === 'skip') { if (E.skipBlind(state)) { sound('buy'); toast(`经济标签：获得 🪙${rulesFor(state).skipReward}`); update(); } return; }
  if (action === 'play') {
    if (state.phase !== 'playing') return;
    const previousScore = state.score;
    const result = E.playHand(state); if (result.error) { toast(result.error); return; }
    await animateScoring(previousScore, state.hand.filter(id => !previousHand.includes(id)).length); return;
  }
  if (action === 'discard') { if (E.discard(state)) { actionSound('discard', '', state.hand.filter(id => !previousHand.includes(id)).length); update(); } return; }
  if (action === 'clear') { state.selected = []; update(); return; }
  if (action === 'sort-rank' || action === 'sort-suit') { state.sort = action === 'sort-rank' ? 'rank' : 'suit'; sound('sort'); update(); return; }
  if (action === 'cashout') { if (E.cashOut(state)) { sound('buy'); update(); } return; }
  if (action === 'next') { if (E.nextBlind(state)) { sound('click'); update(); } return; }
  if (action === 'endless') { if (state.phase !== 'victory') return; state.endless = true; state.phase = 'shop'; E.createShop(state); update(); return; }
  if (action === 'buy') { const error = E.buyItem(state, index); if (error) toast(error); else { actionSound('buy', purchaseType); toast('已购入，构筑更进一步。'); update(); } return; }
  if (action === 'reroll') { if (E.reroll(state)) { sound('shuffle'); update(); } return; }
  if (action === 'voucher') { if (E.buyVoucher(state)) { sound('upgrade'); toast('永久加成已获得，下一盲注生效。'); update(); } return; }
  if (action === 'booster') { if (E.buyBooster(state)) { sound('pack'); update(); } return; }
  if (action === 'pack-pick') { if (E.chooseBooster(state, index)) { sound('buy'); update(); } return; }
  if (action === 'pack-skip') { if (state.phase === 'shop' && state.shop.pack) { state.shop.pack = null; update(); } return; }
  if (['help', 'hands', 'deck', 'restart', 'breakdown', 'audio'].includes(action)) { openModal(action); return; }
  if (action === 'joker') { if (hasHover()) showJokerPopover(index); else openModal(action, index); return; }
  if (action === 'bonuses') { if (hasHover()) showInventoryPopover('bonus', 0); else openModal('bonuses'); return; }
  if (action === 'bonus-details') { openModal('bonuses'); return; }
  if (action === 'consumable') { if (hasHover()) showInventoryPopover('consumable', index); else openModal(action, index); return; }
  if (action === 'close' || action === 'overlay-close') { closeModal(); return; }
  if (action === 'sell') { if (E.sellJoker(state, jokerIndex)) { hideJokerPopover(); closeModal(); sound('sell'); update(); } return; }
  if (action === 'move-left' || action === 'move-right') {
    if (!['blind', 'playing', 'shop'].includes(state.phase)) return;
    const i = jokerIndex, j = i + (action === 'move-left' ? -1 : 1);
    if (j < 0 || j >= state.jokers.length) return;
    [state.jokers[i], state.jokers[j]] = [state.jokers[j], state.jokers[i]];
    if (modal?.type === 'joker') modal.index = j; else jokerPopoverIndex = j;
    sound('sort'); update(); return;
  }
  if (action === 'use-tarot') { const error = E.useTarot(state, consumableIndex); if (error) toast(error); else { hideJokerPopover(); closeModal(); sound('tarot'); update(); toast('塔罗牌已生效'); } return; }
  if (action === 'sell-tarot') { if (E.jokersOnly(state) || !['blind', 'playing', 'shop'].includes(state.phase)) return; state.consumables.splice(consumableIndex, 1); state.money++; hideJokerPopover(); closeModal(); sound('sell'); update(); return; }
  if (action === 'seed') { try { await navigator.clipboard.writeText(state.seed); toast('种子已复制：' + state.seed); } catch { toast('本局种子：' + state.seed); } }
}
document.addEventListener('pointerover', event => {
  const slot = event.target.closest('[data-popover-kind]');
  if (slot && !slot.contains(event.relatedTarget)) showInventoryPopover(slot.dataset.popoverKind, Number(slot.dataset.popoverIndex));
  else if (slot) clearTimeout(jokerPopoverTimer);
});
document.addEventListener('pointerout', event => {
  const slot = event.target.closest('[data-popover-kind]');
  if (!slot || slot.contains(event.relatedTarget)) return;
  const index = Number(slot.dataset.popoverIndex);
  const kind = slot.dataset.popoverKind;
  jokerPopoverTimer = setTimeout(() => {
    if (isPopoverOpen(kind, index) && !slot.contains(document.activeElement)) hideJokerPopover();
  }, 180);
});
document.addEventListener('focusin', event => {
  const slot = event.target.closest('[data-popover-kind]');
  if (slot && !suppressJokerFocus) showInventoryPopover(slot.dataset.popoverKind, Number(slot.dataset.popoverIndex));
});
document.addEventListener('focusout', event => {
  const slot = event.target.closest('[data-popover-kind]');
  if (slot && !slot.contains(event.relatedTarget) && !slot.matches(':hover') && isPopoverOpen(slot.dataset.popoverKind, Number(slot.dataset.popoverIndex))) hideJokerPopover();
});
document.addEventListener('pointerdown', event => {
  if ((jokerPopoverIndex !== null || consumablePopoverIndex !== null || bonusPopoverOpen) && !event.target.closest('[data-popover-kind]')) hideJokerPopover();
});
window.addEventListener('resize', () => hideJokerPopover());
document.addEventListener('fullscreenchange', updateFullscreenButton);
const unlockAudio = () => { if (!audio.unlocked || audio.context?.state !== 'running') void audio.unlock(); };
// Touch browsers may only grant audio activation at the end of a tap or click.
for (const event of ['pointerdown', 'pointerup', 'touchend', 'click']) document.addEventListener(event, unlockAudio, { capture: true, passive: true });
document.addEventListener('keydown', event => { if (!event.metaKey && !event.ctrlKey && !event.altKey) unlockAudio(); }, { capture: true });
document.addEventListener('visibilitychange', () => { audio.visibility(document.hidden).then(updateAudioStatus); });
window.addEventListener('pageshow', () => { audio.visibility(document.hidden).then(updateAudioStatus); });
bindSwipeSelection({
  canSelect: () => state.phase === 'playing' && !ranked?.finished && !busy && !scoring && !modal,
  onPaint: (ids, selecting) => {
    const next = paintSelection(state.selected, ids.filter(id => state.hand.includes(id)), selecting);
    if (next.join(',') === state.selected.join(',')) return;
    state.selected = next; sound(selecting ? 'select' : 'deselect'); update();
  },
});
document.addEventListener('click', event => {
  const element = event.target.closest('[data-action]'); if (!element || element.disabled) return;
  if (element.dataset.action === 'overlay-close' && event.target !== element) return;
  if (!['select', 'tutorial-select', 'tutorial-buy', 'play', 'discard', 'start', 'buy', 'sell', 'sell-tarot', 'use-tarot', 'reroll', 'booster', 'voucher', 'pack-pick', 'preview-sfx', 'sort-rank', 'sort-suit', 'move-left', 'move-right', 'cashout', 'skip'].includes(element.dataset.action)) sound('click');
  handleAction(element.dataset.action, element).catch(error => toast(error.message));
});
document.addEventListener('input', event => {
  if (event.target.id === 'score-duration') { settings.scoreDurationMs = normalizeScoreDuration(Number(event.target.value) * 1000); savePreferences(); event.target.nextElementSibling.textContent = durationLabel(settings.scoreDurationMs); for (const button of document.querySelectorAll('[data-action="animation-preset"]')) button.setAttribute('aria-pressed', String(Number(button.dataset.duration) === settings.scoreDurationMs)); return; }
  const field = { 'music-volume': 'musicVolume', 'effects-volume': 'effectsVolume' }[event.target.id]; if (!field) return;
  settings[field] = Number(event.target.value) / 100; savePreferences();
  event.target.nextElementSibling.textContent = `${event.target.value}%`;
});
document.addEventListener('change', async event => {
  const audioField = { 'music-enabled': 'musicEnabled', 'effects-enabled': 'sound' }[event.target.id];
  if (audioField) {
    settings[audioField] = event.target.checked; savePreferences();
    for (const button of document.querySelectorAll('[data-action="preview-sfx"]')) button.disabled = !settings.sound;
    return;
  }
  if (event.target.id === 'run-mode') { $('#seed-input').disabled = event.target.value === 'ranked'; return; }
  if (event.target.id === 'board-mode') { boardMode = event.target.value; await loadBoard(); return; }
  if (event.target.id === 'board-difficulty') { boardDifficulty = event.target.value; await loadBoard(); return; }
  if (event.target.id === 'board-version') { boardVersion = event.target.value; await loadBoard(); return; }

});
document.addEventListener('keydown', event => {
  if (scoring) { if (event.key === 'Escape') { event.preventDefault(); handleAction('skip-animation'); } return; }
  if ((jokerPopoverIndex !== null || consumablePopoverIndex !== null || bonusPopoverOpen) && event.key === 'Escape') { event.preventDefault(); hideJokerPopover(true); return; }
  if (event.target.closest('[data-popover-panel]')) return;
  if (modal) {
    if (event.key === 'Escape') { event.preventDefault(); closeModal(); }
    if (event.key === 'Tab') { const focusable = [...document.querySelectorAll('#modal-root button:not(:disabled), #modal-root input:not(:disabled), #modal-root select:not(:disabled), #modal-root summary')]; const first = focusable[0], last = focusable.at(-1); if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); } else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); } }
    if (event.key === 'Enter' && event.target.id === 'seed-input') handleAction('new-run');
    return;
  }
  if (event.ctrlKey || event.metaKey || event.altKey || /INPUT|TEXTAREA|SELECT/.test(event.target.tagName)) return;
  const key = event.key.toLowerCase();
  if (['e', 'd', 'r', 'escape'].includes(key) && state.phase === 'playing') { event.preventDefault(); handleAction({ e: 'play', d: 'discard', r: state.sort === 'rank' ? 'sort-suit' : 'sort-rank', escape: 'clear' }[key]); }
});
render();
save();
async function boot() {
  try {
    await refreshFeatures();
    let savedId, mode; try { savedId = localStorage.getItem('paixu-web.ranked-id'); mode = localStorage.getItem('paixu-web.mode'); } catch { /* optional */ }
    if (rankingEnabled || mode === 'ranked') await ensureProfile();
    if (profile && mode === 'ranked') {
      try { const data = await api(savedId ? `/api/runs/${savedId}` : '/api/runs/current'); if (data.run) { hadSavedRun = true; ranked = data.run; state = ranked.state; } else rememberMode('practice'); }
      catch (error) { if (error.status !== 404) throw error; ranked = null; rememberMode('practice'); state = E.newRun(undefined, currentRules); }
    }
    update();
  } catch { backendAvailable = false; render(); }
  if (!modal && shouldOfferTutorial(settings.tutorialSeen, hadSavedRun)) openModal('tutorial');
}
window.addEventListener('focus', () => { if (backendAvailable && !scoring && !modal) refreshFeatures().then(changed => { if (changed) render(); }).catch(() => {}); });
boot();
