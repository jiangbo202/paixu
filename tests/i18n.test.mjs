import test from 'node:test';
import assert from 'node:assert/strict';
import { t, setLanguage } from '../i18n.js';
import { JOKERS, TAROTS, VOUCHERS, BOSSES, HANDS } from '../engine.js';
test('all game metadata has English translations and Chinese can be restored', () => {
  setLanguage('en');
  for (const item of [...JOKERS, ...TAROTS, ...VOUCHERS, ...BOSSES, ...Object.values(HANDS)]) for (const key of ['name', 'desc', 'description', 'planet']) if (item[key]) assert.doesNotMatch(t(item[key]), /[\u3400-\u9fff]/, item[key]);
  assert.equal(t('已选择 3 / 5 张'), '3 / 5 selected');
  assert.equal(t('查看牌组，牌库剩余 44 张'), 'View deck, 44 cards remaining');
  assert.equal(t('每 $5 获得 $1，最多 $5'), '1 coin per 5 held, capped at 5 coins');
  assert.doesNotMatch(t('绿色小丑：' + JOKERS.find(j => j.id === 'green').desc + '。点击管理'), /[\u3400-\u9fff]/);
  setLanguage('zh'); assert.equal(t('小盲注'), '小盲注');
});

test('tutorial and administration controls translate in both directions', () => {
  const copy=['牌序首页','牌序 · 扑克构筑','欢迎来到牌序。用普通扑克，构筑不普通的胜利。','六席玩法','六个小丑槽位，专注扑克牌与小丑组合。','新手引导','选出对子','看懂计分','组合小丑','商店升级','教学使用独立练习牌，不影响存档或排行榜。','站点设置','开启排名','成绩管理','资源用量','归档并清空榜单','排名已关闭，直接游玩即可。','尚未连接 Cloudflare Analytics','免费套餐额度参考 · Cloudflare 只读 API','Workers 请求（今日）','D1 行读（今日）','D1 行写（今日）','D1 数据库大小','本项目单库','本项目明细','开包','修改用户名','已自动生成默认用户名，可随时修改；昵称可以重复。','开启后自动生成默认用户名，可直接开始上榜对局，也可修改昵称。'];
  setLanguage('en'); for(const phrase of copy) assert.doesNotMatch(t(phrase),/[\u3400-\u9fff]/,phrase);
  setLanguage('zh'); for(const phrase of copy) assert.equal(t(phrase),phrase);
});

test('ranking metrics, quota messages and password forms are bilingual',()=>{
 const copy=['最佳单手','累计得分','最多回合','排名类型','当前规则','刷新榜单','排名结果','正在更新…','加载失败，请重试。','重试','每榜保留名额','修改密码','原密码','新密码','再次输入新密码','确认修改密码','密码已修改，请使用新密码重新登录。','新密码需 12–128 个字符。修改后所有管理员会话退出，请使用新密码登录。','每榜保留前 20 名；进入任意一榜的对局才保留成绩。最多回合按到达回合计算。','未进入任意榜单前 20 名，本局成绩不保留。'];
 setLanguage('en');for(const phrase of copy)assert.doesNotMatch(t(phrase),/[\u3400-\u9fff]/,phrase);
 setLanguage('zh');assert.equal(t('Current administrator password is incorrect'),'原管理员密码不正确。');
});

test('browser-only administrator setup is bilingual', () => {
  const copy = ['正在检查管理员状态…', '重新检查', '初始化管理员', '使用部署者设置的安装密钥，创建管理员密码。', '安装密钥', '管理员密码', '再次输入管理员密码', '创建管理员', '如何配置安装密钥', '尚未配置有效的安装密钥，请由部署者在控制台设置。', '密码需 12–128 个字符。初始化仅限一次；完成后使用管理员密码登录。', '管理员已创建，请使用新密码登录。安装密钥现已失效，可在 Cloudflare 控制台删除。'];
  setLanguage('en'); for (const phrase of copy) assert.doesNotMatch(t(phrase), /[\u3400-\u9fff]/, phrase);
  setLanguage('zh'); for (const phrase of copy) assert.equal(t(phrase), phrase);
  assert.equal(t('Invalid installation key'), '安装密钥错误。');
});
