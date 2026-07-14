import { useEffect, useState } from 'react';
import { BrowserRouter, NavLink, Route, Routes } from 'react-router-dom';
import { TerminalPage } from './pages/Terminal';
import { ChartPage } from './pages/Chart';
import { HistoryPage } from './pages/History';
import { AnalyticsPage } from './pages/Analytics';
import { SetupPage } from './pages/Setup';
import { fetchStatus, fetchAnalytics, fetchMarketData, fetchNews, fetchOandaStatus, startBot, stopBot } from './services/api';
import { StatusSnapshot } from './types';

function AppShell({ status, oandaStatus, reload }: { status: StatusSnapshot | null; oandaStatus?: any; reload: () => void }) {
  const isLive = Boolean(oandaStatus?.connected);

  async function handleStart() {
    await startBot();
    reload();
  }

  async function handleStop() {
    await stopBot();
    reload();
  }

  return (
    <>
      <header className="topbar">
        <div className="brand-block">
          <div className="brand-mark">SB</div>
          <div>
            <div className="brand">GEMMO REMONDATA BOT</div>
            <div className="brand-subtitle">OANDA trading dashboard</div>
          </div>
        </div>

        <div className="status-group">
          <div className={status?.isRunning ? 'status-pill success' : 'status-pill muted'}>
            <span>BOT</span><strong>{status?.isRunning ? 'RUNNING' : 'STOPPED'}</strong>
          </div>
          <div className={isLive ? 'status-pill success' : 'status-pill warning'}>
            <span>OANDA DATA</span><strong>{isLive ? 'CONNECTED' : 'DISCONNECTED'}</strong>
          </div>
          <div className="status-pill">
            <span>MODE</span><strong>{status?.executionMode || 'PAPER TRADING'}</strong>
          </div>
          <div className="status-pill">
            <span>UPDATE</span><strong>{status?.lastUpdated ? new Date(status.lastUpdated).toLocaleTimeString() : '-'}</strong>
          </div>
        </div>

        <div className="button-group">
          <button className="button primary" onClick={handleStart}>START</button>
          <button className="button danger" onClick={handleStop}>STOP</button>
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
  const [analytics, setAnalytics] = useState(null);
  const [marketData, setMarketData] = useState<Record<string, any>>({});
  const [news, setNews] = useState<any[]>([]);
  const [oandaStatus, setOandaStatus] = useState<any>({ connected: false });

  async function load() {
    const [st, analyticsData, marketDataAll, newsData, oandaData] = await Promise.allSettled([
      fetchStatus(),
      fetchAnalytics(),
      fetchMarketData(true),
      fetchNews(),
      fetchOandaStatus()
    ]);

    if (st.status === 'fulfilled') setStatus(st.value);
    if (analyticsData.status === 'fulfilled') setAnalytics(analyticsData.value);
    if (marketDataAll.status === 'fulfilled') setMarketData(marketDataAll.value || {});
    if (newsData.status === 'fulfilled') setNews(newsData.value || []);
    if (oandaData.status === 'fulfilled') setOandaStatus(oandaData.value || { connected: false });
  }

  useEffect(() => {
    let cancelled = false;

    async function safeLoad() {
      if (!cancelled) await load();
    }

    safeLoad();
    const interval = window.setInterval(() => {
      void safeLoad();
    }, 4000);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  return (
    <BrowserRouter>
      <div className="app-container">
        <AppShell status={status} oandaStatus={oandaStatus} reload={() => void load()} />
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
