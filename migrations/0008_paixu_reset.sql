CREATE TABLE IF NOT EXISTS paixu_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS paixu_configs (id TEXT PRIMARY KEY, body TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS paixu_players (
  id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, display_name TEXT NOT NULL,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS paixu_runs (
  id TEXT PRIMARY KEY, player_id TEXT NOT NULL, state TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 0, config_version TEXT NOT NULL, status TEXT NOT NULL,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, ip TEXT NOT NULL, browser TEXT NOT NULL,
  mode TEXT NOT NULL DEFAULT 'classic', country TEXT NOT NULL DEFAULT '', region TEXT NOT NULL DEFAULT '',
  ranking_epoch INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS paixu_runs_player ON paixu_runs(player_id, updated_at DESC);
CREATE TABLE IF NOT EXISTS paixu_scores (
  run_id TEXT PRIMARY KEY, player_id TEXT NOT NULL, display_name TEXT NOT NULL,
  best_hand REAL NOT NULL, total_score REAL NOT NULL, rounds INTEGER, ante INTEGER NOT NULL,
  outcome TEXT NOT NULL, config_version TEXT NOT NULL, created_at INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL, ip TEXT NOT NULL, browser TEXT NOT NULL, hidden INTEGER NOT NULL DEFAULT 0,
  difficulty TEXT NOT NULL DEFAULT 'medium', mode TEXT NOT NULL DEFAULT 'classic',
  country TEXT NOT NULL DEFAULT '', region TEXT NOT NULL DEFAULT '', ranking_epoch INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS paixu_scores_ranking ON paixu_scores(mode,difficulty,config_version,ranking_epoch,hidden,best_hand DESC,created_at ASC,run_id ASC);
CREATE INDEX IF NOT EXISTS paixu_scores_total_ranking ON paixu_scores(mode,difficulty,config_version,ranking_epoch,hidden,total_score DESC,created_at ASC,run_id ASC);
CREATE INDEX IF NOT EXISTS paixu_scores_rounds_ranking ON paixu_scores(mode,difficulty,config_version,ranking_epoch,hidden,rounds DESC,created_at ASC,run_id ASC);
CREATE INDEX IF NOT EXISTS paixu_scores_date ON paixu_scores(created_at DESC);
CREATE TABLE IF NOT EXISTS paixu_admin_sessions (token_hash TEXT PRIMARY KEY, expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS paixu_rate_limits (key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS paixu_site_settings (
  id INTEGER PRIMARY KEY CHECK(id=1), ranking_enabled INTEGER NOT NULL DEFAULT 0,
  ranking_limit INTEGER NOT NULL DEFAULT 20, revision INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS paixu_mode_epochs (
  mode TEXT NOT NULL, difficulty TEXT NOT NULL, epoch INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY(mode,difficulty)
);

-- One-time brand reset: retain owner credentials/rules/settings, discard player history.
-- Temporary legacy tables also let this migration initialize an empty database.
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS configs (id TEXT PRIMARY KEY, body TEXT NOT NULL, created_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS site_settings (
  id INTEGER PRIMARY KEY, ranking_enabled INTEGER NOT NULL DEFAULT 0,
  revision INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL
);
INSERT OR IGNORE INTO paixu_meta(key,value)
SELECT key,value FROM meta WHERE key IN ('admin_key_hash','current_config')
  AND NOT EXISTS(SELECT 1 FROM paixu_meta WHERE key='paixu_schema_v1');
INSERT OR IGNORE INTO paixu_configs(id,body,created_at)
SELECT id,body,created_at FROM configs
  WHERE NOT EXISTS(SELECT 1 FROM paixu_meta WHERE key='paixu_schema_v1');
INSERT OR IGNORE INTO paixu_site_settings(id,ranking_enabled,revision,updated_at)
SELECT id,ranking_enabled,revision,updated_at FROM site_settings
  WHERE NOT EXISTS(SELECT 1 FROM paixu_meta WHERE key='paixu_schema_v1');
INSERT OR IGNORE INTO paixu_site_settings(id,updated_at) VALUES(1,CAST(strftime('%s','now') AS INTEGER)*1000);
INSERT OR IGNORE INTO paixu_mode_epochs(mode,difficulty)
SELECT m.mode,d.difficulty FROM
  (SELECT 'classic' AS mode UNION ALL SELECT 'quick' UNION ALL SELECT 'six-seat') m
  CROSS JOIN (SELECT 'easy' AS difficulty UNION ALL SELECT 'medium' UNION ALL SELECT 'hard' UNION ALL SELECT 'nightmare') d;
DROP TABLE IF EXISTS scores;
DROP TABLE IF EXISTS runs;
DROP TABLE IF EXISTS visitors;
DROP TABLE IF EXISTS admin_sessions;
DROP TABLE IF EXISTS rate_limits;
DROP TABLE IF EXISTS ranking_epochs;
DROP TABLE IF EXISTS mode_epochs;
DROP TABLE IF EXISTS site_settings;
DROP TABLE IF EXISTS configs;
DROP TABLE IF EXISTS meta;
INSERT OR IGNORE INTO paixu_meta(key,value) VALUES('paixu_schema_v1','1');
