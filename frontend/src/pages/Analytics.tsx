import { StatusSnapshot } from '../types';
import { executionView, hasVerifiedOandaLedger } from '../trading-state';
import { calculateMonetaryOutcomeSummary } from '../../../src/strategy-metrics';

const COLORS = ['#2f6fed', '#7c5ce7', '#0c9f6e', '#e0a020', '#dd4f68', '#3d91a8'];

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function AnalyticsPage({ analytics, status }: { analytics: any; status?: StatusSnapshot | null }) {
  const mode = executionView(status);
  const liveDataAvailable = hasVerifiedOandaLedger(status);
  const ledgerAvailable = mode.paper || liveDataAvailable;
  const analyticsMode = String(analytics?.executionMode || '').toUpperCase();
  const analyticsModeMatches = mode.paper
    ? analyticsMode === 'PAPER'
    : mode.oanda && Boolean(status?.tradingMode) && analyticsMode.startsWith(String(status?.tradingMode));
  const metricsAvailable = ledgerAvailable && analytics !== null && analytics !== undefined && analyticsModeMatches;
  const allTrades = status ? [...status.closedTrades, ...status.openTrades] : [];
  const trades = ledgerAvailable ? allTrades.filter((trade) => mode.paper
    ? trade.source === 'PAPER'
    : trade.source === 'OANDA' && trade.verificationStatus === 'VERIFIED') : [];
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
  const comparableClosedTrades = (status?.closedTrades || [])
    .filter((trade) => ledgerAvailable && (mode.paper
      ? trade.source === 'PAPER'
      : trade.source === 'OANDA' && trade.verificationStatus === 'VERIFIED'));
  const outcome = calculateMonetaryOutcomeSummary(comparableClosedTrades);
  const closedSeriesCurrency = outcome.currency;
  const closedValues = outcome.comparable
    ? comparableClosedTrades.map((trade) => Number(trade.pnl)).slice(0, 30).reverse()
    : [];
  const maximumMagnitude = Math.max(...closedValues.map((value) => Math.abs(value)), 0);
  const pnlToday = metricsAvailable && finite(analytics?.pnlToday) ? analytics.pnlToday : undefined;
  const winRate = metricsAvailable && outcome.sampleSize > 0 ? outcome.winRate : undefined;
  const wins = metricsAvailable && outcome.sampleSize > 0 ? outcome.wins : undefined;
  const losses = metricsAvailable && outcome.sampleSize > 0 ? outcome.losses : undefined;
  const currency = metricsAvailable && typeof analytics?.pnlCurrency === 'string' && analytics.pnlCurrency.trim()
    ? analytics.pnlCurrency
    : undefined;
  const modeLabel = !mode.known
    ? 'MODE / API UNAVAILABLE'
    : mode.paper
      ? 'PAPER LEDGER'
      : liveDataAvailable
        ? `${mode.demo ? 'OANDA DEMO' : 'OANDA LIVE'} VERIFIED ONLY`
        : `${mode.demo ? 'OANDA DEMO' : 'OANDA LIVE'} DATA UNAVAILABLE`;
  const unavailableReason = !mode.known
    ? 'DATI NON DISPONIBILI: stato applicazione non disponibile.'
    : mode.oanda && !liveDataAvailable
      ? 'DATI NON DISPONIBILI: riconciliazione OANDA non verificata.'
      : 'DATI NON DISPONIBILI.';

  return (
    <div className="analytics-page">
      <section className="page-hero">
        <div><p className="eyebrow">Analytics</p><h1>Performance calcolata soltanto sui trade della corsia corrente.</h1></div>
        <div className="system-warning">{modeLabel}</div>
      </section>

      <section className="metric-grid">
        <div className="metric-card"><span>P&amp;L oggi</span><strong className={pnlToday === undefined ? '' : pnlToday < 0 ? 'loss' : 'win'}>{pnlToday === undefined || !currency ? 'N/A' : `${pnlToday >= 0 ? '+' : '-'}${Math.abs(pnlToday).toFixed(2)} ${currency}`}</strong></div>
        <div className="metric-card"><span>Risultato netto</span><strong className={!finite(outcome.netPnl) ? '' : outcome.netPnl < 0 ? 'loss' : 'win'}>{!finite(outcome.netPnl) || !outcome.currency ? 'N/A' : `${outcome.netPnl >= 0 ? '+' : '-'}${Math.abs(outcome.netPnl).toFixed(2)} ${outcome.currency}`}</strong><small>Vincite + perdite</small></div>
        <div className="metric-card"><span>Guadagni lordi</span><strong className="win">{!finite(outcome.grossProfit) || !outcome.currency ? 'N/A' : `+${outcome.grossProfit.toFixed(2)} ${outcome.currency}`}</strong><small>Somma delle operazioni vinte</small></div>
        <div className="metric-card"><span>Perdite lorde</span><strong className="loss">{!finite(outcome.grossLoss) || !outcome.currency ? 'N/A' : `-${Math.abs(outcome.grossLoss).toFixed(2)} ${outcome.currency}`}</strong><small>Somma delle operazioni perse</small></div>
        <div className="metric-card"><span>Win rate</span><strong>{winRate === undefined ? 'N/A' : `${winRate}%`}</strong><small>{outcome.lossRate === undefined ? 'Campione N/A' : `${outcome.lossRate.toFixed(1)}% loss rate`}</small></div>
        <div className="metric-card"><span>Operazioni vinte</span><strong className="win">{wins ?? 'N/A'}</strong><small>{outcome.winRate === undefined ? 'Percentuale N/A' : `${outcome.winRate.toFixed(1)}% del campione`}</small></div>
        <div className="metric-card"><span>Operazioni perse</span><strong className="loss">{losses ?? 'N/A'}</strong><small>{outcome.lossRate === undefined ? 'Percentuale N/A' : `${outcome.lossRate.toFixed(1)}% del campione`}</small></div>
        <div className="metric-card"><span>Totale chiuse</span><strong>{metricsAvailable ? outcome.sampleSize : 'N/A'}</strong><small>{outcome.currency ? `Valuta reale ${outcome.currency} · non USDT` : 'Valuta non disponibile'}</small></div>
      </section>

      <section className="panel analytics-card-wide">
        <div className="panel-title"><h2>Distribuzione setup</h2><span>{ledgerAvailable ? `${trades.length} trade ${mode.paper ? 'PAPER' : 'OANDA'}` : 'N/A'}</span></div>
        {distributionEntries.length > 0 ? (
          <div className="donut-wrap">
            <div className="donut" style={{ background: `conic-gradient(${donutStops.join(', ')})` }} />
            <div className="donut-legend">
              {distributionEntries.map(([name, count], index) => (
                <div key={name}><b style={{ background: COLORS[index % COLORS.length] }} /><span>{name}</span><strong>{Math.round((count / trades.length) * 100)}%</strong></div>
              ))}
            </div>
          </div>
        ) : <div className="empty-state">{ledgerAvailable ? 'DATI NON DISPONIBILI: nessun setup registrato nella corsia selezionata.' : unavailableReason}</div>}
      </section>

      <section className="panel analytics-card-wide">
        <div className="panel-title"><h2>P&amp;L trade chiusi</h2><span>{closedSeriesCurrency || 'VALUTA N/A'}</span></div>
        {closedValues.length > 0 && maximumMagnitude > 0 ? (
          <div className="bar-chart">
            {closedValues.map((value, index) => (
              <div key={index} className="bar-slot" title={`${value} ${closedSeriesCurrency || ''}`}>
                <div className={value >= 0 ? 'bar positive' : 'bar negative'} style={{ height: `${Math.max(4, (Math.abs(value) / maximumMagnitude) * 100)}%` }} />
              </div>
            ))}
          </div>
        ) : <div className="empty-state">{ledgerAvailable ? 'DATI NON DISPONIBILI: nessun P&L chiuso verificabile.' : unavailableReason}</div>}
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
