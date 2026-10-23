// Each score is stored once if it qualifies for any all-time or current-day
// metric. Hidden records form a separate bounded set for owner moderation.
export function retentionSql(scope = '1=1') {
  const partition='mode,difficulty,config_version,ranking_epoch,hidden';
  const order=column=>`${column} DESC,created_at ASC,run_id ASC`;
  return `WITH ranked AS (
    SELECT run_id,created_at,rounds,
      ROW_NUMBER() OVER(PARTITION BY ${partition} ORDER BY ${order('best_hand')}) AS best_all,
      ROW_NUMBER() OVER(PARTITION BY ${partition} ORDER BY ${order('total_score')}) AS total_all,
      ROW_NUMBER() OVER(PARTITION BY ${partition} ORDER BY ${order('rounds')}) AS rounds_all,
      ROW_NUMBER() OVER(PARTITION BY ${partition},CAST(created_at/86400000 AS INTEGER) ORDER BY ${order('best_hand')}) AS best_day,
      ROW_NUMBER() OVER(PARTITION BY ${partition},CAST(created_at/86400000 AS INTEGER) ORDER BY ${order('total_score')}) AS total_day,
      ROW_NUMBER() OVER(PARTITION BY ${partition},CAST(created_at/86400000 AS INTEGER) ORDER BY ${order('rounds')}) AS rounds_day
    FROM paixu_scores WHERE ${scope}
  ), quota AS (SELECT ranking_limit AS n FROM paixu_site_settings WHERE id=1)
  DELETE FROM paixu_scores WHERE run_id IN (
    SELECT run_id FROM ranked,quota
    WHERE best_all>n AND total_all>n AND (rounds IS NULL OR rounds_all>n)
      AND (created_at<CAST(strftime('%s','now') AS INTEGER)/86400*86400000
        OR (best_day>n AND total_day>n AND (rounds IS NULL OR rounds_day>n)))
  )`;
}
export function pruneScoresStatement(db, group, expectedRevision) {
  const clauses=[],values=[];
  if (group) for(const [key,value] of Object.entries(group)) {
    if (!['mode','difficulty','config_version','ranking_epoch'].includes(key)) throw new Error('Invalid ranking group');
    clauses.push(`${key}=?`);values.push(value);
  }
  if (expectedRevision!==undefined) {clauses.push('EXISTS(SELECT 1 FROM paixu_site_settings WHERE id=1 AND revision=?)');values.push(expectedRevision);}
  return db.prepare(retentionSql(clauses.join(' AND ')||'1=1')).bind(...values);
}
