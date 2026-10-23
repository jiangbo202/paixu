// A short-lived, bounded cache keeps filter switches instant without storing
// leaderboard data on disk. Only the latest request may update the open board.
export function createBoardLoader({ fetchBoard, onChange, now = Date.now, ttl = 30000 }) {
  const cache = new Map();
  let data = null, error = '', loading = false, sequence = 0, pending = null;
  const publish = () => onChange({ data, error, loading });
  function cancel() {
    sequence++;
    pending?.controller.abort();
    pending = null;
    loading = false;
  }
  function load(query, { force = false } = {}) {
    const params = { period: query.period, version: query.version, difficulty: query.difficulty, mode: query.mode, metric: query.metric };
    const key = new URLSearchParams(params).toString();
    if (!force && pending?.key === key) return pending.promise;
    cancel();
    const request = sequence, cached = cache.get(key);
    error = '';
    if (!force && cached && now() - cached.at < ttl) {
      data = cached.data;
      publish();
      return Promise.resolve(data);
    }
    loading = true;
    const controller = new AbortController();
    const promise = Promise.resolve().then(() => fetchBoard(params, { signal: controller.signal })).then(result => {
      if (request !== sequence) return null;
      data = result;
      cache.delete(key);
      cache.set(key, { data, at: now() });
      if (cache.size > 32) cache.delete(cache.keys().next().value);
      return data;
    }).catch(cause => {
      if (request === sequence) error = cause.message || '操作失败';
      return null;
    }).finally(() => {
      if (request !== sequence) return;
      pending = null;
      loading = false;
      publish();
    });
    pending = { key, controller, promise };
    publish();
    return promise;
  }
  return { load, cancel };
}
