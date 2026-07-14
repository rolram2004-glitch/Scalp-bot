import { StatusSnapshot } from '../types';

function money(value = 0) {
  const sign = value >= 0 ? '+' : '-';
  return `${sign}$${Math.abs(value).toFixed(2)}`;
}

function pips(value = 0) {
  const sign = value >= 0 ? '+' : '-';
  return `${sign}${Math.abs(value).toFixed(1)} pips`;
}

function price(value?: number) {
  return typeof value === 'number' ? value.toFixed(5) : '-';
}

function time(value?: string) {
  return value ? new Date(value).toLocaleTimeString() : '-';
}

function confidenceClass(value?: number) {
  if ((value || 0) >= 78) return 'hot';
  if ((value || 0) >= 68) return 'warm';
  return 'cool';
}

function sourceLabel(status: StatusSnapshot | null, oandaStatus?: any) {
  return oandaStatus?.connected ? 'OANDA MARKET DATA' : 'OANDA DISCONNECTED';
}

function TradeFeedCard({ trade }: { trade: any }) {
  const isBuy = trade.side === 'BUY';
  const isOpen = trade.status === 'OPEN';
  const confidence = trade.confidence || 72;

  return (
    <article className={`feed-card ${isBuy ? 'buy' : 'sell'}`}>
      <div className="feed-direction">{isBuy ? 'BUY' : 'SELL'}</div>
      <div className="feed-main">
        <div className="feed-head">
          <div>
            <strong>{trade.symbol}</strong>
            <span className={`badge ${isOpen ? 'open' : 'closed'}`}>{trade.status}</span>
            <span className="badge setup">{trade.setupType || 'EMA_STACK'}</span>
          </div>
          <div className={trade.pnl >= 0 ? 'money win' : 'money loss'}>{money(trade.pnl || 0)}</div>
        </div>
        <div className="feed-meta">
          {time(trade.openedAt)} · 0.01 lot · {price(trade.entryPrice)} - {price(trade.currentPrice)}
        </div>
        <div className="feed-risk">
          <span>SL {price(trade.stopLoss)}</span>
          <span>TP {price(trade.takeProfit)}</span>
          <span>R:R 1:2.0</span>
          <span>{pips(trade.pnlPips || trade.pnl || 0)}</span>
        </div>
        <p>{trade.reasoning || 'EMA stack, momentum and risk filters aligned.'}</p>
        <div className="confidence-row">
          <div className="confidence-track">
            <div className={`confidence-fill ${confidenceClass(confidence)}`} style={{ width: `${Math.min(confidence, 100)}%` }} />
          </div>
          <span>{confidence}%</span>
        </div>
      </div>
    </article>
  );
}

export function TerminalPage({ status, marketData, news = [], oandaStatus }: { status: StatusSnapshot | null; marketData: Record<string, any>; news?: any[]; oandaStatus?: any; }) {
  const openTrades = status?.openTrades || [];
  const closedTrades = status?.closedTrades || [];
  const feed = [...openTrades, ...closedTrades].slice(0, 12);
  const pnlToday = [...openTrades, ...closedTrades].reduce((sum, trade) => sum + (trade.pnl || 0), 0);
  const wins = closedTrades.filter((trade: any) => (trade.pnl || 0) > 0).length;
  const losses = closedTrades.filter((trade: any) => (trade.pnl || 0) <= 0).length;
  const winRate = closedTrades.length > 0 ? Math.round((wins / closedTrades.length) * 1000) / 10 : 0;
  const marketRows = Object.entries(marketData || {}).slice(0, 10);

  return (
    <div className="terminal-page">
      <section className="page-hero terminal-hero">
        <div>
          <p className="eyebrow">Terminal</p>
          <h1>Esecuzione in tempo reale e stato del bot.</h1>
        </div>
        <div className={status?.isRunning ? 'system-active' : 'system-offline'}>
          {status?.isRunning ? `SYSTEM ACTIVE - ${sourceLabel(status, oandaStatus)}` : 'SYSTEM STOPPED'}
        </div>
      </section>

      <section className="metric-grid">
        <div className="metric-card">
          <span>P&L oggi</span>
          <strong className={pnlToday >= 0 ? 'win' : 'loss'}>{money(pnlToday)}</strong>
          <small>Calcolato solo da trade paper con prezzi OANDA</small>
        </div>
        <div className="metric-card">
          <span>Win rate</span>
          <strong>{winRate.toFixed(1)}%</strong>
          <small><b className="win">{wins}W</b> - <b className="loss">{losses}L</b></small>
        </div>
        <div className="metric-card">
          <span>Trade oggi</span>
          <strong>{status?.dailyTradeCount || 0} <em>/ {status?.maxDailyTrades || 0}</em></strong>
          <div className="mini-track"><div style={{ width: `${Math.min(((status?.dailyTradeCount || 0) / Math.max(status?.maxDailyTrades || 1, 1)) * 100, 100)}%` }} /></div>
        </div>
        <div className="metric-card">
          <span>Posizioni aperte</span>
          <strong className="accent">{openTrades.length}</strong>
          <small>Ultimo segnale: {status?.currentAction || 'HOLD'}</small>
        </div>
      </section>

      <section className="panel feed-panel">
        <div className="panel-title">
          <h2>Live trade feed</h2>
          <span>{status?.executionMode || 'PAPER TRADING'}</span>
        </div>
        <div className="feed-list">
          {feed.length > 0 ? feed.map((trade: any) => <TradeFeedCard key={trade.id} trade={trade} />) : (
            <div className="empty-state">In attesa del primo trade. Premi START se il bot e fermo.</div>
          )}
        </div>
      </section>

      <section className="panel scanner-panel">
        <div className="panel-title"><h2>Market scanner</h2><span>{sourceLabel(status, oandaStatus)}</span></div>
        <div className="scanner-table">
          <table>
            <thead>
              <tr><th>Pair</th><th>Price</th><th>Trend</th><th>Signal</th><th>Confidence</th><th>Data</th></tr>
            </thead>
            <tbody>
              {marketRows.map(([symbol, item]: [string, any]) => (
                <tr key={symbol}>
                  <td>{symbol}</td>
                  <td>{price(item.closePrice)}</td>
                  <td><span className={item.trend === 'BULLISH' ? 'win' : 'loss'}>{item.trend}</span></td>
                  <td>{status?.currentSymbol === symbol ? status?.currentAction : '-'}</td>
                  <td>{status?.currentSymbol === symbol ? `${status?.currentConfidence || 0}%` : '-'}</td>
                  <td>{item.closePrice ? 'OANDA' : 'NON DISP.'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel log-panel">
        <div className="panel-title"><h2>Decision stream</h2><span>{status?.session || 'SESSION'}</span></div>
        <div className="log-list">
          <div className="log-entry strong">Current: {status?.currentSymbol || '-'} {status?.currentAction || '-'} {status?.currentConfidence ?? '-'}%</div>
          {(status?.logs || []).slice(-14).reverse().map((line, index) => (
            <div key={`${line}-${index}`} className="log-entry">{line}</div>
          ))}
        </div>
      </section>

      <section className="panel news-panel">
        <div className="panel-title"><h2>News guard</h2><span>{news.length ? `${news.length} eventi` : 'non configurato'}</span></div>
        <div className="news-list">
          {news.length > 0 ? news.map((item: any) => (
            <div key={item.id} className={`news-row ${String(item.impact).toLowerCase()}`}>
              <div><strong>{item.currency}</strong><span>{new Date(item.time).toLocaleTimeString()}</span></div>
              <div><strong>{item.title}</strong><span>{item.note}</span></div>
              <b>{item.impact}</b>
            </div>
          )) : <div className="empty-state">Calendario news reale non collegato. Nessuna news viene inventata.</div>}
        </div>
      </section>
    </div>
  );
}
