// Shared HTTP helpers for provider adapters: retry transient failures, and turn
// raw error bodies into short human messages. No chrome.* — fetch is injected.

const RETRYABLE = new Set([429, 500, 502, 503, 529]);

export async function fetchRetry(fetchImpl, url, opts, { retries = 3, signal, baseDelay = 500 } = {}) {
  let attempt = 0;
  for (;;) {
    if (signal?.aborted) throw new Error("stopped");
    const res = await fetchImpl(url, opts);
    if (res.ok || !RETRYABLE.has(res.status) || attempt >= retries) return res;
    // Prefer the server's Retry-After; otherwise exponential backoff.
    let waitMs = baseDelay * Math.pow(2, attempt);
    const ra = res.headers?.get?.("retry-after");
    if (ra != null) { const s = Number(ra); if (!Number.isNaN(s)) waitMs = s * 1000; }
    attempt++;
    await new Promise((r) => setTimeout(r, waitMs));
  }
}

export async function httpError(name, res) {
  const s = res.status;
  if (s === 429) return new Error(`${name} is rate-limited (429) — wait a moment and try again.`);
  if (RETRYABLE.has(s)) return new Error(`${name} is busy right now (${s}) — try again shortly, or switch models.`);
  if (s === 401 || s === 403) return new Error(`${name} rejected the API key (${s}) — check it in settings (⚙).`);
  let msg = "";
  try { const body = await (res.text?.() ?? Promise.resolve("")); try { msg = JSON.parse(body).error?.message || body; } catch { msg = body; } } catch {}
  return new Error(`${name} error ${s}${msg ? ": " + String(msg).slice(0, 200) : ""}`);
}
