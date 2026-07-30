import { type ReactNode, useCallback, useEffect, useState } from 'react';
import { BrowserRouter, NavLink, Route, Routes } from 'react-router-dom';
import { TerminalPage } from './pages/Terminal';
import { ChartPage } from './pages/Chart';
import { HistoryPage } from './pages/History';
import { AnalyticsPage } from './pages/Analytics';
import { VersusPage } from './pages/Versus';
import { CommandSetupPage } from './pages/CommandSetup';
import { XauPage } from './pages/Xau';
import { fetchStatus, fetchAnalytics, fetchMarketData, fetchNews, fetchOandaStatus, startBot } from './services/api';
import { OandaStatus, StatusSnapshot } from './types';
import { executionView, hasFullFreshCoverage } from './trading-state';
import './setup-v2.css';

function isFresh(value?: string, maximumAgeMs = 15000) {
  if (!value) return false;
  const parsed = Date.parse(value);
  const age = Date.now() - parsed;
  return Number.isFinite(parsed) && age >= -5000 && age <= maximumAgeMs;
}

function feedAgeSeconds(value?: string) {
  if (!value) return undefined;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return undefined;
  return Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
}

function NavIcon({ name }: { name: 'dashboard' | 'versus' | 'chart' | 'history' | 'analytics' | 'xau' | 'setup' }) {
  const paths: Record<typeof name, ReactNode> = {
    dashboard: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>,
    versus: <><path d="M4 7h11" /><path d="m12 4 3 3-3 3" /><path d="M20 17H9" /><path d="m12 14-3 3 3 3" /></>,
    chart: <><path d="M4 19V9" /><path d="M9 16V5" /><path d="M14 20V11" /><path d="M19 14V3" /></>,
    history: <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>,
    analytics: <><path d="M4 20V10" /><path d="M10 20V4" /><path d="M16 20v-7" /><path d="M22 20H2" /></>,
    xau: <><path d="M12 3l8 5v8l-8 5-8-5V8z" /><path d="M8 10h8M9 14h6" /></>,
    setup: <><circle cx="12" cy="12" r="3" /><path d="M19 13.5v-3l-2-.7-.6-1.4.9-1.9-2.1-2.1-1.9.9-1.4-.6L10.5 2h-3l-.7 2-1.4.6-1.9-.9-2.1 2.1.9 1.9-.6 1.4-2 .7v3l2 .7.6 1.4-.9 1.9 2.1 2.1 1.9-.9 1.4.6.7 2h3l.7-2 1.4-.6 1.9.9 2.1-2.1-.9-1.9.6-1.4z" transform="scale(.8) translate(3 3)" /></>
  };
  return <svg viewBox="0 0 24 24" aria-hidden="true">{paths[name]}</svg>;
}

function AppShell({ status, oandaStatus, reload }: { status: StatusSnapshot | null; oandaStatus: OandaStatus; reload: () => void }) {
  const [starting, setStarting] = useState(false);
  const localControls = ['localhost', '127.0.0.1', '::1'].includes(window.location.hostname);
  const mode = executionView(status);
  const accountConnected = oandaStatus.connected === true;
  const accountStatusUnavailable = oandaStatus.reason === 'checking' || oandaStatus.reason === 'status_request_failed';
  const usableCoverage = hasFullFreshCoverage(status);
  const feedConnected = Boolean(accountConnected && usableCoverage && isFresh(status?.lastPriceAt, 30000));
  const oandaExecutionReady = Boolean(mode.oanda && mode.ready && status?.reconciliationStatus === 'VERIFIED' && accountConnected && feedConnected);
  const modeLabel = !mode.known ? 'MODE UNAVAILABLE' : mode.paper ? 'PAPER' : oandaExecutionReady ? mode.label : mode.demo ? 'OANDA DEMO BLOCKED' : 'OANDA LIVE BLOCKED';
  const feedAge = feedAgeSeconds(status?.lastPriceAt);
  const feedState = !accountConnected ? 'DISCONNECTED' : feedAge === undefined ? 'DISCONNECTED' : feedAge > 30 ? 'STALE' : feedConnected ? status?.priceFeedStatus === 'PARTIAL' ? 'PARTIAL LIVE' : 'LIVE' : 'PARTIAL';
  const ordersEnabled = Boolean(status?.liveTradingEnabled && mode.oanda && mode.ready);
  const navigation = [
    { to: '/', label: 'Dashboard', icon: 'dashboard' as const, end: true },
    { to: '/vs', label: 'VS', icon: 'versus' as const },
    { to: '/chart', label: 'Grafico', icon: 'chart' as const },
    { to: '/history', label: 'Storico', icon: 'history' as const },
    { to: '/analytics', label: 'Analisi', icon: 'analytics' as const },
    { to: '/xauusd', label: 'XAUUSD', icon: 'xau' as const },
    { to: '/setup', label: 'Setup', icon: 'setup' as const }
  ];

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
      <aside className="cockpit-sidebar">
        <div className="cockpit-brand">
          <span className="cockpit-brand__bolt">◆</span>
          <strong>SCALP.BOT</strong>
          <small>REAL-MARKET COMMAND CENTER</small>
        </div>
        <nav className="cockpit-nav" aria-label="Navigazione principale">
          {navigation.map((item) => (
            <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => isActive ? 'active' : ''}>
              <NavIcon name={item.icon} />
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="cockpit-sidebar__foot">
          <span className={status?.isRunning ? 'live-dot on' : 'live-dot'} />
          <small>{status === null ? 'N/A' : status.isRunning ? 'RUN' : 'STOP'}</small>
        </div>
      </aside>

      <header className="cockpit-header">
        <div className="cockpit-header__identity">
          <strong>SCALP.BOT</strong>
          <span>REAL-MARKET COMMAND CENTER</span>
        </div>

        <div className="cockpit-header__telemetry">
          <div className="header-telemetry"><span>SCANNER</span><strong className={status?.isRunning ? 'positive' : ''}>{status === null ? 'N/A' : status.isRunning ? 'ONLINE' : 'STOPPED'}</strong></div>
          <div className="header-telemetry"><span>ACCOUNT</span><strong className={accountConnected ? 'positive' : 'warning-text'}>{accountConnected ? 'CONNECTED' : accountStatusUnavailable ? 'N/A' : 'DISCONNECTED'}</strong></div>
          <div className="header-telemetry header-telemetry--mode"><span>MODE</span><strong className={oandaExecutionReady || mode.paper ? 'positive' : 'warning-text'}>{modeLabel}</strong></div>
          <div className="header-telemetry"><span>PRICE FEED</span><strong className={feedState === 'LIVE' || feedState === 'PARTIAL LIVE' ? 'positive' : feedState === 'STALE' || feedState === 'DISCONNECTED' ? 'negative' : 'warning-text'}>{feedState}</strong></div>
          <div className="header-telemetry"><span>FEED AGE</span><strong>{feedAge === undefined ? 'N/A' : `${feedAge}s`}</strong></div>
          <div className="header-telemetry"><span>ORDERS</span><strong className={ordersEnabled ? 'positive' : 'warning-text'}>{ordersEnabled ? 'ENABLED' : 'DISABLED'}</strong></div>
        </div>

        <div className="cockpit-header__actions">
          <button className="touch-button accent-button" onClick={handleStart} disabled={!localControls || starting || status?.isRunning === true}>
            {!localControls ? status?.isRunning ? 'SCANNER ATTIVO' : 'CONTROLLO RAILWAY' : starting ? 'AVVIO…' : status?.isRunning ? 'SCANNER ATTIVO' : 'AVVIA'}
          </button>
          <button className="touch-button icon-button" onClick={reload} aria-label="Aggiorna dati">↻</button>
        </div>
      </header>
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
      fetchAnalytics(), fetchMarketData(true), fetchNews(), fetchOandaStatus()
    ]);
    setAnalytics(analyticsResult.status === 'fulfilled' ? analyticsResult.value : null);
    setMarketData(marketResult.status === 'fulfilled' ? marketResult.value || {} : {});
    setNews(newsResult.status === 'fulfilled' ? newsResult.value || [] : []);
    setOandaStatus(oandaResult.status === 'fulfilled' ? oandaResult.value || { connected: false, reason: 'empty_status' } : { connected: false, reason: 'status_request_failed' });
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
      try { await loadStatus(); } finally { statusBusy = false; }
    };
    const refreshSecondary = async () => {
      if (disposed || secondaryBusy) return;
      secondaryBusy = true;
      try { await loadSecondary(); } finally { secondaryBusy = false; }
    };
    void refreshStatus();
    void refreshSecondary();
    const statusTimer = window.setInterval(() => void refreshStatus(), 5000);
    const secondaryTimer = window.setInterval(() => void refreshSecondary(), 15000);
    const events = new EventSource('/events');
    events.onmessage = (event) => {
      if (disposed) return;
      try { setStatus(JSON.parse(event.data)); } catch (_error) { /* polling remains active */ }
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
      <div className="app-container cockpit-layout">
        <AppShell status={status} oandaStatus={oandaStatus} reload={reload} />
        <main className="main-content cockpit-content">
          <Routes>
            <Route path="/" element={<TerminalPage status={status} marketData={marketData} news={news} oandaStatus={oandaStatus} />} />
            <Route path="/vs" element={<VersusPage status={status} />} />
            <Route path="/chart" element={<ChartPage status={status} marketData={marketData} />} />
            <Route path="/history" element={<HistoryPage status={status} />} />
            <Route path="/analytics" element={<AnalyticsPage analytics={analytics} status={status} />} />
            <Route path="/xauusd" element={<XauPage status={status} />} />
            <Route path="/setup" element={<CommandSetupPage status={status} marketData={marketData} oandaStatus={oandaStatus} />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}
