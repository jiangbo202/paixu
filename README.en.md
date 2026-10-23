# PAIXU · 牌序

[简体中文](README.md) · [MIT License](LICENSE) · [Security](SECURITY.md)

A browser poker roguelike built with vanilla HTML, CSS and JavaScript, deployable to Cloudflare Workers or Docker. Card illustrations use original CSS/SVG; music and sounds are synthesized. The repository does not bundle images, audio or program files extracted from the original games.

PAIXU is an independently implemented poker-building game, unaffiliated with and not endorsed or sponsored by the rights holders of Balatro or DAVE THE DIVER. See [NOTICE.md](NOTICE.md) for gameplay references, third-party names and licensing scope.

## Project intent and rights notice

This is a **personal, non-profit project** developed for technical learning, programming practice and personal entertainment, without an intent to earn commercial profit. Its public source code and demo pages share the maintainer's implementation and learning process.

The project's public name is **牌序 · PAIXU**. In-game terms such as “Joker cards” describe card categories or mechanics. Third-party game names, trademarks and related content belong to their respective rights holders. The maintainer respects the intellectual property of the original creators and other rights holders.

**Personal entertainment, non-profit intent, open-source publication and statements of non-affiliation do not grant third-party permission or automatically exempt the project from liability.** Any infringement assessment depends on the actual content, use, relevant rights and applicable law.

### Copyright concerns and removal requests

**If you believe this project infringes your rights, please contact the maintainer through this repository's Issues. We will promptly review the concern and remove or take down the relevant content, including disabling the affected demo pages where necessary.**

To help locate and address the concern, please include where possible:

- The work or rights involved, with a description of those rights or a source link;
- The corresponding file path, page URL or screenshot from this project;
- Your requested action, such as removing content, stopping its display or correcting attribution.

This statement describes the maintainer's non-profit intent. It **does not amend the [MIT license](LICENSE) or add restrictions to the rights it grants**. MIT applies only to project content that contributors are entitled to license; it grants no rights to third-party content or trademarks. See [NOTICE.md](NOTICE.md) for the licensing scope.

## Features

- Classic (default), Quick Run and Six-seat, each with Easy / Medium / Hard / Nightmare difficulty.
- Play immediately without registration. Rankings default to off; the server generates a default player name when rankings are enabled. Players can edit it later.
- Server-controlled ranked draws and scoring, resumable server saves, and browser-local practice saves.
- Best hand / Total score / Most rounds leaderboards, separated by mode, difficulty, rules version, season and all-time / UTC-day period.
- Responsive desktop and phone layouts, single-row hands, swipe selection and stable card stacking. Hover for joker, bonus and consumable details; tap on touch devices.
- Chinese and English, initially chosen from the browser language.
- Three synthesized music tracks, distinct action sounds, adjustable scoring animation (0–8 seconds, default 3), goal confetti and full screen where supported.
- Administration for rankings, retention limits, score moderation, game parameters, password changes and Cloudflare usage.

## Local development

Use **Node.js 22.13+**, preferably Node.js 24. Runtime has no third-party npm dependencies. Cloudflare tooling and CI use the development dependencies installed by `npm ci`.

```sh
# From the downloaded or cloned project directory
npm run admin:init
npm run dev
```

Open **http://127.0.0.1:5173**. Administration is at **/admin**; it is absent from game navigation, but its protection comes from server-side authentication.

`admin:init` prints a random administrator key only on first installation. Save it securely. Running the command again cannot display the old key. The game also runs without initializing administration.

To serve a production build:

```sh
npm run build
npm start
```

Keys: `E` play, `D` discard, `R` sort, `Esc` clear / close / skip scoring animation.

## Game modes

| Mode | Antes | Joker slots | Features |
| --- | --- | --- | --- |
| Classic | 8 | 5 | 26 jokers, 9 planets, 4 tarots and 3 vouchers |
| Quick Run | 3 | 5 | 4 extra coins, a starting Joker and 20% off regular items |
| Six-seat | 5 | 6 | An independent pool of 33 jokers; builds use only playing cards and jokers |

Six-seat has no planets, tarots, enhancement cards or vouchers. Shops offer 3 random jokers, paid rerolls and choose-one-of-three joker packs. The pool includes Pareidolia, Smiley Face, Scary Face, face-card retriggers and Four Fingers. A separate seven-Boss pool prevents The Plant from debuffing every card with Pareidolia.

Difficulty adjusts targets, starting resources, rarity odds and target growth. The new-run dialog previews actual resources and blind targets. Mode, difficulty and rules are fixed at creation; administrator changes apply only to new runs.

First-time visitors receive a skippable tutorial, also available from Help. Its independent practice state never changes real saves or rankings.

Music and effects default to on. Browsers require an initial click or touch before playback; phone silent mode, system volume and background suspension can also affect audio. Animation, volume and language preferences save locally.

## Rankings and data

- **Best hand:** highest hand score in the run. **Total score:** sum of all hand scores. **Most rounds:** the server-recorded round reached, including skipped blinds, rather than the number of hands played.
- Each board defaults to **20 entries**, adjustable to **1–1000** in Admin → Site settings. Earlier completion times win ties, followed by run ID.
- Boards are independent for each mode, difficulty, rules version, season and time period. The server stores the deduplicated union of qualifying results, so total stored records may exceed a single board's limit. Results outside every board are deleted.
- Lowering the limit prunes immediately; increasing it cannot recover deleted results. Scheduled cleanup removes expired day-only results. Hidden and archived records also have bounded retention.
- Ranked losses and victories submit automatically; End & submit finishes early. Local practice does not rank and supports seeds and endless mode.
- Disabling rankings hides profile, leaderboard and submission controls. Existing boards remain; active server runs can continue but permanently lose ranking eligibility, including after rankings are re-enabled.
- Archive & clear starts a new season for selected modes / difficulties across all three metrics. Older scores remain archived within retention limits. Runs started before the reset cannot enter the new season.

Nicknames may repeat. An HTTP-only cookie identifies each guest. Clearing cookies or changing browsers/devices creates a new identity; nickname ownership and cross-device synchronization are not guaranteed.


Public entries show masked IPs, browser summaries and approximate regions. Full IPs and user agents are admin-only. Cloudflare supplies coarse geolocation; no cities, coordinates or third-party GeoIP requests are stored. Local and historical records may have no region. Cleanup redacts network metadata older than 30 days; submitting an old run does not renew its retention.

Raw runs become eligible for cleanup after **7 days without updates**, in batches of up to 100 per cleanup. Node runs cleanup hourly and Cloudflare runs it daily, so scheduling and backlog may delay deletion. Historical round counts are recovered only from surviving real saves; unknown counts display `—` and do not enter the rounds board.

## Docker

Requires Docker and Docker Compose. First installation builds the image, displays an administrator key once and starts the service:

```sh
sh scripts/install-docker.sh
```

Or run the steps manually:

```sh
docker compose build
docker compose run --rm game npm run admin:init
docker compose up -d
```

Open **http://127.0.0.1:5173**. The container runs as a non-root user; the named `game-data` volume persists saves and administrator verifiers. Update or stop with:

```sh
docker compose up --build -d
docker compose down
```

Adding `-v` to `down` deletes the data volume. Omit it for normal maintenance.

### Reverse proxy

Compose publishes the port only on loopback. For public access, configure an HTTPS reverse proxy and set the actual origin in `compose.override.yaml`:

```yaml
services:
  game:
    environment:
      PUBLIC_ORIGIN: https://cards.example.com
      # List only actual connecting proxy addresses; forwarding headers are untrusted by default.
      # TRUST_PROXY_IPS: 172.20.0.2
```

`TRUST_PROXY_IPS` accepts comma-separated explicit addresses, not wildcards or subnets. The application walks forwarding headers right to left and stops at the first untrusted address, preventing forged prefixes from bypassing IP rate limits. `PUBLIC_ORIGIN` controls origin checks and HTTPS cookies; set it to the correct public HTTPS origin.

### Backups

Stop writes before backing up the complete data volume, then restart:

```sh
umask 077
mkdir -p backups
docker compose stop game
docker compose run --rm --no-deps --entrypoint tar game -czf - -C /data . > backups/game-data.tar.gz
docker compose start game
```

Backups contain administrator verifiers and user data. Keep them private. Stop the service before restoring the full volume; do not copy only a live SQLite main file while it is being written.

## Cloudflare

The deployment uses Workers, Static Assets and D1 (`DB`). `ASSETS` serves the frontend from `dist/`.

### Manual deployment

```sh
npm ci
npx wrangler login
cp wrangler.jsonc wrangler.production.local.jsonc
npx wrangler d1 create paixu-db --config wrangler.production.local.jsonc
```

Put the returned D1 `database_id` in the **same** `wrangler.production.local.jsonc`, checking all resource names. The template's all-zero ID is a placeholder. Machine-specific `*.local.jsonc` files are excluded from Git and Docker.

```sh
npm run build
npx wrangler d1 migrations apply paixu-db --remote --config wrangler.production.local.jsonc
npx wrangler deploy --config wrangler.production.local.jsonc --keep-vars --strict
WRANGLER_CONFIG=wrangler.production.local.jsonc npm run admin:init:cloudflare
```

The key appears only in the deployer's terminal, never on a public setup page or in build logs. Sign in at **/admin**. `npm run deploy` uses the default `wrangler.jsonc`; use it only when that file is correctly configured. Custom configurations must be passed to both migration and deployment commands as above.

If you add a custom domain in the dashboard, preserve its `routes` in the deployment configuration. `--keep-vars` preserves dashboard variables; it does **not** replace domain binding configuration. If you rename the database, update the CLI database name in `scripts/admin.mjs` as well.

### One-click deployment

Publish your own public GitHub repository, replace `YOUR_ACCOUNT` / `YOUR_REPO` below with its actual path, and add the resulting button to its README:

```markdown
[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https%3A%2F%2Fgithub.com%2FYOUR_ACCOUNT%2FYOUR_REPO)
```

Cloudflare's deployment flow can provision and bind resources. Administrator initialization still takes place from the deployer's terminal afterward. R2 is no longer needed. Free allowances depend on the plan, and overages may be billed: see official [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) and [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/).

## Administration and analytics

Admin provides Site settings, Game rules, Score management, Resource usage and Change password. Parameters affect new runs. Settings and season resets check versions to prevent concurrent overwrites.

Change password requires the current password and a new password entered twice, with 12–128 characters. A successful change revokes every administrator session. A lost key cannot be displayed again; reset it from the deployment host:

```sh
npm run admin:reset
# Docker
docker compose run --rm game npm run admin:reset
# Cloudflare
WRANGLER_CONFIG=wrangler.production.local.jsonc npm run admin:reset:cloudflare
```

Cloudflare usage requires an account-scoped **Account Analytics · Read** API token. Follow the [official authentication guide](https://developers.cloudflare.com/analytics/graphql-api/getting-started/authentication/api-token-auth/) and save it as a Secret:

```sh
npx wrangler secret put CF_ANALYTICS_TOKEN --config wrangler.production.local.jsonc
```

Set these identifiers in the same configuration's `vars`, then redeploy:

```json
"vars": {
  "CF_ACCOUNT_ID": "YOUR_ACCOUNT_ID",
  "CF_WORKER_NAME": "paixu-web",
  "CF_D1_DATABASE_ID": "YOUR_DATABASE_ID"
}
```

Tokens are not entered, shown or saved in the web UI. Authenticated administrators trigger server-side analytics, coalesced and cached for up to five minutes. Workers/D1 cover today in UTC, while database storage uses the latest snapshot. Project and account totals are distinct. Missing permissions, failures and absent snapshots remain unavailable rather than becoming zero. Local deployments show actual SQLite logical size only.

## Development, upgrades and security

```sh
npm ci
npm test
npm run build
npx wrangler deploy --dry-run
npm audit --registry=https://registry.npmjs.org
```

Local Cloudflare emulation:

```sh
npm run build
npx wrangler d1 migrations apply paixu-db --local
npm run dev:cloudflare
```

Node/Docker initialize or upgrade SQLite on startup. Cloudflare requires pending migrations before deployment. Version 3.0 deliberately clears legacy player history; see the upgrade section below.

| Variable | Default / purpose |
| --- | --- |
| `HOST` / `PORT` | Node: `127.0.0.1` / `5173`; containers listen internally on `0.0.0.0` |
| `DB_PATH` | `./data/paixu.sqlite`; `/data/paixu.sqlite` in Docker |
| `PUBLIC_ORIGIN` | Public HTTPS origin for reverse-proxy deployments |
| `TRUST_PROXY_IPS` | Explicit trusted proxy addresses; none by default |
| `WRANGLER_CONFIG` | Configuration used by administrator initialization/reset scripts |

The application does not load `.env` automatically. Inject Node variables through the shell, a process manager or Compose. Wrangler local development can load `.dev.vars`.

Browser and server share `engine.js`, `rules.js`, `modes.js` and `six-seat.js`. `backend/api.js` validates actions; `backend/sqlite.mjs` and `worker.js` adapt Node and Cloudflare. Builds clear stale `dist/` contents and copy only allowlisted frontend files.

CI runs tests, builds, dependency audits, Worker packaging, Docker builds and Git-history secret scanning. See [SECURITY.md](SECURITY.md) for boundaries and reporting. Server validation rejects direct score changes and illegal moves; it does not guarantee bot detection or complete protection against resource exhaustion.
## PAIXU 3.0 and existing installations

Names are now unified: **牌序 · PAIXU**, `paixu-web` (package / new Worker), `paixu-db` (new D1), `paixu.sqlite` (local database), `paixu-web.*` (browser storage), and `paixu_guest` / `paixu_admin` (cookies). Six-seat uses the `six-seat` mode ID, `ss-` joker IDs and `six-seat.js`.

Application tables all use the `paixu_` prefix. Players live in `paixu_players`; related rows use `player_id`, names use `display_name`, and public APIs expose `displayName`. No image fields or upload endpoints remain.

**Migration `0008_paixu_reset.sql` clears previous players, runs, scores, sessions and legacy tables.** It retains owner password verifiers, game rules and the ranking switch; the per-board limit resets to 20. This single migration replaces 0001–0007 for fresh installations and upgrades. Existing D1 migration records need not be deleted. Reapplying it preserves all new PAIXU data.

Stop the server before moving an existing local database to the new default filename:

```sh
npm run upgrade:local -- ./data/previous.sqlite
```

Replace the source with its actual path. The command refuses to overwrite an existing destination. Docker users should stop the service, rebuild the image and run the command in a container mounting the original data volume, using the database's `/data/` path. Fresh databases require normal administrator initialization.

Existing Cloudflare installations can apply `0008` to their original D1 and redeploy using their actual resource names. To rename remote resources too, provision a new `paixu-db` / `paixu-web`, bind the new database ID and initialize the owner again. Update custom domains, Secrets and Analytics identifiers accordingly. Changing a name in configuration does not change a database's identity. The public template uses PAIXU names; existing private production configuration is not automatically overwritten or deployed. Admin scripts accept `CF_D1_DATABASE_NAME` (default `paixu-db`).

Previous browser saves and preferences are not imported. New runs use the new storage namespace. Owner sessions must sign in again after upgrading.

The application no longer creates image directories, binds R2 or queries object-storage analytics. Remove retired upload directories, R2 buckets and old Workers after the replacement deployment is running. Code updates do not delete cloud resources or external backups.

Renaming does not grant rights to original content or marks, and does not constitute trademark clearance.
