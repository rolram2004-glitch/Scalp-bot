export async function fetchStatus() {
  const res = await fetch('/api/status');
  return res.ok ? res.json() : null;
}

export async function fetchAnalytics() {
  const res = await fetch('/api/analytics');
  return res.ok ? res.json() : null;
}

export async function fetchMarketData(all = false) {
  const url = all ? '/api/marketdata?all=true' : '/api/marketdata';
  const res = await fetch(url);
  return res.ok ? res.json() : {};
}

export async function fetchCandles(symbol: string, timeframe = 'M5', count = 200) {
  const res = await fetch(`/api/candles?symbol=${symbol}&timeframe=${timeframe}&count=${count}`);
  return res.ok ? res.json() : [];
}

export async function startBot() {
  const res = await fetch('/api/bot/start', { method: 'POST' });
  return res.ok ? res.json() : null;
}

export async function stopBot() {
  const res = await fetch('/api/bot/stop', { method: 'POST' });
  return res.ok ? res.json() : null;
}

export async function fetchNews() {
  const res = await fetch('/api/news');
  if (!res.ok) return [];
  const data = await res.json();
  return Array.isArray(data) ? data : data.events || [];
}

export async function fetchOandaStatus() {
  const res = await fetch('/api/oanda/status');
  return res.ok ? res.json() : { connected: false };
}
