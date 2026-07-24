import { useEffect, useMemo, useState } from 'react';
import { fetchIntelligence } from '../services/api';
import { BotTrade, OandaStatus, SignalLaneSnapshot, StatusSnapshot } from '../types';
import '../setup.css';

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function numberValue(value: unknown) {
  if (value === null || value === undefined || value === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function text(value: unknown) {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (finite(value)) return String(value);
  return 'N/A';
}

function cleanSymbol(value: unknown) {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function digits(symbol: string) {
  return symbol.includes('JPY') || symbol.includes('XAU') ? 3 : 5;
}

function price(value: unknown, symbol = '') {
  const parsed = numberValue(value);
  return parsed !== undefined && parsed > 0 ? parsed.toFixed(digits(symbol)) : 'N/A';
}

function dateTime(value?: string) {
  if (!value) return 'N/A';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 'N/A' : parsed.toLocaleString();
}

function freshness(value?: string, maximumAgeMs = 15000) {
  if (!value) return { fresh: false, age: 'N/A' };
  const parsed = Date.parse(value);
  const ageMs = Date.now() - parsed;
  if (!Number.isFinite(parsed) || ageMs < -5000) return { fresh: false, age: 'N/A' };
  const seconds = Math.max(0, Math.round(ageMs / 1000));
  return { fresh: ageMs <= maximumAgeMs, age: seconds < 60 ? `${seconds}s` : `${Math.floor(seconds / 60)}m` };
}

function money(value: unknown, currency?: string, signed = false) {
  const parsed = numberValue(value);
  if (parsed === undefined || !currency) return 'N/A';
  const sign = signed && parsed > 0 ? '+' : '';
  return `${sign}${parsed.toFixed(2)} ${currency}`;
}

function variantClass(value?: string) {
  return value === 'BUY' || value === 'BULLISH' ? 'positive' : value === 'SELL' || value === 'BEARISH' ? 'negative' : 'neutral';
}

function Gate({ label, value, detail, state }: { label: string; value: string; detail: string; state: 'ok' | 'warn' | 'bad' | 'idle' }) {
  return (
    <article className={`command-gate ${state}`}>
      <div className="gate-light" />
      <div><span>{label}</span><strong>{value}</strong><p>{detail}</p></div>
    </article>
  );
}

function Lane({ lane }: { lane?: SignalLaneSnapshot }) {
  if (!lane) return <div className="lane-command empty-state">DATI NON DISPONIBILI</div>;
  const liveReceipt = lane.selectedForExecution && lane.executionState === 'OPEN_VERIFIED';
  return (
    <article className={`lane-command ${lane.variant.toLowerCase()} ${lane.selectedForExecution ? 'selected' : ''}`}>
      <header><div><span>{lane.variant} LANE</span><strong className={variantClass(lane.action)}>{lane.action}</strong></div><b>{lane.mode}</b></header>
      <div className="lane-kpis"><div><span>Confidence</span><strong>{finite(lane.confidence) ? `${lane.confidence}%` : 'N/A'}</strong></div><div><span>Execution</span><strong>{lane.executionState}</strong></div></div>
      <dl>
        <dt>Setup</dt><dd>{lane.setupType || 'N/A'}</dd>
        <dt>Reason</dt><dd>{lane.executionReason || (liveReceipt ? 'VERIFIED BY OANDA' : 'N/A')}</dd>
        <dt>Order ID</dt><dd>{lane.oandaOrderId || 'N/A'}</dd>
        <dt>Trade ID</dt><dd>{lane.oandaTradeId || 'N/A'}</dd>
      </dl>
      <p>{lane.reasoning || 'N/A'}</p>
    </article>
  );
}

function Receipt({ trade }: { trade: BotTrade }) {
  return (
    <article className="receipt-card">
      <header><strong>{trade.symbol || 'N/A'} · {trade.side || 'N/A'}</strong><b>{trade.verificationStatus || 'N/A'}</b></header>
      <div className="receipt-grid">
        <div><span>OANDA TRADE ID</span><strong>{trade.oandaTradeId || trade.oandaTradeID || trade.tradeId || 'N/A'}</strong></div>
        <div><span>OANDA ORDER ID</span><strong>{trade.oandaOrderId || trade.oandaOrderID || trade.orderId || 'N/A'}</strong></div>
        <div><span>Units</span><strong>{text(trade.units)}</strong></div>
        <div><span>Variant</span><strong>{trade.strategyVariant || 'N/A'}</strong></div>
        <div><span>Entry</span><strong>{price(trade.entryPrice, cleanSymbol(trade.symbol))}</strong></div>
        <div><span>Stop / TP</span><strong>{price(trade.stopLoss, cleanSymbol(trade.symbol))} / {price(trade.takeProfit, cleanSymbol(trade.symbol))}</strong></div>
      </div>
    </article>
  );
}

export function SetupPage({ status, news = [], oandaStatus = {} }: { status: StatusSnapshot | null; news?: any[]; oandaStatus?: OandaStatus }) {
  const symbols = status?.symbols?.length ? status.symbols.map(cleanSymbol) : [];
  const [selectedSymbol, setSelectedSymbol] = useState('XAUUSD');
  const [intelligence, setIntelligence] = useState<any>(null);
  const [intelligenceError, setIntelligenceError] = useState('');
  const accountCurrency = oandaStatus.currency || status?.accountCurrency;
  const accountConnected = oandaStatus.connected === true;
  const priceState = freshness(status?.lastPriceAt);
  const feedConnected = accountConnected && status?.priceFeedStatus === 'CONNECTED' && priceState.fresh;
  const liveRequested = status?.tradingMode === 'LIVE';
  const liveReady = Boolean(liveRequested && status?.liveTradingEnabled && status?.liveExecutionVariantValid && accountConnected && feedConnected && status?.reconciliationStatus === 'VERIFIED');
  const candleCoverage = symbols.filter((symbol) => Number(status?.marketData?.[symbol]?.candleCount || 0) >= 200).length;
  const selectedMarket = status?.marketData?.[selectedSymbol];
  const selectedPair = status?.pairedSignals?.[selectedSymbol];
  const selectedQuote = status?.livePrices?.[selectedSymbol];
  const quoteState = freshness(selectedQuote?.time);
  const verifiedOpen = (status?.openTrades || []).filter((trade) => trade.source === 'OANDA' && trade.verificationStatus === 'VERIFIED');
  const orphans = (status?.openTrades || []).filter((trade) => trade.source === 'LOCAL_ORPHAN' || trade.verificationStatus === 'NOT_VERIFIED');
  const protectiveReceipt = verifiedOpen.some((trade) => finite(trade.stopLoss) && finite(trade.takeProfit) && Boolean(trade.oandaTradeId));

  useEffect(() => {
    let disposed = false;
    const refresh = () => fetchIntelligence(selectedSymbol)
      .then((data) => {
        if (disposed) return;
        setIntelligence(data);
        setIntelligenceError('');
      })
      .catch(() => {
        if (disposed) return;
        setIntelligence(null);
        setIntelligenceError('MULTI-TIMEFRAME OANDA DATA UNAVAILABLE');
      });
    void refresh();
    const timer = window.setInterval(() => void refresh(), 30000);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [selectedSymbol]);

  const matrix = useMemo(() => symbols.map((symbol) => {
    const market = status?.marketData?.[symbol];
    const quote = status?.livePrices?.[symbol];
    const pair = status?.pairedSignals?.[symbol];
    const quoteFresh = freshness(quote?.time).fresh;
    return { symbol, market, quote, pair, quoteFresh };
  }), [status, symbols.join('|')]);

  return (
    <div className="setup-page setup-command">
      <section className="command-hero">
        <div><p className="eyebrow">Mission control / Setup</p><h1>Ogni luce verde richiede una prova reale.</h1><p>Account, feed, analisi ed esecuzione sono sistemi distinti. Il cockpit non riempie spazi con dati simulati.</p></div>
        <div className={`command-mode ${liveReady ? 'live' : liveRequested ? 'blocked' : 'paper'}`}><span>EXECUTION MODE</span><strong>{liveReady ? `LIVE OANDA ${status?.liveExecutionVariant}` : liveRequested ? 'LIVE BLOCKED' : 'PAPER · NO OANDA ORDERS'}</strong><small>{status?.isRunning ? 'Scanner running' : 'Scanner stopped'} · {symbols.length || 'N/A'} instruments</small></div>
      </section>

      <section className="account-ribbon">
        <div><span>OANDA ACCOUNT</span><strong>{accountConnected ? 'AUTHENTICATED' : 'DISCONNECTED'}</strong><small>{oandaStatus.accountId || 'ID N/A'} · {oandaStatus.mode || 'practice'}</small></div>
        <div><span>ACCOUNT CURRENCY</span><strong>{accountCurrency || 'N/A'}</strong><small>API source only</small></div>
        <div><span>BALANCE</span><strong>{money(oandaStatus.balance, accountCurrency)}</strong><small>Last check {dateTime(oandaStatus.checkedAt)}</small></div>
        <div><span>NAV</span><strong>{money(oandaStatus.nav, accountCurrency)}</strong><small>State {oandaStatus.state || 'N/A'}</small></div>
        <div><span>UNREALIZED P&amp;L</span><strong>{money(oandaStatus.unrealizedPL, accountCurrency, true)}</strong><small>{text(oandaStatus.openTradeCount)} trades · {text(oandaStatus.openPositionCount)} positions</small></div>
        <div><span>ENDPOINT</span><strong>OANDA PRACTICE</strong><small>{oandaStatus.endpoint || 'https://api-fxpractice.oanda.com/v3'}</small></div>
      </section>

      <section className="gate-grid">
        <Gate label="Account authentication" value={accountConnected ? 'PASS' : 'BLOCKED'} detail={accountConnected ? `Account and ${accountCurrency || 'currency'} returned by OANDA` : oandaStatus.errorCode || oandaStatus.reason || 'No verified account response'} state={accountConnected ? 'ok' : 'bad'} />
        <Gate label="One-second price feed" value={feedConnected ? 'FRESH' : 'UNAVAILABLE'} detail={`${status?.priceCoverage ?? 'N/A'} / ${status?.priceExpected ?? (symbols.length || 'N/A')} instruments · last tick ${priceState.age}`} state={feedConnected ? 'ok' : 'bad'} />
        <Gate label="Candle analysis" value={symbols.length ? `${candleCoverage}/${symbols.length}` : 'N/A'} detail="At least 200 real OANDA candles required per analyzed symbol" state={symbols.length && candleCoverage === symbols.length ? 'ok' : candleCoverage > 0 ? 'warn' : 'idle'} />
        <Gate label="Exclusive execution lane" value={status?.liveExecutionVariantValid ? status.liveExecutionVariant : 'INVALID'} detail={liveRequested ? 'Exactly one lane may submit' : 'Selector stored; ignored while PAPER'} state={status?.liveExecutionVariantValid ? 'ok' : 'bad'} />
        <Gate label="OANDA reconciliation" value={status?.reconciliationStatus || 'NOT_RUN'} detail={`Last verified sync ${dateTime(status?.lastReconciledAt)}`} state={status?.reconciliationStatus === 'VERIFIED' ? 'ok' : liveRequested ? 'bad' : 'idle'} />
        <Gate label="Protective orders" value={protectiveReceipt ? 'VERIFIED' : 'N/A'} detail={protectiveReceipt ? 'Open receipt includes OANDA SL and TP' : 'No currently open OANDA receipt proves SL + TP'} state={protectiveReceipt ? 'ok' : liveRequested ? 'warn' : 'idle'} />
        <Gate label="XAUUSD execution" value="ANALYSIS ONLY" detail="Structural engine active; order and partial-close validation pending" state="warn" />
        <Gate label="Economic calendar" value={news.length ? 'CONNECTED' : 'NOT CONFIGURED'} detail={news.length ? 'Events received from configured source' : 'Completely separated from trading logic'} state={news.length ? 'ok' : 'idle'} />
      </section>

      <section className="command-panel matrix-panel">
        <header><div><span>SCAN UNIVERSE</span><h2>16-instrument truth matrix</h2></div><b>{status?.signalsAnalyzed ?? 'N/A'} analyses · {status?.signalsDiscarded ?? 'N/A'} discarded</b></header>
        <div className="matrix-scroll"><table className="truth-matrix"><thead><tr><th>Instrument</th><th>Feed / price</th><th>Candles</th><th>Structure</th><th>MAIN</th><th>INVERSE</th><th>Execution</th></tr></thead><tbody>
          {matrix.map(({ symbol, market, quote, pair, quoteFresh }) => (
            <tr key={symbol} className={selectedSymbol === symbol ? 'selected' : ''} onClick={() => setSelectedSymbol(symbol)}>
              <td><strong>{symbol}</strong><small>{symbol === 'XAUUSD' ? 'DEDICATED · ANALYSIS ONLY' : market?.timeframe || 'M5'}</small></td>
              <td><strong>{price(quote?.mid ?? market?.closePrice, symbol)}</strong><small className={quoteFresh ? 'positive' : 'neutral'}>{quoteFresh ? 'OANDA 1S FRESH' : market ? 'OANDA CANDLE' : 'N/A'}</small></td>
              <td><strong>{market?.candleCount ?? 'N/A'}</strong><small>{dateTime(market?.candleTime)}</small></td>
              <td><strong className={variantClass(market?.structureBias)}>{market?.structureBias || 'N/A'}</strong><small>BOS {market?.breakOfStructure || 'N/A'} · CHoCH {market?.changeOfCharacter || 'N/A'}</small></td>
              <td><strong className={variantClass(pair?.main?.action)}>{pair?.main?.action || 'N/A'}</strong><small>{finite(pair?.main?.confidence) ? `${pair.main.confidence}%` : 'N/A'}</small></td>
              <td><strong className={variantClass(pair?.inverse?.action)}>{pair?.inverse?.action || 'N/A'}</strong><small>{pair?.inverse?.derivedFrom ? 'DERIVED SAME SNAPSHOT' : 'N/A'}</small></td>
              <td><strong>{pair?.main?.selectedForExecution ? pair.main.executionState : pair?.inverse?.selectedForExecution ? pair.inverse.executionState : symbol === 'XAUUSD' ? 'ANALYSIS ONLY' : status?.tradingMode === 'PAPER' ? 'PAPER / SHADOW' : 'BLOCKED'}</strong><small>{pair?.pairId || 'Pair ID N/A'}</small></td>
            </tr>
          ))}
          {matrix.length === 0 && <tr><td colSpan={7}>DATI NON DISPONIBILI</td></tr>}
        </tbody></table></div>
      </section>

      <section className="inspector-grid">
        <div className="command-panel instrument-inspector">
          <header><div><span>INSTRUMENT INSPECTOR</span><h2>{selectedSymbol}</h2></div><b>{quoteState.fresh ? `TICK ${quoteState.age} AGO` : 'NO FRESH TICK'}</b></header>
          <div className="quote-tape"><div><span>Bid</span><strong>{price(selectedQuote?.bid, selectedSymbol)}</strong></div><div><span>Ask</span><strong>{price(selectedQuote?.ask, selectedSymbol)}</strong></div><div><span>Spread</span><strong>{text(selectedMarket?.spread)}</strong></div><div><span>ATR</span><strong>{price(selectedMarket?.atr, selectedSymbol)}</strong></div><div><span>RSI</span><strong>{numberValue(selectedMarket?.rsi)?.toFixed(1) || 'N/A'}</strong></div><div><span>MACD hist</span><strong>{numberValue(selectedMarket?.macdHistogram)?.toFixed(6) || 'N/A'}</strong></div></div>
          <div className="structure-board">
            <div><span>Structure</span><strong className={variantClass(selectedMarket?.structureBias)}>{selectedMarket?.structureBias || 'N/A'}</strong></div><div><span>BOS / CHoCH</span><strong>{selectedMarket?.breakOfStructure || 'N/A'} / {selectedMarket?.changeOfCharacter || 'N/A'}</strong></div><div><span>Liquidity sweep</span><strong>{selectedMarket?.liquiditySweep || 'N/A'}</strong></div><div><span>FVG</span><strong>{selectedMarket?.fairValueGap || 'N/A'} {selectedMarket?.fairValueGapZone ? `${price(selectedMarket.fairValueGapZone.low, selectedSymbol)}–${price(selectedMarket.fairValueGapZone.high, selectedSymbol)}` : ''}</strong></div><div><span>Supports</span><strong>{selectedMarket?.supportLevels?.length ? selectedMarket.supportLevels.map((item: number) => price(item, selectedSymbol)).join(' · ') : 'N/A'}</strong></div><div><span>Resistances</span><strong>{selectedMarket?.resistanceLevels?.length ? selectedMarket.resistanceLevels.map((item: number) => price(item, selectedSymbol)).join(' · ') : 'N/A'}</strong></div>
          </div>
          <div className="mtf-board">
            {(intelligence?.frames || []).map((frame: any) => <div key={frame.timeframe} className={frame.available ? variantClass(frame.direction) : 'neutral'}><span>{frame.timeframe}</span><strong>{frame.available ? frame.direction : 'N/A'}</strong><small>{frame.available ? `${frame.structure || 'N/A'} · ${frame.alignmentScore ?? 'N/A'}%` : frame.reason || 'UNAVAILABLE'}</small></div>)}
            {!intelligence && <div className="empty-state">{intelligenceError || 'MULTI-TIMEFRAME DATA N/A'}</div>}
          </div>
        </div>

        <div className="command-panel snapshot-panel">
          <header><div><span>SHARED SIGNAL ENVELOPE</span><h2>{selectedPair?.pairId || 'NO PAIR YET'}</h2></div><b>{dateTime(selectedPair?.evaluatedAt)}</b></header>
          {selectedPair ? <><div className="envelope-proof"><div><span>OANDA tick</span><strong>{dateTime(selectedPair.market.time)}</strong></div><div><span>Same quote</span><strong>{price(selectedPair.market.bid, selectedSymbol)} / {price(selectedPair.market.ask, selectedSymbol)}</strong></div><div><span>Validation</span><strong>{selectedPair.marketValid ? 'CAPTURED FRESH' : selectedPair.marketValidationReason || 'BLOCKED'}</strong></div><div><span>Data source</span><strong>{selectedPair.analysis.structureSource || selectedPair.market.source}</strong></div></div><div className="lane-grid"><Lane lane={selectedPair.main} /><Lane lane={selectedPair.inverse} /></div>{selectedPair.executionBlockedReason && <div className="hard-block">EXECUTION BLOCK: {selectedPair.executionBlockedReason}</div>}</> : <div className="empty-state">Nessun pair snapshot reale disponibile per {selectedSymbol}.</div>}
        </div>
      </section>

      <section className="receipt-columns">
        <div className="command-panel"><header><div><span>OANDA SOURCE OF TRUTH</span><h2>Verified open receipts</h2></div><b>{verifiedOpen.length}</b></header><div className="receipt-list">{verifiedOpen.length ? verifiedOpen.map((trade) => <Receipt key={trade.id} trade={trade} />) : <div className="empty-state">Nessuna posizione OANDA verificata aperta.</div>}</div></div>
        <div className="command-panel danger-panel"><header><div><span>RECONCILIATION EXCEPTIONS</span><h2>Local orphans</h2></div><b>{orphans.length}</b></header><div className="receipt-list">{orphans.length ? orphans.map((trade) => <Receipt key={trade.id} trade={trade} />) : <div className="empty-state">Nessun LOCAL ORPHAN / NOT VERIFIED.</div>}</div></div>
      </section>

      <section className="receipt-columns">
        <div className="command-panel"><header><div><span>SEPARATE LEDGER</span><h2>Paper shadow</h2></div><b>{status ? `${status.shadowOpenTrades?.length || 0} open · ${status.shadowClosedTrades?.length || 0} closed` : 'N/A'}</b></header><div className="receipt-list">{(status?.shadowOpenTrades || []).slice(0, 8).map((trade) => <article className="shadow-command" key={trade.id}><strong>{trade.strategyVariant || 'SHADOW'} · {trade.symbol} · {trade.side}</strong><span>Entry {price(trade.entryPrice, cleanSymbol(trade.symbol))} · Current {price(trade.currentPrice, cleanSymbol(trade.symbol))}</span><b>NO OANDA ORDER</b></article>)}{status && (status.shadowOpenTrades || []).length === 0 && <div className="empty-state">Nessuna posizione shadow aperta.</div>}</div></div>
        <div className="command-panel"><header><div><span>LAST EXECUTION ATTEMPT</span><h2>{status?.lastOrderStatus || 'N/A'}</h2></div><b>{dateTime(status?.lastOrderAttemptAt)}</b></header><div className="envelope-proof"><div><span>Reason</span><strong>{status?.lastOrderReason || 'N/A'}</strong></div><div><span>Order ID</span><strong>{status?.lastOandaOrderId || 'N/A'}</strong></div><div><span>Trade ID</span><strong>{status?.lastOandaTradeId || 'N/A'}</strong></div><div><span>Mode</span><strong>{status?.executionMode || 'N/A'}</strong></div></div></div>
      </section>

      <section className="command-panel diagnostics-panel">
        <header><div><span>DIAGNOSTICS</span><h2>Strategy and error stream</h2></div><b>Latest {Math.min(status?.logs?.length || 0, 40)} events</b></header>
        {oandaStatus.errorMessage && <div className="hard-block">OANDA {oandaStatus.errorStatus || ''} {oandaStatus.errorCode || ''}: {oandaStatus.errorMessage}</div>}
        <div className="diagnostic-stream">{(status?.logs || []).slice(-40).reverse().map((line, index) => <div key={`${line}-${index}`}><span>{String(index + 1).padStart(2, '0')}</span><p>{line}</p></div>)}{status && status.logs.length === 0 && <div className="empty-state">Nessun evento registrato.</div>}{!status && <div className="empty-state">DATI NON DISPONIBILI</div>}</div>
      </section>

      <section className="command-footer"><div><span>APPLICATION</span><strong>ONLINE</strong><small>Questa pagina e gli endpoint rispondono</small></div><div><span>RAILWAY RESTART POLICY</span><strong>VERIFY IN RAILWAY</strong><small>Non dedotta dal browser</small></div><div><span>CALENDAR</span><strong>{news.length ? 'CONNECTED' : 'NOT CONFIGURED'}</strong><small>Nessun evento inventato</small></div><div><span>SECURITY</span><strong>SECRETS HIDDEN</strong><small>Account ID masked · token never rendered</small></div></section>
    </div>
  );
}
