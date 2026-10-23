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
