import { useCallback, useEffect, useState } from 'react';
import { BrowserRouter, NavLink, Route, Routes } from 'react-router-dom';
import { TerminalPage } from './pages/Terminal';
import { ChartPage } from './pages/Chart';
import { HistoryPage } from './pages/History';
import { AnalyticsPage } from './pages/Analytics';
import { SetupPage } from './pages/Setup';
import { fetchStatus, fetchAnalytics, fetchMarketData, fetchNews, fetchOandaStatus, startBot } from './services/api';
import { OandaStatus, StatusSnapshot } from './types';

function isFresh(value?: string, maximumAgeMs = 15000) {
  if (!value) return false;
  const parsed = Date.parse(value);
  const age = Date.now() - parsed;
  return Number.isFinite(parsed) && age >= -5000 && age <= maximumAgeMs;
}

function clock(value?: string) {
  if (!value) return 'N/A';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 'N/A' : parsed.toLocaleTimeString();
}

function AppShell({ status, oandaStatus, reload }: { status: StatusSnapshot | null; oandaStatus: OandaStatus; reload: () => void }) {
  const [starting, setStarting] = useState(false);
  const accountConnected = oandaStatus.connected === true;
  const feedConnected = accountConnected && status?.priceFeedStatus === 'CONNECTED' && isFresh(status.lastPriceAt);
  const liveRequested = status?.tradingMode === 'LIVE';
  const liveReady = Boolean(
    liveRequested &&
    status?.liveTradingEnabled &&
    status?.liveExecutionVariantValid &&
    accountConnected &&
    feedConnected
  );
  const modeLabel = liveReady
    ? `LIVE OANDA ${status?.liveExecutionVariant}`
    : liveRequested
      ? 'LIVE BLOCKED'
      : 'PAPER';

  async function handleStart() {
    setStarting(true);
    try {
      await startBot();
      reload();
    } finally {
      setStarting(false);
    }
  }

  return (
    <>
      <header className="topbar">
        <div className="brand-block">
          <div className="brand-mark">GR</div>
          <div>
            <div className="brand">GEMMO REMONDATA BOT</div>
            <div className="brand-subtitle">OANDA Practice · real market intelligence · verified execution gates</div>
          </div>
        </div>

        <div className="status-group">
          <div className={status?.isRunning ? 'status-pill success' : 'status-pill muted'}>
            <span>SCANNER</span><strong>{status === null ? 'UNAVAILABLE' : status.isRunning ? 'RUNNING' : 'STOPPED'}</strong>
          </div>
          <div className={accountConnected ? 'status-pill success' : 'status-pill warning'}>
            <span>OANDA ACCOUNT</span><strong>{accountConnected ? 'AUTHENTICATED' : 'DISCONNECTED'}</strong>
          </div>
          <div className={feedConnected ? 'status-pill success' : 'status-pill warning'}>
            <span>MARKET FEED</span><strong>{feedConnected ? 'FRESH' : accountConnected ? 'STALE / N/A' : 'DISCONNECTED'}</strong>
          </div>
          <div className={liveReady ? 'status-pill success' : liveRequested ? 'status-pill warning' : 'status-pill'}>
            <span>EXECUTION</span><strong>{modeLabel}</strong>
          </div>
          <div className="status-pill">
            <span>LAST PRICE</span><strong>{clock(status?.lastPriceAt)}</strong>
          </div>
        </div>

        <div className="button-group">
          <button className="button primary" onClick={handleStart} disabled={starting}>{starting ? 'STARTING…' : 'START SCANNER'}</button>
          <button className="button" onClick={reload}>REFRESH</button>
        </div>
      </header>

      <nav className="navigation">
        <NavLink to="/" end>TERMINAL</NavLink>
        <NavLink to="/chart">CHART</NavLink>
        <NavLink to="/history">HISTORY</NavLink>
        <NavLink to="/analytics">ANALYTICS</NavLink>
        <NavLink to="/setup">SETUP</NavLink>
      </nav>
    </>
  );
}

export default function App() {
  const [status, setStatus] = useState<StatusSnapshot | null>(null);
  const [analytics, setAnalytics] = useState<any>(null);
  const [marketData, setMarketData] = useState<Record<string, any>>({});
  const [news, setNews] = useState<any[]>([]);
  const [oandaStatus, setOandaStatus] = useState<OandaStatus>({ connected: false, reason: 'checking' });

  const loadStatus = useCallback(async () => {
    try {
      const next = await fetchStatus();
      setStatus(next || null);
    } catch (_error) {
      setStatus(null);
    }
  }, []);

  const loadSecondary = useCallback(async () => {
    const [analyticsResult, marketResult, newsResult, oandaResult] = await Promise.allSettled([
      fetchAnalytics(),
      fetchMarketData(true),
      fetchNews(),
      fetchOandaStatus()
    ]);

    setAnalytics(analyticsResult.status === 'fulfilled' ? analyticsResult.value : null);
    setMarketData(marketResult.status === 'fulfilled' ? marketResult.value || {} : {});
    setNews(newsResult.status === 'fulfilled' ? newsResult.value || [] : []);
    setOandaStatus(oandaResult.status === 'fulfilled'
      ? oandaResult.value || { connected: false, reason: 'empty_status' }
      : { connected: false, reason: 'status_request_failed' });
  }, []);

  const reload = useCallback(() => {
    void loadStatus();
    void loadSecondary();
  }, [loadSecondary, loadStatus]);

  useEffect(() => {
    let disposed = false;
    let statusBusy = false;
    let secondaryBusy = false;

    const refreshStatus = async () => {
      if (disposed || statusBusy) return;
      statusBusy = true;
      try {
        await loadStatus();
      } finally {
        statusBusy = false;
      }
    };
    const refreshSecondary = async () => {
      if (disposed || secondaryBusy) return;
      secondaryBusy = true;
      try {
        await loadSecondary();
      } finally {
        secondaryBusy = false;
      }
    };

    void refreshStatus();
    void refreshSecondary();
    const statusTimer = window.setInterval(() => void refreshStatus(), 5000);
    const secondaryTimer = window.setInterval(() => void refreshSecondary(), 15000);
    const events = new EventSource('/events');
    events.onmessage = (event) => {
      if (disposed) return;
      try {
        setStatus(JSON.parse(event.data));
      } catch (_error) {
        // The polling channel remains active if one event is malformed.
      }
    };

    return () => {
      disposed = true;
      window.clearInterval(statusTimer);
      window.clearInterval(secondaryTimer);
      events.close();
    };
  }, [loadSecondary, loadStatus]);

  return (
    <BrowserRouter>
      <div className="app-container">
        <AppShell status={status} oandaStatus={oandaStatus} reload={reload} />
        <main className="main-content">
          <Routes>
            <Route path="/" element={<TerminalPage status={status} marketData={marketData} news={news} oandaStatus={oandaStatus} />} />
            <Route path="/chart" element={<ChartPage status={status} marketData={marketData} />} />
            <Route path="/history" element={<HistoryPage status={status} />} />
            <Route path="/analytics" element={<AnalyticsPage analytics={analytics} status={status} />} />
            <Route path="/setup" element={<SetupPage status={status} news={news} oandaStatus={oandaStatus} />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}
