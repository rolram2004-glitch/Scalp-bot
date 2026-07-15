import { StatusSnapshot } from '../types';

const COLORS = ['#3b82f6', '#a855f7', '#f97316', '#22c55e', '#14b8a6'];

export function AnalyticsPage({ analytics, status }: { analytics: any; status?: StatusSnapshot | null }) {
  const trades = [...(status?.closedTrades || []), ...(status?.openTrades || [])];
  const total = Math.max(trades.length, 1);
  const distribution = trades.reduce((acc: Record<string, number>, trade: any) => {
    const key = trade.setupType || 'EMA';
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const distributionEntries = Object.entries(distribution);
  const recentBars = (status?.closedTrades || [])
    .filter((trade) => typeof trade.pnl === 'number' && Number.isFinite(trade.pnl))
    .slice(0, 30)
    .map((trade) => Number(trade.pnl))
    .reverse();
  const pnlToday = typeof analytics?.pnlToday === 'number' && Number.isFinite(analytics.pnlToday)
    ? analytics.pnlToday
    : undefined;
  const winRate = typeof analytics?.winRate === 'number' && Number.isFinite(analytics.winRate)
    ? analytics.winRate
    : undefined;

  return (
    <div className="analytics-page">
      <section className="page-hero">
        <div>
          <p className="eyebrow">Analytics</p>
          <h1>Performance, setup e indicatori in uso.</h1>
        </div>
      </section>

      <section className="metric-grid">
        <div className="metric-card"><span>P&L oggi</span><strong className={pnlToday !== undefined && pnlToday < 0 ? 'loss' : 'win'}>{pnlToday === undefined ? 'N/A' : `${pnlToday.toFixed(2)} ${analytics?.pnlCurrency || ''}`.trim()}</strong></div>
        <div className="metric-card"><span>Win rate</span><strong>{winRate === undefined ? 'N/A' : `${winRate}%`}</strong></div>
        <div className="metric-card"><span>Wins</span><strong className="win">{analytics ? analytics.wins ?? 0 : 'N/A'}</strong></div>
        <div className="metric-card"><span>Losses</span><strong className="loss">{analytics ? analytics.losses ?? 0 : 'N/A'}</strong></div>
      </section>

      <section className="panel analytics-card-wide">
        <div className="panel-title"><h2>Distribuzione setup</h2><span>{trades.length} trade</span></div>
        <div className="donut-wrap">
          <div className="donut" />
          <div className="donut-legend">
            {distributionEntries.length > 0 ? distributionEntries.map(([name, count], index) => (
              <div key={name}>
                <b style={{ background: COLORS[index % COLORS.length] }} />
                <span>{name}</span>
                <strong>{Math.round((Number(count) / total) * 100)}%</strong>
              </div>
            )) : <span>Nessun setup disponibile</span>}
          </div>
        </div>
      </section>

      <section className="panel analytics-card-wide">
        <div className="panel-title"><h2>P&L trade chiusi</h2><span>{analytics?.executionMode || 'N/A'} {analytics?.pnlCurrency || ''}</span></div>
        {recentBars.length > 0 ? <div className="bar-chart">
          {recentBars.map((value: number, index: number) => (
            <div key={index} className="bar-slot">
              <div className={value >= 0 ? 'bar positive' : 'bar negative'} style={{ height: `${Math.max(6, Math.abs(value))}%` }} />
            </div>
          ))}
        </div> : <div className="empty-state">DATI NON DISPONIBILI: nessun trade chiuso verificabile.</div>}
      </section>

      <section className="panel analytics-card-wide">
        <div className="panel-title"><h2>Indicatori in uso</h2><span>engine attivo</span></div>
        <div className="indicator-grid">
          <div><strong>EMA 20/50/200</strong><span>Trend stack</span></div>
          <div><strong>RSI 14</strong><span>Momentum</span></div>
          <div><strong>MACD Hist</strong><span>Espansione</span></div>
          <div><strong>ADX / DI</strong><span>Forza trend</span></div>
          <div><strong>Bollinger</strong><span>Volatilita</span></div>
          <div><strong>Order Block</strong><span>SMC/ICT</span></div>
          <div><strong>Fair Value Gap</strong><span>Liquidita</span></div>
          <div><strong>ATR</strong><span>SL/TP size</span></div>
        </div>
      </section>
    </div>
  );
}
