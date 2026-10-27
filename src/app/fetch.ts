/** Fetch JSON from our own API, turning non-JSON error pages (e.g. a platform 504) into a readable message. */
export async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  const isJson = (res.headers.get("content-type") ?? "").includes("application/json");
  if (!isJson) throw new Error(res.ok ? "Unexpected response from the server." : `Server error (${res.status}).`);
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error ?? `Server error (${res.status}).`);
  return data as T;
}
