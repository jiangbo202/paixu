import { BRAND, pageTitle } from './branding.js';
import { RANKINGS, MAX_RANKING_LIMIT } from './rankings.js';
import { MODES, modeFor } from './modes.js';
import { DEFAULT_RULES, RULE_BOUNDS, validateRules, DIFFICULTIES, difficultyFor } from './rules.js';
import { getLanguage, setLanguage, localize, t } from './i18n.js';
import { usageMeters } from './usage-view.js';
const root = document.querySelector('#admin-app');
const esc = value => String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
let access = null;
let config, site, usage, scores = [], message = '', authenticated = false, busy = false, tab = 'site', scoreMode = 'classic', scoreDifficulty = 'all', scoreView = 'current', scoreMetric = 'best', resetPending = false;
const labels = { startingMoney: '初始资金', hands: '出牌次数', discards: '弃牌次数', handSize: '手牌上限', targetScale: '目标分数系数', skipReward: '跳过奖励', interestCap: '利息上限', commonWeight: '普通权重', uncommonWeight: '罕见权重', rareWeight: '稀有权重', planetChance: '星球出现概率', priceScale: '商品价格系数', boosterPrice: '补充包价格', rerollPrice: '刷新起始价格' };
async function api(path, method = 'GET', body) {
  const response = await fetch(path, { method, credentials: 'same-origin', ...(body !== undefined ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) });
  const data = await response.json(); if (!response.ok) { const e = new Error(data.error || 'Request failed'); e.code = data.code; e.status = response.status; throw e; } return data;
}
const disabled = () => busy ? 'disabled' : '';
const metric = (label, value, unit = '') => `<div class="usage-metric"><span>${label}</span><strong>${typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString(getLanguage() === 'zh' ? 'zh-CN' : 'en-US', { maximumFractionDigits: 2 }) : '—'}<small>${unit}</small></strong></div>`;
const bytes = value => typeof value !== 'number' ? '—' : value < 1024 ? `${value} B` : value < 1024 ** 2 ? `${(value / 1024).toFixed(1)} KiB` : `${(value / 1024 ** 2).toFixed(2)} MiB`;
const usageNumber = value => typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString(getLanguage() === 'zh' ? 'zh-CN' : 'en-US', { maximumFractionDigits: 2 }) : '—';
const quotaBytes = value => value === null ? '—' : value < 1000 ? `${value} B` : value < 1000000 ? `${usageNumber(value / 1000)} KB` : `${usageNumber(value / 1000000)} MB`;
const refreshUsageButton = () => `<button class="button blue-button" data-action="refresh-usage" ${disabled()}>刷新用量</button>`;
function usageMeterContent(row, status) {
  const format = row.unit === 'bytes' ? quotaBytes : usageNumber;
  const label = t(row.label), value = `${format(row.value)} / ${format(row.limit)}`;
  const percent = row.percent === null ? t('暂无统计快照') : `${usageNumber(row.percent)}%`;
  return `<section class="usage-meter usage-meter-${row.level}"><div class="usage-meter-heading"><div><span id="usage-${row.id}">${label}</span><small class="usage-scope">${t(row.scope)}</small></div><strong data-no-translate>${value}</strong></div><div class="usage-track" role="progressbar" aria-labelledby="usage-${row.id}" aria-valuemin="0" aria-valuemax="100" ${row.percent === null ? '' : `aria-valuenow="${row.fill}"`} aria-valuetext="${esc(`${value} · ${percent}`)}" title="${esc(percent)}"><span class="usage-fill ${row.value > 0 ? 'has-usage' : ''}" style="width:${row.fill}%"></span></div>${row.value === null ? status(row.source) || '<p class="usage-unavailable">暂无统计快照</p>' : ''}${row.percent >= 100 ? '<small class="usage-limit-note">已达到或超过免费参考额度</small>' : ''}</section>`;
}
function usageContent() {
  if (!usage) return '<p class="empty-board">加载中…</p>';
  if (usage.environment === 'local') return `<div class="usage-notice"><h2>本地部署</h2><p>当前使用本地 SQLite，不产生 Cloudflare 资源用量。</p><strong>${t('数据库大小')} ${bytes(usage.localDatabaseBytes)}</strong></div>`;
  if (!usage.configured) return `<div class="usage-notice"><h2>尚未连接 Cloudflare Analytics</h2><p>部署者需配置只读统计凭据；未连接时不显示虚构用量。</p><p>${t('缺少配置')}：<code>${(usage.missing || []).map(esc).join(', ')}</code></p></div><div class="usage-actions">${refreshUsageButton()}</div>${usageSetup()}`;
  const errors = {
    analytics_permission: 'Cloudflare 拒绝访问：请检查令牌是否有效、包含 Account Analytics · Read 权限，并授权给当前账号。',
    analytics_account: '无法读取此账号，请核对 Account ID 与令牌授权的账号是否一致。',
    analytics_query: '统计查询与 Cloudflare 接口不兼容，请更新部署代码。',
    analytics_limit: '统计查询范围超出当前套餐限制。',
    analytics_rate_limit: 'Cloudflare 统计请求受到限流，请等待 5 分钟后重试。',
    analytics_timeout: '连接 Cloudflare 统计接口超时，请稍后重试。',
    analytics_unavailable: '暂时无法读取，请稍后重试。',
  };
  const status = data => data?.status === 'not_configured' ? '<p class="usage-unavailable">缺少资源标识配置</p>' : data?.status !== 'ok' ? `<p class="usage-unavailable">${t(errors[data?.error] || errors.analytics_unavailable)}${data?.httpStatus ? ` <small>HTTP ${esc(data.httpStatus)}${data.field ? ` · ${esc(data.field)}` : ''}</small>` : ''}</p>` : '';
  const w = usage.workers, d = usage.d1;
  return `<div class="usage-overview"><p class="usage-reference">免费套餐额度参考 · Cloudflare 只读 API</p><div class="usage-meter-list">${usageMeters(usage).map(row => usageMeterContent(row, status)).join('')}</div><div class="usage-timing"><span>更新于 <b>${esc(new Date(usage.periodEnd).toLocaleString())}</b></span><span>每日额度按 UTC 零点重置</span><span>缓存至 <b>${esc(new Date(usage.expiresAt).toLocaleTimeString())}</b></span></div><div class="usage-actions">${refreshUsageButton()}<p>未自动识别账号套餐；实际限制以 Cloudflare 控制台为准。</p></div></div><details class="usage-details"><summary>本项目明细</summary><div class="usage-cards"><section class="usage-card"><span class="eyebrow">WORKERS · UTC TODAY</span><h2>计算与请求</h2><code>${esc(usage.resources.worker)}</code>${status(w)}<div class="usage-metrics">${metric('本项目请求', w.requests)}${metric('本项目错误', w.errors)}${metric('CPU 中位数', w.cpuP50Us, ' μs')}${metric('账号总请求', w.accountRequests)}</div></section><section class="usage-card"><span class="eyebrow">D1 · UTC TODAY</span><h2>数据库</h2><code>${esc(usage.resources.database || t('未配置'))}</code>${status(d)}<div class="usage-metrics">${metric('本项目读取行', d.rowsRead)}${metric('本项目写入行', d.rowsWritten)}${metric('账号读取行', d.accountRowsRead)}${metric('账号写入行', d.accountRowsWritten)}</div><p>${t('最近存储快照')} <b>${bytes(usage.d1Storage.bytes)}</b></p>${status(usage.d1Storage)}</section></div><p class="help-note">Workers 与 D1 为今日 UTC；存储取最近 24 小时内最新快照。数据可能延迟或采样，未知值显示 —。</p><p class="help-note">账号总量包含其他项目。D1 进度条对照单库 500 MB 上限，账号免费总存储为 5 GB。缓存最长 5 分钟。</p><p class="usage-source-links"><a href="https://developers.cloudflare.com/workers/platform/limits/" target="_blank" rel="noopener noreferrer">Workers 额度说明 ↗</a><a href="https://developers.cloudflare.com/d1/platform/pricing/" target="_blank" rel="noopener noreferrer">D1 额度说明 ↗</a><a href="https://developers.cloudflare.com/d1/platform/limits/" target="_blank" rel="noopener noreferrer">D1 存储限制 ↗</a></p></details>${usageSetup()}`;
}
function usageSetup() {
  return `<details class="analytics-setup"><summary>连接说明</summary><p>在 Cloudflare 创建仅限目标账号的 Account Analytics · Read 令牌，通过 Secret 保存。</p><pre>npx wrangler secret put CF_ANALYTICS_TOKEN</pre><p>在 Wrangler 的 vars 中配置 CF_ACCOUNT_ID、CF_WORKER_NAME、CF_D1_DATABASE_ID 后重新部署。令牌不会显示在管理页面。</p><a class="text-button" href="https://developers.cloudflare.com/analytics/graphql-api/getting-started/authentication/api-token-auth/" target="_blank" rel="noopener noreferrer">Cloudflare 官方权限说明 ↗</a></details>`;
}
function panelContent() {
  if (tab === 'site') return `<section class="admin-panel"><span class="eyebrow">SITE SETTINGS</span><h1>站点设置</h1><form id="site-form"><label class="ranking-toggle"><div><strong>开启排名</strong><p>开启后自动生成默认用户名，可直接开始上榜对局，也可修改昵称。</p></div><input id="ranking-enabled" type="checkbox" ${site.rankingEnabled ? 'checked' : ''} ${disabled()} /></label><label class="ranking-limit-field" for="ranking-limit"><span>每榜保留名额</span><input id="ranking-limit" type="number" min="1" max="${MAX_RANKING_LIMIT}" step="1" value="${site.rankingLimit}" required ${disabled()} /></label><div class="admin-explanation"><p>默认 20 名，可设为 1–1000。按玩法、难度、规则版本、赛季及时间范围分别保留三类排名。</p><p>进入任意一榜才保留成绩。调小名额会立即删除不再入榜的记录；调大不会恢复已删除的成绩。</p><p>关闭时直接本地游玩，不创建玩家资料。历史成绩保留，重新开启后可查看。</p><p>已开始的服务器对局可继续，但关闭排名后不再上榜；再次开启也不会补交这些成绩。</p></div><button class="button gold-button" ${disabled()}>保存站点设置</button></form></section>`;
  if (tab === 'rules') return `<section class="admin-panel"><div class="admin-panel-heading"><div><span class="eyebrow">RULES & BALANCE</span><h1>游戏参数</h1></div><code>${esc(config.id)}</code></div><p class="modal-subtitle">同一规则版本内公平比较；已开始的对局保留原参数。</p><form id="rules-form"><div class="rules-grid">${Object.entries(RULE_BOUNDS).map(([key, [min, max, integer]]) => `<label for="rule-${key}"><span>${labels[key]}</span><input id="rule-${key}" name="${key}" type="number" value="${config.rules[key]}" min="${min}" max="${max}" step="${integer ? 1 : 0.01}" required /><small>${min} – ${max}</small></label>`).join('')}</div><div class="admin-form-actions"><button class="button gold-button" ${disabled()}>保存并应用新对局</button><button type="button" class="button muted-button" data-action="defaults" ${disabled()}>恢复默认值</button></div></form></section>`;
  if (tab === 'password') return `<section class="admin-panel"><span class="eyebrow">PASSWORD & SECURITY</span><h1>修改密码</h1><form id="password-form" class="password-form"><label for="current-password">原密码<input id="current-password" type="password" autocomplete="current-password" maxlength="256" required /></label><label for="new-password">新密码<input id="new-password" type="password" autocomplete="new-password" minlength="12" maxlength="128" required /></label><label for="confirm-password">再次输入新密码<input id="confirm-password" type="password" autocomplete="new-password" minlength="12" maxlength="128" required /></label><p class="help-note">新密码需 12–128 个字符。修改后所有管理员会话退出，请使用新密码登录。</p><button class="button gold-button" ${disabled()}>确认修改密码</button></form></section>`;
  if (tab === 'usage') return `<section class="admin-panel admin-usage"><div class="admin-panel-heading"><div><span class="eyebrow">CLOUDFLARE ANALYTICS</span><h1>资源用量</h1></div></div>${usageContent()}</section>`;
  return `<section class="admin-panel"><span class="eyebrow">LEADERBOARD CONTROL</span><h1>成绩管理</h1><p class="modal-subtitle">移除的成绩可恢复；归档成绩保留在历史记录中。按所选指标排序，最多显示 100 条。</p><div class="admin-score-controls"><label>排名类型<select id="score-metric" ${disabled()}>${RANKINGS.map(r => `<option value="${r.id}" ${scoreMetric===r.id ? 'selected' : ''}>${r.name}</option>`).join('')}</select></label><label>玩法<select id="score-mode" ${disabled()}><option value="all" ${scoreMode === 'all' ? 'selected' : ''}>全部玩法</option>${MODES.map(m => `<option value="${m.id}" ${scoreMode === m.id ? 'selected' : ''}>${m.name}</option>`).join('')}</select></label><label>难度<select id="score-difficulty" ${disabled()}><option value="all">全部难度</option>${DIFFICULTIES.map(d => `<option value="${d.id}" ${scoreDifficulty === d.id ? 'selected' : ''}>${d.name}</option>`).join('')}</select></label><label>记录范围<select id="score-view" ${disabled()}>${[['current','当前赛季'],['archived','已归档'],['all','全部记录']].map(([v,label]) => `<option value="${v}" ${scoreView === v ? 'selected' : ''}>${label}</option>`).join('')}</select></label><button class="button coral-button" data-action="request-reset" ${disabled()}>归档并清空榜单</button></div>${resetPending ? `<div class="reset-confirmation" role="alertdialog" aria-label="确认清空"><h2>确认清空当前榜单？</h2><p>${t('清空范围')}：<strong>${t(scoreMode === 'all' ? '全部玩法' : modeFor(scoreMode).name)} · ${t(scoreDifficulty === 'all' ? '全部难度' : difficultyFor(scoreDifficulty).name)}</strong> · ${t('三类排名、全部规则版本和时间范围')}</p><p>将开始新赛季，旧成绩保留在已归档记录中。清空前开始的对局不会进入新榜。</p><div><button class="button coral-button" data-action="confirm-reset" ${disabled()}>确认归档并清空</button><button class="button muted-button" data-action="cancel-reset" ${disabled()}>取消</button></div></div>` : ''}<p class="privacy-note">公开榜单显示遮蔽 IP、浏览器概要与大致地区；完整 IP 和浏览器信息仅管理员可见，30 天后自动清理。</p><div class="admin-scores-scroll"><table class="admin-scores"><thead><tr><th>玩家</th><th>玩法</th><th>难度</th><th>赛季</th><th>最佳单手</th><th>累计得分</th><th>最多回合</th><th>时间</th><th>IP</th><th>地区</th><th>浏览器</th><th>状态</th><th>操作</th></tr></thead><tbody>${scores.length ? scores.map(s => `<tr><td data-no-translate>${esc(s.display_name)}</td><td>${modeFor(s.mode).name}</td><td>${difficultyFor(s.difficulty).name}</td><td>${s.ranking_epoch}</td><td>${Math.round(s.best_hand).toLocaleString()}</td><td>${Math.round(s.total_score).toLocaleString()}</td><td>${s.rounds ?? '—'}</td><td>${esc(new Date(s.created_at).toLocaleString())}</td><td>${esc(s.ip || '—')}</td><td data-no-translate>${esc([s.country,s.region].filter(Boolean).join(' / ') || '—')}</td><td class="browser-cell" data-no-translate title="${esc(s.browser)}">${esc(s.browser || '—')}</td><td>${s.archived ? '已归档' : s.hidden ? '已移除' : '显示中'}</td><td>${s.archived ? '—' : `<button class="text-button" data-action="visibility" data-id="${s.run_id}" data-hidden="${s.hidden}" ${disabled()}>${s.hidden ? '恢复成绩' : '移除成绩'}</button>`}</td></tr>`).join('') : '<tr><td colspan="13">暂无成绩</td></tr>'}</tbody></table></div></section>`;
}
function accessContent() {
  if (!access) return `<section class="admin-login"><h1>管理后台</h1><p>正在检查管理员状态…</p><button class="button muted-button" data-action="refresh-access" ${disabled()}>重新检查</button></section>`;
  if (access.initialized) return `<section class="admin-login"><span class="eyebrow">OWNER ACCESS</span><h1>管理后台</h1><p>使用管理员密码或终端生成的管理员密钥登录。</p><form id="login-form"><label for="admin-key">管理员密码</label><input id="admin-key" type="password" autocomplete="current-password" maxlength="256" placeholder="输入管理员密码" required ${disabled()} /><p class="privacy-note">密码不会保存在浏览器存储中。</p><button class="button green-button wide-button" ${disabled()}>登录</button></form><p class="help-note">此页不展示或找回密码；丢失后需由部署者重置。</p></section>`;
  const instructions = `<details class="admin-setup-help" ${access.setupAvailable ? '' : 'open'}><summary>如何配置安装密钥</summary><ol><li>在 Cloudflare 控制台打开当前 Worker 的 Settings → Variables and Secrets。</li><li>新增 Secret，名称为 <code>ADMIN_SETUP_KEY</code>，值为密码管理器生成的 32–256 位随机字符串，不含空白字符。</li><li>点击 Deploy 保存部署，然后返回此页重新检查。</li></ol><p>Secret 保存后无法查看原文，请自行保存。也可由部署者运行 npm run admin:init 初始化。</p></details>`;
  const form = access.setupAvailable ? `<form id="setup-form" class="password-form"><label for="setup-key">安装密钥<input id="setup-key" type="password" autocomplete="off" minlength="32" maxlength="256" required ${disabled()} /></label><label for="setup-password">管理员密码<input id="setup-password" type="password" autocomplete="new-password" minlength="12" maxlength="128" required ${disabled()} /></label><label for="setup-confirm">再次输入管理员密码<input id="setup-confirm" type="password" autocomplete="new-password" minlength="12" maxlength="128" required ${disabled()} /></label><p class="help-note">密码需 12–128 个字符。初始化仅限一次；完成后使用管理员密码登录。</p><button class="button gold-button wide-button" ${disabled()}>创建管理员</button></form>` : '<p>尚未配置有效的安装密钥，请由部署者在控制台设置。</p>';
  return `<section class="admin-login admin-setup"><span class="eyebrow">FIRST-TIME SETUP</span><h1>初始化管理员</h1><p>使用部署者设置的安装密钥，创建管理员密码。</p>${form}${instructions}<button class="text-button" data-action="refresh-access" ${disabled()}>重新检查</button></section>`;
}
function render() {
  root.innerHTML = `<header class="admin-header"><a href="/" class="admin-brand">${BRAND.wordmark} <span>管理后台</span></a><div><button class="language-button" data-action="language">${getLanguage() === 'zh' ? 'EN' : '中文'}</button>${authenticated ? '<button class="button muted-button" data-action="logout">退出登录</button>' : '<a class="text-button" href="/">返回游戏</a>'}</div></header>${message ? `<p role="status" class="admin-message">${esc(t(message))}</p>` : ''}${!authenticated ? accessContent() : `<nav class="admin-tabs" aria-label="管理导航">${[['site','站点设置'],['rules','游戏参数'],['scores','成绩管理'],['usage','资源用量'],['password','修改密码']].map(([key,label]) => `<button data-action="tab" data-tab="${key}" aria-current="${tab === key ? 'page' : 'false'}" ${disabled()}>${label}</button>`).join('')}</nav>${panelContent()}`}`;
  localize(root); document.title = pageTitle(getLanguage(),t('管理后台'));
}
async function loadAccess() { access = await api('/api/admin/setup'); }
async function loadScores() { const data = await api(`/api/admin/scores?mode=${scoreMode}&difficulty=${scoreDifficulty}&view=${scoreView}&metric=${scoreMetric}`); scores = data.entries; if (site) site.epochs = data.epochs; }
async function refresh() { const [c, settings] = await Promise.all([api('/api/admin/config'), api('/api/admin/settings')]); config = c; site = settings; authenticated = true; await loadScores(); }
function failure(error) { if (error.status === 401) authenticated = false; message = error.message; }
root.addEventListener('submit', async event => {
  event.preventDefault(); if (busy) return; busy = true; message = '';
  try {
    if (event.target.id === 'setup-form') {
      const body = { setupKey: document.querySelector('#setup-key').value, newPassword: document.querySelector('#setup-password').value, confirmPassword: document.querySelector('#setup-confirm').value };
      event.target.reset();
      if (body.newPassword !== body.confirmPassword) throw new Error('New passwords do not match');
      root.querySelectorAll('#setup-form input, #setup-form button').forEach(el => { el.disabled = true; });
      await api('/api/admin/setup', 'POST', body);
      access = { initialized: true, setupAvailable: false };
      message = '管理员已创建，请使用新密码登录。安装密钥现已失效，可在 Cloudflare 控制台删除。';
    }
    else if (event.target.id === 'login-form') { const input = document.querySelector('#admin-key'); const key = input.value; input.value = ''; await api('/api/admin/login', 'POST', { key }); await refresh(); }
    else if (event.target.id === 'site-form') { site = await api('/api/admin/settings', 'PUT', { rankingEnabled: document.querySelector('#ranking-enabled').checked, rankingLimit: Number(document.querySelector('#ranking-limit').value), expectedRevision: site.revision }); message = '站点设置已保存。'; }
    else if(event.target.id==='password-form') { const currentPassword=document.querySelector('#current-password').value, newPassword=document.querySelector('#new-password').value, confirmPassword=document.querySelector('#confirm-password').value; event.target.reset(); if(newPassword!==confirmPassword) throw new Error('New passwords do not match'); await api('/api/admin/password','PUT',{currentPassword,newPassword,confirmPassword}); authenticated=false; scores=[]; usage=null; message='密码已修改，请使用新密码重新登录。'; }
    else { const rules = Object.fromEntries(new FormData(event.target).entries()); for (const key in rules) rules[key] = Number(rules[key]); validateRules(rules); config = await api('/api/admin/config', 'PUT', { rules, expectedVersion: config.id }); message = '配置已保存，仅对新对局生效。'; }
  } catch (error) { failure(error); if (event.target.id === 'setup-form' || error.code === 'admin_not_initialized') await loadAccess().catch(() => {}); else if (error.status === 409) await refresh().catch(failure); }
  finally { busy = false; render(); }
});
root.addEventListener('click', async event => {
  const el = event.target.closest('[data-action]'); if (!el || busy || el.disabled) return;
  const action = el.dataset.action;
  if (action === 'language') { setLanguage(getLanguage() === 'zh' ? 'en' : 'zh'); render(); return; }
  if (action === 'defaults') { for (const [key, value] of Object.entries(DEFAULT_RULES)) document.querySelector(`#rule-${key}`).value = value; return; }
  if (['request-reset', 'cancel-reset'].includes(action)) { resetPending = action === 'request-reset'; render(); return; }
  busy = true; message = '';
  try {
    if (action === 'refresh-access') await loadAccess();
    if (action === 'logout') { await api('/api/admin/logout', 'POST', {}); authenticated = false; usage = null; scores = []; }
    if (action === 'tab') { tab = el.dataset.tab; resetPending = false; if (tab === 'usage' && !usage) { render(); usage = await api('/api/admin/usage'); } if (tab === 'scores') await loadScores(); }
    if (action === 'refresh-usage') usage = await api('/api/admin/usage');
    if (action === 'visibility') { await api(`/api/admin/scores/${el.dataset.id}`, 'PATCH', { hidden: el.dataset.hidden === '0' }); await loadScores(); }
    if (action === 'confirm-reset') { const result = await api('/api/admin/leaderboard/reset', 'POST', { mode: scoreMode, difficulty: scoreDifficulty, epochs: site.epochs }); site.epochs = result.epochs; resetPending = false; message = '榜单已清空，历史成绩已归档。'; await loadScores(); }
  } catch (error) { failure(error); if (error.status === 409) { resetPending = false; await refresh().catch(failure); } }
  finally { busy = false; render(); }
});
root.addEventListener('change', async event => {
  if (!['score-mode','score-difficulty','score-view','score-metric'].includes(event.target.id) || busy) return;
  if (event.target.id === 'score-mode') scoreMode = event.target.value; else if (event.target.id === 'score-difficulty') scoreDifficulty = event.target.value; else if(event.target.id==='score-metric') scoreMetric=event.target.value; else scoreView = event.target.value;
  resetPending = false; busy = true; try { await loadScores(); } catch (error) { failure(error); } finally { busy = false; render(); }
});
render();
loadAccess().then(async () => { if (access.initialized) await refresh(); }).catch(error => { if (error.status !== 401) failure(error); }).finally(render);
