export interface FetchJsonOptions {
  method?: "GET" | "POST";
  body?: unknown;
  timeoutMs?: number;
  retries?: number;
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

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** JSON fetch with a timeout and retry with backoff on 429/5xx and network errors. */
export async function fetchJson<T>(url: string, opts: FetchJsonOptions = {}): Promise<T> {
  const retries = opts.retries ?? 3;
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 15_000);
    try {
      const res = await fetch(url, {
        method: opts.method ?? "GET",
        headers: {
          accept: "application/json",
          ...(opts.body ? { "content-type": "application/json" } : {}),
          "user-agent": "prediction-market-scanner/0.1 (+https://github.com/lukeyin08/prediction-market-scanner)",
        },
        body: opts.body ? JSON.stringify(opts.body) : undefined,
        signal: controller.signal,
        cache: "no-store",
      });
      if (res.ok) return (await res.json()) as T;
      const retryable = res.status === 429 || res.status >= 500;
      lastError = new HttpError(res.status, url, `${res.status} ${res.statusText} for ${url}`);
      if (!retryable) throw lastError;
      const retryAfter = Number(res.headers.get("retry-after"));
      await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 400 * 2 ** attempt);
    } catch (err) {
      if (err instanceof HttpError && err.status < 500 && err.status !== 429) throw err;
      lastError = err;
      await sleep(400 * 2 ** attempt);
    } finally {
      clearTimeout(timer);
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
