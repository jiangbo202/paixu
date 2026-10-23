// Free-plan reference values, checked against Cloudflare docs on 2026-10-22.
// These are comparison baselines, not an assertion about the account's plan.
// https://developers.cloudflare.com/workers/platform/limits/
// https://developers.cloudflare.com/d1/platform/pricing/
// https://developers.cloudflare.com/d1/platform/limits/
export const FREE_USAGE_LIMITS = Object.freeze({ requests: 100000, rowsRead: 5000000, rowsWritten: 100000, databaseBytes: 500000000 });

export function usageMeter(value, limit) {
  const known = typeof value === 'number' && Number.isFinite(value) && value >= 0;
  const percent = known ? value / limit * 100 : null;
  return { value: known ? value : null, limit, percent, fill: known ? Math.min(100, percent) : 0, level: !known ? 'unknown' : percent >= 100 ? 'danger' : percent >= 80 ? 'warning' : 'normal' };
}

export function usageMeters(report) {
  const workers = report.workers || {}, d1 = report.d1 || {}, storage = report.d1Storage || {};
  return [
    { id: 'workers', label: 'Workers 请求（今日）', scope: '账号总量', source: workers, current: workers.accountRequests, limit: FREE_USAGE_LIMITS.requests, project: workers.requests },
    { id: 'd1-read', label: 'D1 行读（今日）', scope: '账号总量', source: d1, current: d1.accountRowsRead, limit: FREE_USAGE_LIMITS.rowsRead, project: d1.rowsRead },
    { id: 'd1-write', label: 'D1 行写（今日）', scope: '账号总量', source: d1, current: d1.accountRowsWritten, limit: FREE_USAGE_LIMITS.rowsWritten, project: d1.rowsWritten },
    { id: 'd1-storage', label: 'D1 数据库大小', scope: '本项目单库', source: storage, current: storage.bytes, limit: FREE_USAGE_LIMITS.databaseBytes, unit: 'bytes' },
  ].map(row => ({ ...row, ...usageMeter(row.source.status === 'ok' ? row.current : null, row.limit) }));
}
