# 安全说明 / Security

## 安全边界

这是面向轻量自托管的游戏，不使用真钱，也不将金币作为可兑换资产。服务端校验上榜对局的动作、归属、版本、发牌和计分；离线存档可被本机用户修改，不能作为可信成绩提交。无账号注册、跨设备身份认证、验证码或自动化玩家识别，IP 限流也不能替代边缘防护。

管理员页面地址公开可知，安全性来自服务端会话校验。不要把“隐藏入口”视为访问控制。

## 凭据与部署

- 安装命令生成 256 位随机密钥，只在操作者终端显示一次，数据库保存 SHA-256 摘要。网页修改后的密码使用随机盐及 PBKDF2-SHA256（100,000 轮，适配 Workers Web Crypto 限制）；请使用密码管理器生成强密码。
- 网页首次安装需部署者通过 Worker Secret（或 Node 环境变量）设置 `ADMIN_SETUP_KEY`：32–256 位无空白随机字符串。接口验证密钥后以原子插入创建管理员，采用带随机盐的密码验证值；已有管理员无法被安装密钥覆盖或重置。未配置有效密钥时关闭网页安装，完成后可删除 Secret。安装状态接口只返回布尔值，不返回密钥。安装尝试按 IP 限流并校验同源写入，不能代替边缘防护。
- 管理员会话为 24 小时，Cookie 使用 `HttpOnly`、`SameSite=Strict`，HTTPS 下使用 `Secure`。密码修改或部署者重置会注销所有管理员会话。
- API 不提供找回或显示管理员密码的接口。丢失时使用本机 / Cloudflare 的 `admin:reset` 命令；不要在网页、Issue、截图或日志中公开密钥。
- Node 默认监听回环地址，Compose 仅向本机发布端口。公开部署应使用 HTTPS，并正确配置 `PUBLIC_ORIGIN`。`TRUST_PROXY_IPS` 只能列出你控制的真实代理 IP，默认不信任转发头。
- Cloudflare Analytics 使用独立的、仅限目标账号的只读 Token，保存为 Worker Secret。不要复用部署 Token，或将 Token 放入前端代码、Wrangler `vars`、Git 或浏览器存储。
- `.env*`、`.dev.vars*`、私钥、数据库、备份、日志、Compose 覆盖配置和 `*.local.jsonc` 默认不入库、不进入 Docker 构建上下文。示例文件不能包含真实凭据。`.gitignore` 不会自动取消对已跟踪文件的跟踪。
- 构建会清空旧 `dist/`，只复制允许的静态文件。Node 静态路由也使用文件白名单；不要把 `backend/`、`data/` 或仓库根目录直接作为 Web 根目录发布。

## 数据与维护

昵称和榜单是公开数据。公开接口只返回遮蔽 IP、浏览器概要和大致地区；完整网络信息仅管理员可见，在清理任务中按 30 天期限移除。原始对局按 7 天未更新进入分批清理。具体名额、归档和清理调度见 [README](README.md#排行榜与数据)。

数据库、SQLite 的 WAL / SHM和备份都应视为私密数据。SQLite 文件在支持 POSIX 权限的系统上使用 `0600`，但管理员验证值仍可能被持有备份者离线攻击。Windows 下应另行设置文件 ACL。外部备份和 Cloudflare 的恢复副本有各自的保留周期，应用清理不会删除这些副本。

定期运行测试与 `npm audit`，更新 Node、容器基础镜像和锁定依赖。CI 的密钥扫描覆盖已提交 Git 历史；提交前也应检查暂存内容。扫描通过不代表所有形式的敏感信息都一定被识别。

## 报告漏洞

优先使用仓库的 **Security → Report a vulnerability** 私密报告入口（如果维护者已启用）。否则先通过仓库维护者指定的私密渠道联系，不要在公开 Issue 中粘贴凭据、真实用户数据或可直接利用的细节。本项目没有承诺响应时限或提供渗透测试认证。

若真实凭据误入 Git，先吊销 / 轮换，再处理历史记录；仅从最新文件删除或添加忽略规则不能消除历史泄露。

## English overview

Server validation protects ranked actions, ownership, revisions and scoring. Practice saves are editable locally and cannot be uploaded as trusted scores. Guest identities, rate limits and hidden admin navigation do not provide account authentication, bot detection or complete denial-of-service protection.

First-time web setup requires an owner-configured `ADMIN_SETUP_KEY` Secret (32–256 random characters, no whitespace). Setup is rate-limited and inserts the administrator atomically; it cannot overwrite or reset an existing administrator. Remove the Secret after setup. No valid Secret means no public web initialization.

Use HTTPS with the correct `PUBLIC_ORIGIN`, trust only explicitly configured proxy addresses, keep API tokens in server-side secrets, and protect databases and backups. New passwords use salted PBKDF2-SHA256 with 100,000 iterations for Workers compatibility; use a strong generated password. Admin sessions expire after 24 hours and are revoked by password changes or resets. Cookies are HTTP-only, SameSite=Strict and Secure under HTTPS.

Public boards expose nicknames, masked IPs, browser summaries and coarse regions. Full network metadata is admin-only and expires through cleanup; external backups have separate retention. POSIX database, WAL and SHM files use `0600`; Windows requires suitable ACLs.

Report vulnerabilities privately using GitHub's Security reporting feature when enabled or the maintainer's designated private channel. Do not post real credentials or user data. Revoke leaked credentials before cleaning Git history. Tests, dependency audits and secret scans reduce risk but do not certify that the project is free of vulnerabilities.
