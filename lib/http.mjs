export const USER_AGENT = 'daily-feed/1.0 (+https://github.com/HoaTruongMinhAn/daily-feed)';

export async function fetchText(url, { timeoutMs = 15000, headers = {}, retries = 1, fetchImpl = fetch } = {}) {
  let lastError;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchImpl(url, {
        headers: { 'user-agent': USER_AGENT, accept: '*/*', ...headers },
        signal: controller.signal,
        redirect: 'follow',
      });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
      return await res.text();
    } catch (err) {
      lastError = err;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError;
}

export async function fetchJson(url, opts = {}) {
  const text = await fetchText(url, { ...opts, headers: { accept: 'application/json', ...(opts.headers ?? {}) } });
  return JSON.parse(text);
}
