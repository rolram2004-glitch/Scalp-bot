async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    cache: 'no-store',
    ...init,
    headers: {
      Accept: 'application/json',
      ...(init?.headers || {})
    }
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const reason = payload?.error || payload?.reason || `HTTP_${response.status}`;
    throw new Error(String(reason));
  }
  return payload as T;
}

export function fetchStatus() {
  return fetchJson<any>('/api/status');
}

export function fetchAnalytics() {
  return fetchJson<any>('/api/analytics');
}

export function fetchMarketData(all = false) {
  const url = all ? '/api/marketdata?all=true' : '/api/marketdata';
  return fetchJson<Record<string, any>>(url);
}

export function fetchCandles(symbol: string, timeframe = 'M5', count = 200) {
  const query = new URLSearchParams({ symbol, timeframe, count: String(count) });
  return fetchJson<any[]>(`/api/candles?${query.toString()}`);
}

export function fetchIntelligence(symbol: string) {
  const query = new URLSearchParams({ symbol });
  return fetchJson<any>(`/api/intelligence?${query.toString()}`);
}

export function startBot() {
  return fetchJson<any>('/api/bot/start', { method: 'POST' });
}

export function stopBot() {
  return fetchJson<any>('/api/bot/stop', { method: 'POST' });
}

export async function fetchNews() {
  const data = await fetchJson<any>('/api/news');
  return Array.isArray(data) ? data : Array.isArray(data?.events) ? data.events : [];
}

export function fetchOandaStatus() {
  return fetchJson<any>('/api/oanda/status');
}
