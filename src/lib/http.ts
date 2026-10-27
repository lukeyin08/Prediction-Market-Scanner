export interface FetchJsonOptions {
  method?: "GET" | "POST";
  body?: unknown;
  /** Per-attempt timeout. */
  timeoutMs?: number;
  retries?: number;
  /** Overall deadline shared by every request in a scan. */
  signal?: AbortSignal;
}

export class HttpError extends Error {
  constructor(
    public status: number,
    public url: string,
    message: string,
  ) {
    super(message);
  }
}

const MAX_RETRY_AFTER_MS = 2_000;

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}

/**
 * JSON fetch with a per-attempt timeout, a capped retry on 429/5xx/network
 * errors, and an optional shared deadline. Defaults are tuned so a scan of a
 * few hundred requests can never outlive a serverless function's time limit.
 */
export async function fetchJson<T>(url: string, opts: FetchJsonOptions = {}): Promise<T> {
  const retries = opts.retries ?? 1;
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    if (opts.signal?.aborted) throw opts.signal.reason ?? new Error("deadline exceeded");
    const timeout = AbortSignal.timeout(opts.timeoutMs ?? 8_000);
    const signal = opts.signal ? AbortSignal.any([timeout, opts.signal]) : timeout;
    try {
      const res = await fetch(url, {
        method: opts.method ?? "GET",
        headers: {
          accept: "application/json",
          ...(opts.body ? { "content-type": "application/json" } : {}),
          "user-agent": "prediction-market-scanner/0.1 (+https://github.com/lukeyin08/prediction-market-scanner)",
        },
        body: opts.body ? JSON.stringify(opts.body) : undefined,
        signal,
        cache: "no-store",
      });
      if (res.ok) return (await res.json()) as T;
      lastError = new HttpError(res.status, url, `${res.status} ${res.statusText} for ${url}`);
      if (res.status !== 429 && res.status < 500) throw lastError;
      const retryAfter = Number(res.headers.get("retry-after"));
      const wait = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 300 * 2 ** attempt;
      if (attempt < retries) await sleep(Math.min(wait, MAX_RETRY_AFTER_MS), opts.signal);
    } catch (err) {
      if (err instanceof HttpError && err.status < 500 && err.status !== 429) throw err;
      if (opts.signal?.aborted) throw opts.signal.reason ?? err;
      lastError = err;
      if (attempt < retries) await sleep(300 * 2 ** attempt, opts.signal);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

/** Map over items with at most `limit` promises in flight. */
export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

export function num(x: unknown): number | null {
  if (x === null || x === undefined || x === "") return null;
  const n = typeof x === "number" ? x : Number(x);
  return Number.isFinite(n) ? n : null;
}

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
