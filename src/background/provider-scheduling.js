const DEFAULT_INTERVAL_MS = { virustotal: 15000, shodan: 1000 };
const DEFAULT_BACKOFF_MS = 60000;

function retryDelay(value, now) {
  const text = String(value ?? '').trim();
  if (/^\d+(?:\.\d+)?$/.test(text)) {
    const delay = Number(text) * 1000;
    if (Number.isFinite(delay)) return delay;
  }
  // Date.parse also accepts non-HTTP values such as "-1"; those must use
  // the fallback, not accidentally disable or vastly extend a cooldown.
  const httpDate = /^(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT$/;
  const date = httpDate.test(text) ? Date.parse(text) : NaN;
  return Number.isFinite(date) ? Math.max(0, date - now) : DEFAULT_BACKOFF_MS;
}

function quotaError(until) {
  const seconds = Math.max(0, Math.ceil((until - Date.now()) / 1000));
  return Object.assign(new Error(`Quota reached, retry possible in ${seconds} s.`), {
    status: 429, retryAt: until, retryAfterSeconds: seconds
  });
}

// One scheduler per worker, not per IOC. Queue only ordinary start spacing;
// a server quota refusal returns immediately instead of silently retrying.
export function createProviderScheduler() {
  const providers = new Map();
  const pending = new Set();

  return {
    clearPending() {
      for (const cancel of pending) cancel();
      pending.clear();
    },
    run(id, config, guard, operation) {
      if (!providers.has(id)) providers.set(id, { tail: Promise.resolve(), lastStart: null, blockedUntil: 0 });
      const state = providers.get(id);
      let timer;
      let cancelled = false;
      let cancel;
      const cancellation = new Promise((_, reject) => {
        cancel = () => {
          cancelled = true;
          clearTimeout(timer);
          reject(Object.assign(new Error('Mustela is paused; queued lookup cancelled.'), { code: 'MUSTELA_PAUSED' }));
        };
      });
      pending.add(cancel);
      const task = state.tail.then(async () => {
        if (cancelled) return;
        await guard();
        if (cancelled) return;
        if (state.blockedUntil > Date.now()) throw quotaError(state.blockedUntil);
        const configured = config?.minIntervalMs;
        const interval = typeof configured === 'number' && Number.isFinite(configured) && configured >= 0
          ? configured : DEFAULT_INTERVAL_MS[id] || 0;
        const startAt = state.lastStart === null ? Date.now() : state.lastStart + interval;
        while (startAt > Date.now()) {
          await Promise.race([
            new Promise((resolve) => { timer = setTimeout(resolve, Math.min(startAt - Date.now(), 2147483647)); }), cancellation
          ]);
          if (cancelled) return;
          await guard();
        }
        if (cancelled) return;
        // The async policy check may itself take time. The actual operation
        // remains inside the synchronous pause check supplied by the caller.
        return guard(() => {
          if (state.blockedUntil > Date.now()) throw quotaError(state.blockedUntil);
          pending.delete(cancel);
          state.lastStart = Date.now();
          return operation();
        });
      }).catch((error) => {
        if (Number(error.status) === 429) {
          state.blockedUntil = Math.max(state.blockedUntil, error.retryAt ?? Date.now() + retryDelay(error.retryAfter, Date.now()));
          throw quotaError(state.blockedUntil);
        }
        throw error;
      });
      const result = Promise.race([task, cancellation]).finally(() => {
        clearTimeout(timer);
        pending.delete(cancel);
      });
      state.tail = result.catch(() => undefined);
      return result;
    }
  };
}
