import { BotTrade, OandaStatus, StatusSnapshot } from '../types';

function money(value: number | undefined, currency?: string) {
  if (typeof value !== 'number' || !Number.isFinite(value) || !currency) return 'N/A';
  const sign = value >= 0 ? '+' : '-';
  return `${sign}${Math.abs(value).toFixed(2)} ${currency}`;
}

function pips(value?: number) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'N/A';
  const sign = value >= 0 ? '+' : '-';
  return `${sign}${Math.abs(value).toFixed(1)} pips`;
}

function price(value?: number) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value.toFixed(5) : 'N/A';
}

function time(value?: string) {
  if (!value) return 'N/A';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 'N/A' : parsed.toLocaleTimeString();
}

function fresh(value?: string, maxAgeMs = 15000) {
  if (!value) return false;
  const parsed = Date.parse(value);
  const age = Date.now() - parsed;
  return Number.isFinite(parsed) && age >= -5000 && age <= maxAgeMs;
}

function confidenceClass(value: number) {
  if (value >= 78) return 'hot';
  if (value >= 68) return 'warm';
  return 'cool';
}

function sourceLabel(status: StatusSnapshot | null, oandaStatus?: OandaStatus) {
  return oandaStatus?.connected && status?.priceFeedStatus === 'CONNECTED' && fresh(status.lastPriceAt)
    ? 'OANDA 1S MARKET DATA'
    : oandaStatus?.connected ? 'OANDA FEED STALE / UNAVAILABLE' : 'OANDA DISCONNECTED';
}

function textValue(value: unknown) {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
}

function resolvedTradeMode(trade: BotTrade, fallback?: string) {
  return textValue(
    trade.executionMode ??
    trade.mode ??
    (trade.source === 'PAPER' || trade.id?.startsWith('PAPER-') ? 'PAPER' : fallback)
  );
}

function isPaperMode(mode?: string) {
  return String(mode || '').toUpperCase().includes('PAPER');
}

function quoteCurrency(symbol?: string) {
  const normalized = String(symbol || '').toUpperCase().replace(/[^A-Z]/g, '');
  return normalized.length >= 6 ? normalized.slice(-3) : undefined;
}

function TradeFeedCard({
  trade,
  currency,
  dataSource,
  executionMode
}: {
  trade: BotTrade;
  currency?: string;
  dataSource?: string;
  executionMode?: string;
}) {
  const isBuy = trade.side === 'BUY';
  const isOpen = trade.status === 'OPEN';
  const confidence = typeof trade.confidence === 'number' && Number.isFinite(trade.confidence)
    ? trade.confidence
    : undefined;
  const units = textValue(trade.units ?? trade.initialUnits ?? trade.currentUnits);
  const orderId = textValue(trade.oandaOrderId ?? trade.oandaOrderID ?? trade.orderId ?? trade.orderID);
  const oandaTradeId = textValue(trade.oandaTradeId ?? trade.oandaTradeID ?? trade.tradeId ?? trade.tradeID);
  const source = textValue(trade.source ?? trade.dataSource ?? dataSource) || 'N/A';
  const mode = resolvedTradeMode(trade, executionMode) || 'N/A';
  const paperTrade = isPaperMode(mode);
  const pnlCurrency = paperTrade ? quoteCurrency(trade.symbol) : textValue(trade.accountCurrency ?? currency);
  const verifiedOandaTrade = trade.source === 'OANDA' && trade.verificationStatus === 'VERIFIED';
  const formattedPnl = paperTrade || verifiedOandaTrade ? money(trade.pnl, pnlCurrency) : 'N/A';
  const meta = [
    trade.openedAt ? time(trade.openedAt) : undefined,
    units ? `Units ${units}` : undefined,
    typeof trade.entryPrice === 'number' ? `Entry ${price(trade.entryPrice)}` : undefined,
    typeof trade.currentPrice === 'number' ? `Current ${price(trade.currentPrice)}` : undefined
  ].filter(Boolean);
  const riskItems = [
    typeof trade.stopLoss === 'number' ? `SL ${price(trade.stopLoss)}` : undefined,
    typeof trade.takeProfit === 'number' ? `TP ${price(trade.takeProfit)}` : undefined,
    typeof trade.riskRewardRatio === 'number' && Number.isFinite(trade.riskRewardRatio)
      ? `R:R 1:${trade.riskRewardRatio.toFixed(1)}`
      : undefined,
    typeof trade.pnlPips === 'number' ? pips(trade.pnlPips) : undefined
  ].filter((item): item is string => Boolean(item));

  return (
    <article className={`feed-card ${isBuy ? 'buy' : 'sell'}`}>
      <div className="feed-direction">{trade.side || 'N/A'}</div>
      <div className="feed-main">
        <div className="feed-head">
          <div>
            <strong>{trade.symbol || 'N/A'}</strong>
            {trade.status && <span className={`badge ${isOpen ? 'open' : 'closed'}`}>{trade.status}</span>}
            {trade.setupType && <span className="badge setup">{trade.setupType}</span>}
          </div>
          <div className={typeof trade.pnl === 'number' ? trade.pnl < 0 ? 'money loss' : 'money win' : 'money'}>
            {formattedPnl}{formattedPnl !== 'N/A' && paperTrade ? ' PAPER' : ''}
          </div>
        </div>
        <div className="feed-source">
          <span>Source: {source}</span>
          <span>Mode: {mode}</span>
        </div>
        {meta.length > 0 && <div className="feed-meta">{meta.join(' | ')}</div>}
        {(orderId || oandaTradeId) && (
          <div className="feed-identifiers">
            {orderId && <span>OANDA ORDER ID: {orderId}</span>}
            {oandaTradeId && <span>OANDA TRADE ID: {oandaTradeId}</span>}
          </div>
        )}
        {riskItems.length > 0 && <div className="feed-risk">{riskItems.map((item) => <span key={item}>{item}</span>)}</div>}
        {trade.reasoning && <p>{trade.reasoning}</p>}
        {confidence !== undefined && (
          <div className="confidence-row">
            <div className="confidence-track">
              <div className={`confidence-fill ${confidenceClass(confidence)}`} style={{ width: `${Math.min(Math.max(confidence, 0), 100)}%` }} />
            </div>
            <span>{confidence}%</span>
          </div>
        )}
      </div>
    </article>
  );
}

export function TerminalPage({ status, marketData, news = [], oandaStatus }: { status: StatusSnapshot | null; marketData: Record<string, any>; news?: any[]; oandaStatus?: OandaStatus; }) {
  const openTrades = status?.openTrades || [];
  const closedTrades = status?.closedTrades || [];
  const feed = [
    ...openTrades,
    ...closedTrades.slice(0, Math.max(0, 20 - openTrades.length))
  ];
  const accountCurrency = textValue(oandaStatus?.currency ?? status?.accountCurrency);
  const paperExecution = isPaperMode(status?.executionMode);
  const eligibleTrades = [...openTrades, ...closedTrades].filter((trade) => paperExecution
    ? trade.source === 'PAPER'
    : trade.source === 'OANDA' && trade.verificationStatus === 'VERIFIED');
  const pnlValues = eligibleTrades
    .map((trade) => trade.pnl)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  const pnlToday = !paperExecution && pnlValues.length > 0
    ? pnlValues.reduce((sum, value) => sum + value, 0)
    : undefined;
  const closedPnl = closedTrades
    .filter((trade) => paperExecution
      ? trade.source === 'PAPER'
      : trade.source === 'OANDA' && trade.verificationStatus === 'VERIFIED')
    .map((trade) => trade.pnl)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  const wins = closedPnl.filter((value) => value > 0).length;
  const losses = closedPnl.filter((value) => value < 0).length;
  const decidedTrades = wins + losses;
  const winRate = decidedTrades > 0 ? Math.round((wins / decidedTrades) * 1000) / 10 : undefined;
  const configuredSymbols = status?.symbols || [];
  const marketSymbols = [
    ...configuredSymbols,
    ...Object.keys(marketData || {}).filter((symbol) => !configuredSymbols.includes(symbol))
  ];
  const marketRows = marketSymbols.map((symbol) => [symbol, marketData?.[symbol]] as const);

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
          <strong className={typeof pnlToday === 'number' ? pnlToday < 0 ? 'loss' : 'win' : ''}>{money(pnlToday, accountCurrency)}</strong>
          <small>{paperExecution ? 'P&L aggregato PAPER: N/A (conversione conto non verificata)' : `Valuta conto: ${accountCurrency || 'N/A'}`}</small>
        </div>
        <div className="metric-card">
          <span>Win rate</span>
          <strong>{winRate === undefined ? 'N/A' : `${winRate.toFixed(1)}%`}</strong>
          <small>{decidedTrades > 0 ? <><b className="win">{wins}W</b> - <b className="loss">{losses}L</b></> : 'Nessun esito disponibile'}</small>
        </div>
        <div className="metric-card">
          <span>Trade oggi</span>
          <strong>{status ? status.dailyTradeCount : 'N/A'} {status ? <em>/ {status.maxDailyTrades}</em> : null}</strong>
          {status && <div className="mini-track"><div style={{ width: `${Math.min((status.dailyTradeCount / Math.max(status.maxDailyTrades, 1)) * 100, 100)}%` }} /></div>}
        </div>
        <div className="metric-card">
          <span>Posizioni aperte</span>
          <strong className="accent">{status ? openTrades.length : 'N/A'}</strong>
          <small>Ultimo segnale: {status?.currentAction || 'N/A'}</small>
        </div>
      </section>

      <section className="panel feed-panel">
        <div className="panel-title">
          <h2>Trade feed</h2>
          <span>{status?.executionMode || 'N/A'}</span>
        </div>
        <div className="feed-list">
          {feed.length > 0 ? feed.map((trade) => (
            <TradeFeedCard
              key={trade.id}
              trade={trade}
              currency={accountCurrency}
              dataSource={status?.dataSource}
              executionMode={status?.executionMode}
            />
          )) : (
            <div className="empty-state">In attesa del primo trade. Premi START se il bot e fermo.</div>
          )}
        </div>
      </section>

      <section className="panel scanner-panel">
        <div className="panel-title"><h2>Market scanner</h2><span>{marketRows.length} strumenti | {sourceLabel(status, oandaStatus)}</span></div>
        <div className="scanner-table">
          <table>
            <thead>
              <tr><th>Pair</th><th>Price</th><th>Trend</th><th>Signal</th><th>Confidence</th><th>Last tick</th><th>Data</th></tr>
            </thead>
            <tbody>
              {marketRows.map(([symbol, item]) => {
                const signal = status?.lastSignals?.[symbol];
                const livePrice = status?.livePrices?.[symbol];
                const livePriceFresh = fresh(livePrice?.time);
                const trendClass = item?.trend === 'BULLISH' ? 'win' : item?.trend === 'BEARISH' ? 'loss' : '';
                return (
                  <tr key={symbol}>
                    <td>{symbol}</td>
                    <td>{price(livePrice?.mid ?? item?.closePrice)}</td>
                    <td>{item?.trend ? <span className={trendClass}>{item.trend}</span> : 'N/A'}</td>
                    <td>{signal?.action || 'N/A'}</td>
                    <td>{typeof signal?.confidence === 'number' ? `${signal.confidence}%` : 'N/A'}</td>
                    <td>{livePrice?.time ? time(livePrice.time) : 'N/A'}</td>
                    <td>{livePriceFresh ? 'OANDA 1S' : livePrice ? 'OANDA STALE' : typeof item?.closePrice === 'number' && Number.isFinite(item.closePrice) ? 'OANDA M5' : 'NON DISP.'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel log-panel">
        <div className="panel-title"><h2>Decision stream</h2><span>{status?.session || 'SESSION'}</span></div>
        <div className="log-list">
          <div className="log-entry strong">Current: {status?.currentSymbol || 'N/A'} {status?.currentAction || 'N/A'} {typeof status?.currentConfidence === 'number' ? `${status.currentConfidence}%` : 'N/A'}</div>
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
