# 牌序 · PAIXU

[English](README.en.md) · [MIT 许可证](LICENSE) · [安全说明](SECURITY.md)

使用原生 HTML、CSS、JavaScript 编写的扑克 Roguelike 游戏，可在浏览器游玩，支持 Cloudflare Workers 和 Docker 部署。卡牌插画使用自行绘制的 CSS / SVG，音乐和音效由程序合成，不包含从原游戏提取的图片、音频或程序文件。

牌序是一款独立实现的扑克构筑游戏，与 Balatro、《潜水员戴夫》的权利方无关联、未获其认可或赞助。机制参考、第三方名称与授权范围见 [NOTICE.md](NOTICE.md)。

## 项目用途与权利声明

本项目是个人出于技术学习、编程实践和自娱自乐目的开发的**非盈利项目**，不以商业获利为目的。公开源码与演示页面用于分享个人实现和学习过程。

项目对外名称为 **牌序 · PAIXU**；游戏内的「小丑牌」等名称用于卡牌分类或机制说明。所提及的第三方游戏名称、商标及相关内容，其权利归各自权利人所有。维护者尊重原作及相关创作者的知识产权。

**个人娱乐、非盈利、开源及无关联声明均不构成第三方授权，也不当然免除侵权责任。** 具体内容是否涉及侵权，仍需结合使用方式、相关权利及适用法律判断。

### 版权反馈与删除请求

**如有侵权，请通过本仓库的 Issues 联系维护者，我们将及时核查，并删除或下架相关内容，必要时停止相关演示页面的展示。**

为便于定位和处理，请尽可能提供：

- 涉及的作品或权利，以及相关权利说明或来源链接；
- 本项目中对应的文件路径、页面地址或截图；
- 希望采取的处理方式，例如删除内容、停止展示或修正署名。

上述非盈利用途说明表达维护者的开发意图，**不修改 [MIT 许可证](LICENSE)，也不额外限制该许可证授予的权利**。MIT 仅适用于贡献者有权许可的项目内容，不授予任何第三方内容或商标的使用权；具体范围见 [NOTICE.md](NOTICE.md)。

## 功能

- **三种玩法**：经典玩法（默认）、短局挑战、六席玩法；每种可选简单 / 中等 / 困难 / 巨难。
- **无需注册**：默认关闭排名，首次访问可直接本地游玩。开启排名后自动生成默认用户名，可直接上榜，也可随时修改昵称。
- **服务端排名**：服务器发牌和计分，保存上榜对局进度，刷新可恢复；离线练习保存在本机浏览器。
- **三类榜单**：最佳单手 / 累计得分 / 最多回合，支持玩法、难度、规则版本、全部时间 / 今日 UTC 筛选。
- **桌面与手机**：单排手牌、滑动多选、固定前后层级；小丑、加成与消耗牌支持悬浮详情，触屏点击查看。
- **中英文**：首次按浏览器语言选择，可手动切换并保存。
- **声音与动画**：三首合成背景音乐、不同动作音效、可调计分动画（基础时长默认 3 秒，0–8 秒可调；逐步节奏固定，效果增多时延长播放）、达标彩纸效果，以及受浏览器支持限制的全屏模式。
- **排行榜交互**：筛选只更新榜单，保留弹窗位置和控件焦点；同一筛选结果缓存在内存中 30 秒，可点击「刷新榜单」立即获取最新成绩。
- **管理后台**：排名开关、榜单名额、成绩移除 / 恢复 / 归档清空、游戏参数、管理员密码修改、Cloudflare 用量。

## 本地运行

需要 **Node.js 22.13+**，推荐 Node.js 24。应用运行不依赖第三方 npm 包；Cloudflare 工具和 CI 使用 `npm ci` 安装锁定的开发依赖。

```sh
# 在下载或克隆后的项目目录中
npm run admin:init
npm run dev
```

访问 **http://127.0.0.1:5173**。管理页是 **/admin**，游戏导航不展示此入口；权限由服务端登录校验控制。

`admin:init` 只在首次安装时显示随机管理员密钥，务必自行保存。再次执行不会显示旧密钥。暂不初始化管理员也能直接运行游戏。

使用构建产物运行：

```sh
npm run build
npm start
```

快捷键：`E` 出牌，`D` 弃牌，`R` 排序，`Esc` 取消选择 / 关闭弹窗 / 跳过计分动画。

## 玩法

| 玩法 | 通关底注 | 小丑槽位 | 特点 |
| --- | --- | --- | --- |
| 经典玩法 | 8 | 5 | 26 种小丑、9 种星球、4 种塔罗、3 种优惠券 |
| 短局挑战 | 3 | 5 | 额外 4 金币，赠送微笑小丑，常规商品八折 |
| 六席玩法 | 5 | 6 | 33 种独立小丑，只用扑克牌与小丑构筑 |

六席没有星球、塔罗、加成牌或优惠券；商店每次随机提供 3 张小丑，可用金币刷新，也有 3 选 1 小丑补充包。包含幻视、笑脸、恐怖面孔、重复触发人头及四指等小丑。六席采用独立的 7 个 Boss 池，避免「植物 + 幻视」导致所有牌失效。

四档难度会调整目标、起始资源、小丑稀有度概率和目标增长。开局弹窗展示实际参数和各盲注目标。玩法、难度和规则在开局时固定；管理员调整参数只影响新对局。

首次访问会显示可跳过的新手引导，也可从「玩法帮助」重新体验。教学使用独立练习状态，不修改真实存档或榜单。

音乐与音效默认开启，受浏览器自动播放规则影响，需要首次点击或触摸页面后播放。手机静音、系统音量和后台暂停也可能影响声音。计分动画、音量、语言等偏好保存在本机。

## 排行榜与数据

- **最佳单手**：本局最高的一手得分；**累计得分**：本局各手得分总和；**最多回合**：服务器记录的到达回合，包含跳过的盲注，不是出牌次数。
- 每榜默认保留前 **20** 名，管理员可在「站点设置 → 每榜保留名额」调整为 **1–1000**。同分时先完成的对局优先，再按对局 ID 稳定排序。
- 玩法、难度、规则版本、赛季和时间范围分别排名。服务器去重保存进入任意一榜的成绩，所以总记录数可超过单榜名额；完全未入榜的记录会删除。
- 调小名额会立即清理不再入榜的记录，调大不能恢复已删除成绩。过期的仅今日榜成绩由定时任务清理；隐藏和归档记录也遵循有上限的保留规则。
- 上榜对局输了或通关时自动提交，也可选择「结束并提交成绩」。离线练习不参与排名，可使用种子和无尽模式。
- 排名关闭时隐藏昵称、榜单和提交入口。历史榜单保留；进行中的服务器对局可以继续，但永久失去本次上榜资格，重新开启不会补交。
- 清空榜单会开启新赛季，旧成绩归档；可以针对指定玩法 / 难度清空三类榜单。清空前开始的对局不能进入新榜。

默认用户名如 `牌友-A1B2C3D4`，由服务器随机生成并通过 Cookie 保持；不再要求首次输入。昵称仍可修改、允许重复。访客身份使用 HTTP-only Cookie；清除 Cookie、换浏览器或换设备会成为新访客，不保证昵称归属或跨设备同步。


公开榜单显示遮蔽后的 IP、浏览器概要和大致地区；完整 IP / User-Agent 仅管理员可见。地区来自 Cloudflare 原生信息，不保存城市或坐标，不查询第三方 GeoIP。本地部署和旧记录可能没有地区。网络信息超过 30 天后在清理任务中移除，也不会因旧对局重新提交而续期。

原始对局在 **7 天未更新**后进入清理范围，每次最多删除 100 条；Node 每小时、Cloudflare 每日调度清理。因此清理可能存在调度或批次延迟。

## Docker 部署

需要 Docker 和 Docker Compose。首次安装会构建镜像、在当前终端显示一次管理员密钥并启动服务：

```sh
sh scripts/install-docker.sh
```

也可手动执行：

```sh
docker compose build
docker compose run --rm game npm run admin:init
docker compose up -d
```

访问 **http://127.0.0.1:5173**。容器以非 root 用户运行，数据保存在 `game-data` 卷中。更新和普通停止：

```sh
docker compose up --build -d
docker compose down
```

`docker compose down -v` 会删除数据卷，包括存档和管理员密码验证值。正常维护不要加 `-v`。

### 反向代理

Compose 默认只将端口发布到本机。公开部署时配置 HTTPS 反向代理，并在 `compose.override.yaml` 中传入实际站点地址：

```yaml
services:
  game:
    environment:
      PUBLIC_ORIGIN: https://cards.example.com
      # 仅填写实际反向代理的连接来源 IP；默认不信任转发头。
      # TRUST_PROXY_IPS: 172.20.0.2
```

`TRUST_PROXY_IPS` 是明确的代理 IP 列表，以逗号分隔，不支持通配符或网段。应用从右向左检查代理链，遇到第一个不可信地址即停止，防止客户端在转发头前插入假 IP 绕过限流。`PUBLIC_ORIGIN` 用于同源校验和 HTTPS 会话 Cookie，不能省略为错误的 HTTP 地址。

### 备份

停止服务后备份完整数据卷，再启动服务。例如：

```sh
umask 077
mkdir -p backups
docker compose stop game
docker compose run --rm --no-deps --entrypoint tar game -czf - -C /data . > backups/game-data.tar.gz
docker compose start game
```

备份包含管理员验证值与用户数据，应私密保存。恢复前停止服务，将完整数据恢复到数据卷，再启动；不要对写入中的 SQLite 直接复制单个主文件。

## Cloudflare 部署

使用 Workers + Static Assets + D1，无需独立应用服务器。

| 绑定 | 用途 |
| --- | --- |
| `ASSETS` | `dist/` 中的前端静态资源 |
| `DB` | D1：访客、对局、成绩、规则、管理员会话 |

### 手动部署

```sh
npm ci
npx wrangler login
cp wrangler.jsonc wrangler.production.local.jsonc
npx wrangler d1 create paixu-db --config wrangler.production.local.jsonc
```

将创建得到的 D1 `database_id` 填入 **同一份** `wrangler.production.local.jsonc`，并检查资源名称。模板中的全零 ID 只是占位符。机器专用的 `*.local.jsonc` 已被 Git 和 Docker 排除。

```sh
npm run build
npx wrangler d1 migrations apply paixu-db --remote --config wrangler.production.local.jsonc
npx wrangler deploy --config wrangler.production.local.jsonc --keep-vars --strict
```

部署后按下方步骤在控制台配置安装密钥，再访问 **/admin** 创建管理员密码，无需本地初始化。也可选择运行 `WRANGLER_CONFIG=wrangler.production.local.jsonc npm run admin:init:cloudflare`，随机管理员密钥只在部署者终端显示一次。`npm run deploy` 使用默认 `wrangler.jsonc`，只适用于已经正确配置该文件的环境；自定义配置请使用上面成对指定 `--config` 的命令。

如果在控制台添加了自定义域名，务必把相应 `routes` 写入部署所用的同一份配置。`--keep-vars` 保留控制台变量，**不会代替域名绑定配置**。管理员脚本默认使用 `paixu-db`，可通过 `CF_D1_DATABASE_NAME` 指定已存在的数据库。

### 一键部署按钮

点击下方按钮，将本项目部署到你自己的 Cloudflare 账号：

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https%3A%2F%2Fgithub.com%2Fjiangbo202%2Fpaixu)

无需提前 Fork，按钮会引导登录、创建仓库副本及部署。Cloudflare 的部署流程可创建并绑定所需资源，数据库迁移通过 `npm run deploy` 执行（使用 `DB` 绑定名，支持修改数据库名称）。如安装页面要求 `ADMIN_SETUP_KEY`，请按下面的要求填写；也可部署后在控制台添加。当前版本不使用 R2，无需开通对象存储。免费额度受套餐限制，超额可能计费。以官方 [Workers 限制](https://developers.cloudflare.com/workers/platform/limits/)、[D1 计价](https://developers.cloudflare.com/d1/platform/pricing/)为准。

### 通过网页初始化管理员（推荐）

1. 部署完成后，在 Cloudflare 打开 **Workers & Pages → 当前 Worker → Settings → Variables and Secrets → Add**。
2. 类型选择 **Secret**，名称填写 `ADMIN_SETUP_KEY`。使用密码管理器生成 **32–256 位、无空白字符的随机字符串**作为值，自行保存；不要使用文档示例、短口令或公开字符串。
3. 点击 **Deploy** 使配置生效。
4. 打开网站 **`/admin`**，输入安装密钥，并输入两次 **12–128 个字符**的管理员密码。
5. 创建成功后，使用刚设置的管理员密码登录。可在 Cloudflare 控制台删除 `ADMIN_SETUP_KEY` 并部署，后续登录不依赖它。

整个过程只需浏览器，不用克隆仓库或运行本地命令。使用 HTTPS 访问；Secret 保存后控制台无法再次查看原文，只能重新设置。初始化前若丢失安装密钥，可直接在控制台替换；没有配置有效 Secret 时，网页不能创建管理员。

**已有管理员的站点会继续使用原密码或管理员密钥。** 网页初始化只执行一次；即使保留、重新添加或更换 `ADMIN_SETUP_KEY`，也不能覆盖已有管理员或重置密码。管理员密码只保存带随机盐的验证值，不会返回给浏览器；安装密钥不写入数据库、前端文件或日志。命令行初始化仍可使用。

## 管理员与用量统计

后台提供「站点设置 / 游戏参数 / 成绩管理 / 资源用量 / 修改密码」。可以修改概率、资源和目标系数，管理指定玩法 / 难度的成绩。设置和清空操作使用版本校验，避免并发覆盖。

修改密码需输入原密码、12–128 个字符的新密码及再次确认。成功后所有管理员会话失效，使用新密码重新登录。安装密钥不能重新显示；丢失密码时，在部署者终端重置：

```sh
npm run admin:reset
# Docker
docker compose run --rm game npm run admin:reset
# Cloudflare
WRANGLER_CONFIG=wrangler.production.local.jsonc npm run admin:reset:cloudflare
```

Cloudflare 资源用量需要仅限目标账号的 **Account Analytics · Read** API Token，按[官方授权说明](https://developers.cloudflare.com/analytics/graphql-api/getting-started/authentication/api-token-auth/)创建并通过 Secret 保存：

```sh
npx wrangler secret put CF_ANALYTICS_TOKEN --config wrangler.production.local.jsonc
```

在同一份配置的 `vars` 中填写以下标识后重新部署：

```json
"vars": {
  "CF_ACCOUNT_ID": "YOUR_ACCOUNT_ID",
  "CF_WORKER_NAME": "paixu-web",
  "CF_D1_DATABASE_ID": "YOUR_DATABASE_ID"
}
```

Token 不在网页中输入、展示或保存。统计由已登录管理员请求，服务端合并请求并缓存最长 5 分钟；Workers / D1 为今日 UTC，数据库存储取最近快照。页面区分项目与账号总量；缺权限、失败或无快照显示不可用，不冒充零用量。本地部署只显示真实 SQLite 逻辑大小。

## 开发与安全检查

```sh
npm ci
npm test
npm run build
npx wrangler deploy --dry-run
npm audit --registry=https://registry.npmjs.org
```

本地模拟 Cloudflare：

```sh
npm run build
npx wrangler d1 migrations apply paixu-db --local
npm run dev:cloudflare
```

Node / Docker 启动时自动初始化 SQLite；Cloudflare 发布前须应用待执行的 D1 数据库迁移。操作现有数据库前请先备份。

| 环境变量 | 默认值 / 用途 |
| --- | --- |
| `HOST` / `PORT` | Node：`127.0.0.1` / `5173`；容器内部监听 `0.0.0.0` |
| `DB_PATH` | `./data/paixu.sqlite`；Docker 为 `/data/paixu.sqlite` |
| `PUBLIC_ORIGIN` | 公开 HTTPS 站点源，供反向代理部署使用 |
| `TRUST_PROXY_IPS` | 明确可信的代理 IP，默认不信任任何代理 |
| `CF_D1_DATABASE_NAME` | 管理员脚本使用的 D1 名称，默认 `paixu-db` |
| `ADMIN_SETUP_KEY` | 首次网页安装的私密校验密钥；Cloudflare 使用 Secret，Node 可通过环境变量注入；默认禁用网页初始化 |
| `WRANGLER_CONFIG` | 管理员初始化 / 重置脚本使用的配置文件 |

项目不自动读取 `.env`；Node 环境变量由 shell、进程管理器或 Compose 注入。Wrangler 本地开发可读取 `.dev.vars`。

`engine.js`、`rules.js`、`modes.js`、`six-seat.js` 由浏览器与服务器共用；`backend/api.js` 负责验证，`backend/sqlite.mjs` 和 `worker.js` 适配 Node 与 Cloudflare。构建仅复制允许的前端文件，并先清空旧 `dist/`。

CI 执行测试、构建、依赖审计、Workers 打包检查、Docker 构建及 Git 历史密钥扫描。安全边界、私密配置排除规则和漏洞报告方式见 [SECURITY.md](SECURITY.md)。服务端校验能阻止直接改分和非法动作，不保证识别自动化玩家或抵御所有资源耗尽攻击。
