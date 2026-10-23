// Only server-side credentials are accepted. Analytics responses never expose tokens or raw errors.
const cache = new WeakMap();
const TTL = 300000;
const endpoint = 'https://api.cloudflare.com/client/v4/graphql';
const finite = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
const total = (rows, field) => Array.isArray(rows) && rows.every(r => finite(r.sum?.[field]) !== null) ? rows.reduce((n, r) => n + r.sum[field], 0) : null;
const scalar = value => JSON.stringify(value);
const analyticsErrors = new Set(['analytics_permission', 'analytics_account', 'analytics_query', 'analytics_limit', 'analytics_rate_limit', 'analytics_timeout', 'analytics_unavailable']);
function upstreamError(status, errors = []) {
  // GraphQL may return authentication and query errors with HTTP 200. Only return
  // fixed categories and field names from our own queries, never upstream text.
  const message = errors.map(error => typeof error?.message === 'string' ? error.message : '').join(' ').toLowerCase();
  let code = 'analytics_unavailable';
  if (status === 401 || status === 403 || /authenticat|unauthori[sz]ed|not authori[sz]ed|forbidden|permission|access denied|does not have access|invalid (api key|access token|token)/.test(message)) code = 'analytics_permission';
  else if (status === 429 || /rate limit|budget depleted|excessive resources/.test(message)) code = 'analytics_rate_limit';
  else if (/cannot request data older|time range is too large|limit must be|number of fields/.test(message)) code = 'analytics_limit';
  else if (status === 400 || /unknown (field|argument)|error parsing|query contains error|must have (no )?selections|syntax error/.test(message)) code = 'analytics_query';
  const error = new Error(code);
  error.httpStatus = status;
  const field = message.match(/unknown (?:field|argument)\s+["'`]?([a-z][a-z0-9_]*)/i)?.[1];
  const fields = new Set(['accounttag', 'scriptname', 'databaseid', 'datetime', 'datetime_geq', 'datetime_leq', 'datetime_desc', 'date_geq', 'date_leq', 'requests', 'errors', 'cputimep50', 'rowsread', 'rowswritten', 'databasesizebytes', 'workersinvocationsadaptive', 'd1analyticsadaptivegroups', 'd1storageadaptivegroups']);
  if (fields.has(field)) error.field = field;
  return error;
}
function query(account, body) { return `query { viewer { accounts(filter:{accountTag:${scalar(account)}}) { ${body} } } }`; }
function paired(dataset, filter, resource, fields, extra = '') {
  return `project:${dataset}(limit:1000,filter:{${filter},${resource}}){${fields}${extra}} account:${dataset}(limit:1000,filter:{${filter}}){${fields}${extra}}`;
}
async function graph(config, body) {
  // Calling the native Workers fetch as config.fetch(...) supplies config as
  // `this`, which workerd rejects with "Illegal invocation" before any request.
  const fetcher = config.fetch;
  const response = await fetcher(endpoint, { method: 'POST', headers: { Authorization: `Bearer ${config.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ query: query(config.account, body) }), signal: AbortSignal.timeout(10000) });
  const data = await response.json().catch(() => null);
  if (!response.ok || data?.errors?.length) throw upstreamError(response.status, data?.errors);
  if (!data?.data?.viewer?.accounts?.[0]) throw new Error('analytics_account');
  return data.data.viewer.accounts[0];
}
async function measured(config, body, transform) {
  try { return { status: 'ok', ...transform(await graph(config, body)) }; }
  catch (error) {
    const code = analyticsErrors.has(error.message) ? error.message : error.name === 'TimeoutError' ? 'analytics_timeout' : 'analytics_unavailable';
    return { status: 'unavailable', error: code, ...(error.httpStatus ? { httpStatus: error.httpStatus } : {}), ...(error.field ? { field: error.field } : {}) };
  }
}
async function collect(config, at) {
  const end = new Date(at).toISOString(), day = new Date(at); day.setUTCHours(0, 0, 0, 0);
  const today = `datetime_geq:${scalar(day.toISOString())},datetime_leq:${scalar(end)}`;
  const recent = `datetime_geq:${scalar(new Date(at - 86400000).toISOString())},datetime_leq:${scalar(end)}`;
  const workers = measured(config, paired('workersInvocationsAdaptive', today, `scriptName:${scalar(config.worker)}`, 'sum{requests errors} quantiles{cpuTimeP50}'), data => ({
    requests: total(data.project, 'requests'), errors: total(data.project, 'errors'), accountRequests: total(data.account, 'requests'),
    cpuP50Us: data.project?.length === 1 ? finite(data.project[0].quantiles?.cpuTimeP50) : null,
  }));
  const d1 = config.database ? measured(config, paired('d1AnalyticsAdaptiveGroups', `date_geq:${scalar(day.toISOString().slice(0, 10))},date_leq:${scalar(end.slice(0, 10))}`, `databaseId:${scalar(config.database)}`, 'sum{rowsRead rowsWritten}'), data => ({
    rowsRead: total(data.project, 'rowsRead'), rowsWritten: total(data.project, 'rowsWritten'), accountRowsRead: total(data.account, 'rowsRead'), accountRowsWritten: total(data.account, 'rowsWritten'),
  })) : Promise.resolve({ status: 'not_configured' });
  const d1Storage = config.database ? measured(config, `storage:d1StorageAdaptiveGroups(limit:1,filter:{${recent},databaseId:${scalar(config.database)}},orderBy:[datetime_DESC]){max{databaseSizeBytes} dimensions{datetime}}`, data => ({ bytes: finite(data.storage?.[0]?.max?.databaseSizeBytes), sampledAt: data.storage?.[0]?.dimensions?.datetime || null })) : Promise.resolve({ status: 'not_configured' });
  const [workerStats, databaseStats, databaseStorage] = await Promise.all([workers, d1, d1Storage]);
  return { environment: 'cloudflare', configured: true, fetchedAt: at, expiresAt: at + TTL, dayStart: day.toISOString(), periodEnd: end,
    resources: { worker: config.worker, database: config.database || null }, workers: workerStats, d1: databaseStats, d1Storage: databaseStorage };
}
export async function usageReport(env) {
  const at = Date.now();
  if (env.platform === 'local') {
    const size = await env.DB.prepare('SELECT (SELECT page_count FROM pragma_page_count)*(SELECT page_size FROM pragma_page_size) AS bytes').first();
    return { environment: 'local', configured: false, fetchedAt: at, localDatabaseBytes: size.bytes };
  }
  const config = { account: env.CF_ACCOUNT_ID, token: env.CF_ANALYTICS_TOKEN, worker: env.CF_WORKER_NAME || 'paixu-web', database: env.CF_D1_DATABASE_ID, fetch: env.analyticsFetch || fetch };
  if (!config.account || !config.token) return { environment: 'cloudflare', configured: false, fetchedAt: at, missing: [!config.account && 'CF_ACCOUNT_ID', !config.token && 'CF_ANALYTICS_TOKEN'].filter(Boolean) };
  const previous = cache.get(env.DB), key = [config.account, config.token, config.worker, config.database].join(':');
  if (previous?.key === key && at < previous.expiresAt) return previous.promise;
  const promise = collect(config, at);
  cache.set(env.DB, { key, expiresAt: at + TTL, promise });
  return promise;
}
