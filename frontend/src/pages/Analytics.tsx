import { StatusSnapshot } from '../types';

const COLORS = ['#3b82f6', '#a855f7', '#f97316', '#22c55e', '#14b8a6', '#f8c84e'];

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function AnalyticsPage({ analytics, status }: { analytics: any; status?: StatusSnapshot | null }) {
  const paperMode = status?.tradingMode !== 'LIVE';
  const allTrades = status ? [...status.closedTrades, ...status.openTrades] : [];
  const trades = allTrades.filter((trade) => paperMode
    ? trade.source === 'PAPER'
    : trade.source === 'OANDA' && trade.verificationStatus === 'VERIFIED');
  const distribution = trades.reduce((acc: Record<string, number>, trade) => {
    const key = trade.setupType || 'SETUP N/A';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const distributionEntries = Object.entries(distribution);
  let cursor = 0;
  const donutStops = distributionEntries.map(([, count], index) => {
    const start = cursor;
    cursor += (count / Math.max(trades.length, 1)) * 100;
    return `${COLORS[index % COLORS.length]} ${start}% ${cursor}%`;
  });
  const closedValues = (status?.closedTrades || [])
    .filter((trade) => paperMode
      ? trade.source === 'PAPER'
      : trade.source === 'OANDA' && trade.verificationStatus === 'VERIFIED')
    .map((trade) => trade.pnl)
    .filter(finite)
    .slice(0, 30)
    .reverse();
  const maximumMagnitude = Math.max(...closedValues.map((value) => Math.abs(value)), 0);
  const pnlToday = finite(analytics?.pnlToday) ? analytics.pnlToday : undefined;
  const winRate = finite(analytics?.winRate) ? analytics.winRate : undefined;
  const wins = finite(analytics?.wins) ? analytics.wins : undefined;
  const losses = finite(analytics?.losses) ? analytics.losses : undefined;
  const currency = typeof analytics?.pnlCurrency === 'string' && analytics.pnlCurrency.trim()
    ? analytics.pnlCurrency
    : undefined;

  return (
    <div className="analytics-page">
      <section className="page-hero">
        <div><p className="eyebrow">Analytics</p><h1>Performance calcolata soltanto sui trade della corsia corrente.</h1></div>
        <div className="system-warning">{paperMode ? 'PAPER LEDGER' : 'VERIFIED OANDA ONLY'}</div>
      </section>

      <section className="metric-grid">
        <div className="metric-card"><span>P&amp;L oggi</span><strong className={pnlToday === undefined ? '' : pnlToday < 0 ? 'loss' : 'win'}>{pnlToday === undefined || !currency ? 'N/A' : `${pnlToday >= 0 ? '+' : '-'}${Math.abs(pnlToday).toFixed(2)} ${currency}`}</strong></div>
        <div className="metric-card"><span>Win rate</span><strong>{winRate === undefined ? 'N/A' : `${winRate}%`}</strong></div>
        <div className="metric-card"><span>Wins</span><strong className="win">{wins ?? 'N/A'}</strong></div>
        <div className="metric-card"><span>Losses</span><strong className="loss">{losses ?? 'N/A'}</strong></div>
      </section>

      <section className="panel analytics-card-wide">
        <div className="panel-title"><h2>Distribuzione setup</h2><span>{status ? `${trades.length} trade ${paperMode ? 'PAPER' : 'OANDA'}` : 'N/A'}</span></div>
        {distributionEntries.length > 0 ? (
          <div className="donut-wrap">
            <div className="donut" style={{ background: `conic-gradient(${donutStops.join(', ')})` }} />
            <div className="donut-legend">
              {distributionEntries.map(([name, count], index) => (
                <div key={name}><b style={{ background: COLORS[index % COLORS.length] }} /><span>{name}</span><strong>{Math.round((count / trades.length) * 100)}%</strong></div>
              ))}
            </div>
          </div>
        ) : <div className="empty-state">DATI NON DISPONIBILI: nessun setup registrato nella corsia selezionata.</div>}
      </section>

      <section className="panel analytics-card-wide">
        <div className="panel-title"><h2>P&amp;L trade chiusi</h2><span>{currency || 'VALUTA N/A'}</span></div>
        {closedValues.length > 0 && maximumMagnitude > 0 ? (
          <div className="bar-chart">
            {closedValues.map((value, index) => (
              <div key={index} className="bar-slot" title={`${value} ${currency || ''}`}>
                <div className={value >= 0 ? 'bar positive' : 'bar negative'} style={{ height: `${Math.max(4, (Math.abs(value) / maximumMagnitude) * 100)}%` }} />
              </div>
            ))}
          </div>
        ) : <div className="empty-state">DATI NON DISPONIBILI: nessun P&amp;L chiuso verificabile.</div>}
      </section>

      <section className="panel analytics-card-wide">
        <div className="panel-title"><h2>Motori realmente implementati</h2><span>nessun indicatore decorativo</span></div>
        <div className="indicator-grid">
          <div><strong>EMA 20 / 50 / 200</strong><span>Trend Forex e XAUUSD</span></div>
          <div><strong>RSI 14</strong><span>Momentum da candele OANDA</span></div>
          <div><strong>MACD 12 / 26 / 9</strong><span>Conferma e telemetria</span></div>
          <div><strong>ATR 14</strong><span>Volatilita reale</span></div>
          <div><strong>Bollinger 20</strong><span>Contesto di volatilita</span></div>
          <div><strong>Swings + BOS + CHoCH</strong><span>Struttura XAUUSD dedicata</span></div>
          <div><strong>FVG + liquidity sweep</strong><span>Geometria delle candele</span></div>
          <div><strong>M1 / M5 / M15 / H1</strong><span>Intelligence multi-timeframe</span></div>
        </div>
      </section>
    </div>
  );
}
