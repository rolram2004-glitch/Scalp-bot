import { useEffect, useMemo, useState } from 'react';
import { fetchIntelligence } from '../services/api';
import { BotTrade, OandaStatus, SignalLaneSnapshot, StatusSnapshot } from '../types';
import { executionView, hasFullFreshCoverage, hasVerifiedOandaLedger } from '../trading-state';
import '../setup.css';

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function setupScore(source: { setupScore?: unknown; confidence?: unknown } | null | undefined) {
  const value = finite(source?.setupScore)
    ? source.setupScore
    : finite(source?.confidence)
      ? source.confidence
      : undefined;
  return value === undefined ? undefined : Math.max(0, Math.min(100, Math.round(value)));
}

function setupScoreText(source: { setupScore?: unknown; confidence?: unknown } | null | undefined) {
  const score = setupScore(source);
  return score === undefined ? 'N/A' : `${score}/100`;
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

function Lane({ lane, executionReady, symbol }: { lane?: SignalLaneSnapshot; executionReady: boolean; symbol: string }) {
  if (!lane) return <div className="lane-command empty-state">DATI NON DISPONIBILI</div>;
  const selectedButBlocked = lane.selectedForExecution && !executionReady;
  const executionState = selectedButBlocked ? 'BLOCKED' : lane.executionState;
  const laneMode = selectedButBlocked ? 'OANDA EXECUTION BLOCKED' : lane.mode;
  const liveReceipt = executionReady && lane.selectedForExecution && lane.executionState === 'OPEN_VERIFIED';
  const laneLabel = lane.variant === 'INVERSE' ? 'MIRROR' : 'MAIN';
  return (
    <article className={`lane-command ${lane.variant.toLowerCase()} ${lane.selectedForExecution ? 'selected' : ''}`}>
      <header><div><span>{laneLabel} LANE</span><strong className={variantClass(lane.action)}>{lane.action}</strong></div><b>{laneMode}</b></header>
      <div className="lane-kpis"><div><span>Setup score</span><strong>{setupScoreText(lane)}</strong></div><div><span>Execution</span><strong>{executionState}</strong></div></div>
      <dl>
        <dt>Entry</dt><dd>{price(lane.entryPrice, symbol)}</dd>
        <dt>Stop loss</dt><dd>{price(lane.stopLossPrice, symbol)}</dd>
        <dt>Take profit</dt><dd>{price(lane.takeProfitPrice, symbol)}</dd>
        <dt>Setup</dt><dd>{lane.setupType || 'N/A'}</dd>
        <dt>Reason</dt><dd>{lane.executionReason || (liveReceipt ? 'VERIFIED BY OANDA' : 'N/A')}</dd>
        <dt>Order ID</dt><dd>{lane.oandaOrderId || 'N/A'}</dd>
        <dt>Trade ID</dt><dd>{lane.oandaTradeId || 'N/A'}</dd>
      </dl>
      <p>{lane.selectedForExecution ? lane.variant === 'MAIN' ? 'MAIN OPERATIVA · direzione normale invariata · TP nominale +0,20 CHF · SL nominale -0,60 CHF. ' : 'MIRROR OPERATIVA · BUY→SELL, SELL→BUY · TP nominale +0,20 CHF · SL nominale -0,60 CHF. ' : ''}{lane.reasoning || 'N/A'}</p>
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
  const symbolsKey = symbols.join('|');
  const [selectedSymbol, setSelectedSymbol] = useState('XAUUSD');
  const [intelligence, setIntelligence] = useState<any>(null);
  const [intelligenceSymbol, setIntelligenceSymbol] = useState('');
  const [intelligenceError, setIntelligenceError] = useState('');
  const mode = executionView(status);
  const accountCurrency = oandaStatus.currency || status?.accountCurrency;
  const accountConnected = oandaStatus.connected === true;
  const accountStatusUnavailable = oandaStatus.reason === 'checking' || oandaStatus.reason === 'status_request_failed';
  const priceState = freshness(status?.lastPriceAt);
  const fullCoverage = hasFullFreshCoverage(status);
  const feedConnected = accountConnected && fullCoverage && priceState.fresh;
  const feedPartial = accountConnected && status !== null && !feedConnected &&
    (status.priceFeedStatus === 'PARTIAL' || (typeof status.priceCoverage === 'number' && status.priceCoverage > 0));
  const oandaLedgerAvailable = hasVerifiedOandaLedger(status);
  const oandaExecutionReady = Boolean(mode.oanda && mode.ready && accountConnected && feedConnected && oandaLedgerAvailable);
  const candleCoverage = symbols.filter((symbol) => Number(status?.marketData?.[symbol]?.candleCount || 0) >= 200).length;
  const selectedMarket = status?.marketData?.[selectedSymbol];
  const selectedPair = status?.pairedSignals?.[selectedSymbol];
  const selectedQuote = status?.livePrices?.[selectedSymbol];
  const displayedIntelligence = intelligenceSymbol === selectedSymbol ? intelligence : null;
  const displayedIntelligenceError = intelligenceSymbol === selectedSymbol ? intelligenceError : '';
  const quoteState = freshness(selectedQuote?.time);
  const verifiedOpen = oandaLedgerAvailable
    ? (status?.openTrades || []).filter((trade) => trade.source === 'OANDA' && trade.verificationStatus === 'VERIFIED')
    : [];
  const orphans = status?.orphanTrades || [];
  const protectiveReceipt = oandaLedgerAvailable &&
    verifiedOpen.length > 0 &&
    verifiedOpen.every((trade) => finite(trade.stopLoss) && finite(trade.takeProfit) && Boolean(trade.oandaTradeId));
  const modeLabel = !mode.known
    ? 'MODE UNAVAILABLE'
    : mode.paper
      ? 'PAPER · NO OANDA ORDERS'
      : oandaExecutionReady
        ? mode.label
        : mode.demo ? 'OANDA DEMO BLOCKED' : 'OANDA LIVE BLOCKED';

  useEffect(() => {
    if (symbols.length > 0 && !symbols.includes(selectedSymbol)) {
      setSelectedSymbol(symbols[0]);
    }
  }, [selectedSymbol, symbolsKey]);

  useEffect(() => {
    let disposed = false;
    const requestedSymbol = selectedSymbol;
    setIntelligence(null);
    setIntelligenceSymbol(requestedSymbol);
    setIntelligenceError('');
    if (!symbolsKey || !symbols.includes(requestedSymbol)) {
      setIntelligenceError('MULTI-TIMEFRAME SYMBOL UNAVAILABLE');
      return;
    }
    const refresh = () => fetchIntelligence(requestedSymbol)
      .then((data) => {
        if (disposed) return;
        if (cleanSymbol(data?.symbol) !== cleanSymbol(requestedSymbol)) {
          setIntelligence(null);
          setIntelligenceSymbol(requestedSymbol);
          setIntelligenceError('MULTI-TIMEFRAME RESPONSE SYMBOL MISMATCH');
          return;
        }
        setIntelligence(data);
        setIntelligenceSymbol(requestedSymbol);
        setIntelligenceError('');
      })
      .catch(() => {
        if (disposed) return;
        setIntelligence(null);
        setIntelligenceSymbol(requestedSymbol);
        setIntelligenceError('MULTI-TIMEFRAME OANDA DATA UNAVAILABLE');
      });
    void refresh();
    const timer = window.setInterval(() => void refresh(), 30000);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [selectedSymbol, symbolsKey]);

  const matrix = useMemo(() => symbols.map((symbol) => {
    const market = status?.marketData?.[symbol];
    const quote = status?.livePrices?.[symbol];
    const pair = status?.pairedSignals?.[symbol];
    const quoteFresh = freshness(quote?.time).fresh;
    return { symbol, market, quote, pair, quoteFresh };
  }), [status, symbolsKey]);

  return (
    <div className="setup-page setup-command">
      <section className="command-hero">
        <div><p className="eyebrow">Mission control / Setup</p><h1>Ogni luce verde richiede una prova reale.</h1><p>Account, feed, analisi ed esecuzione sono sistemi distinti. Il cockpit non riempie spazi con dati simulati.</p></div>
        <div className={`command-mode ${oandaExecutionReady ? 'live' : mode.oanda ? 'blocked' : mode.paper ? 'paper' : ''}`}><span>EXECUTION MODE</span><strong>{modeLabel}</strong><small>{status === null ? 'Scanner unavailable' : status.isRunning ? 'Scanner running' : 'Scanner stopped'} · {symbols.length || 'N/A'} instruments</small></div>
      </section>

      <section className="account-ribbon">
        <div><span>OANDA ACCOUNT</span><strong>{accountConnected ? 'AUTHENTICATED' : accountStatusUnavailable ? 'UNAVAILABLE' : 'DISCONNECTED'}</strong><small>{oandaStatus.accountId || 'ID N/A'} · {oandaStatus.mode || 'MODE N/A'}</small></div>
        <div><span>ACCOUNT CURRENCY</span><strong>{accountCurrency || 'N/A'}</strong><small>API source only</small></div>
        <div><span>BALANCE</span><strong>{money(oandaStatus.balance, accountCurrency)}</strong><small>Last check {dateTime(oandaStatus.checkedAt)}</small></div>
        <div><span>NAV</span><strong>{money(oandaStatus.nav, accountCurrency)}</strong><small>State {oandaStatus.state || 'N/A'}</small></div>
        <div><span>UNREALIZED P&amp;L</span><strong>{money(oandaStatus.unrealizedPL, accountCurrency, true)}</strong><small>{text(oandaStatus.openTradeCount)} trades · {text(oandaStatus.openPositionCount)} positions</small></div>
        <div><span>ENDPOINT</span><strong>{oandaStatus.endpoint ? 'OANDA API' : 'N/A'}</strong><small>{oandaStatus.endpoint || 'ENDPOINT N/A'}</small></div>
      </section>

      <section className="gate-grid">
        <Gate label="Account authentication" value={accountConnected ? 'PASS' : accountStatusUnavailable ? 'UNAVAILABLE' : 'BLOCKED'} detail={accountConnected ? `Account and ${accountCurrency || 'currency'} returned by OANDA` : oandaStatus.errorCode || oandaStatus.reason || 'No verified account response'} state={accountConnected ? 'ok' : accountStatusUnavailable ? 'idle' : 'bad'} />
        <Gate label="One-second FX execution feed" value={feedConnected ? 'FULL / FRESH' : feedPartial ? 'PARTIAL' : 'UNAVAILABLE'} detail={`${status?.priceCoverage ?? 'N/A'} / ${status?.priceExpected ?? 15} FX pairs · XAUUSD separate SIGNAL ONLY · last tick ${priceState.age}`} state={feedConnected ? 'ok' : feedPartial ? 'warn' : status ? 'bad' : 'idle'} />
        <Gate label="Candle analysis" value={symbols.length ? `${candleCoverage}/${symbols.length}` : 'N/A'} detail="At least 200 real OANDA candles required per analyzed symbol" state={symbols.length && candleCoverage === symbols.length ? 'ok' : candleCoverage > 0 ? 'warn' : 'idle'} />
        <Gate label="Exclusive execution lane" value={!status ? 'N/A' : status.liveExecutionVariantValid ? status.liveExecutionVariant === 'INVERSE' ? 'MIRROR (INVERSE)' : status.liveExecutionVariant : 'INVALID'} detail={mode.oanda ? 'Exactly one lane may submit after every global gate passes' : mode.paper ? 'Selector stored; ignored while PAPER' : 'Execution mode unavailable'} state={!status ? 'idle' : status.liveExecutionVariantValid ? 'ok' : 'bad'} />
        <Gate label="OANDA reconciliation" value={status?.reconciliationStatus || 'N/A'} detail={`Last verified sync ${dateTime(status?.lastReconciledAt)}`} state={status?.reconciliationStatus === 'VERIFIED' ? 'ok' : mode.oanda ? 'bad' : 'idle'} />
        <Gate label="Protective orders" value={protectiveReceipt ? 'ALL VERIFIED' : verifiedOpen.length > 0 ? 'INCOMPLETE' : 'N/A'} detail={protectiveReceipt ? 'Every verified open receipt includes OANDA SL and TP' : 'No complete current OANDA receipt set proves SL + TP'} state={protectiveReceipt ? 'ok' : mode.oanda && verifiedOpen.length > 0 ? 'bad' : 'idle'} />
        <Gate label="XAUUSD execution" value="ANALYSIS ONLY" detail="Structural engine active; order and partial-close validation pending" state="warn" />
        <Gate label="Economic calendar" value={news.length ? 'CONNECTED' : 'NOT CONFIGURED'} detail={news.length ? 'Events received from configured source' : 'Completely separated from trading logic'} state={news.length ? 'ok' : 'idle'} />
      </section>

      <section className="command-panel">
        <header><div><span>READ-ONLY SAFETY STATUS</span><h2>AI CONFIRMATION</h2></div><b>{status?.aiStatus || 'N/A'}</b></header>
        <div className="envelope-proof">
          <div><span>Provider</span><strong>{status?.aiProvider || 'N/A'}</strong></div>
          <div><span>Required</span><strong>{status ? status.aiConfirmationRequired === true ? 'YES' : 'NO' : 'N/A'}</strong></div>
          <div><span>Last check</span><strong>{dateTime(status?.lastAiCheckedAt)}</strong></div>
          <div><span>Signal ID</span><strong>{status?.lastAiSignalId || 'N/A'}</strong></div>
        </div>
        <div className="hard-block">READ ONLY · {status?.lastAiReason || 'AI cannot create prices, change risk, or submit an order by itself.'}</div>
      </section>

      <section className="command-panel matrix-panel">
        <header><div><span>SCAN UNIVERSE</span><h2>{symbols.length ? `${symbols.length}-instrument truth matrix` : 'Instrument truth matrix'}</h2></div><b>{status?.signalsAnalyzed ?? 'N/A'} analyses · {status?.signalsDiscarded ?? 'N/A'} discarded</b></header>
        <div className="matrix-scroll"><table className="truth-matrix"><thead><tr><th>Instrument</th><th>Feed / price</th><th>Candles</th><th>Structure</th><th>MAIN</th><th>MIRROR</th><th>Execution</th></tr></thead><tbody>
          {matrix.map(({ symbol, market, quote, pair, quoteFresh }) => (
            <tr key={symbol} className={selectedSymbol === symbol ? 'selected' : ''} onClick={() => setSelectedSymbol(symbol)}>
              <td><strong>{symbol}</strong><small>{symbol === 'XAUUSD' ? 'DEDICATED · ANALYSIS ONLY' : market?.timeframe || 'M5'}</small></td>
              <td><strong>{price(quote?.mid ?? market?.closePrice, symbol)}</strong><small className={quoteFresh ? 'positive' : 'neutral'}>{quoteFresh ? 'OANDA 1S FRESH' : market ? 'OANDA CANDLE' : 'N/A'}</small></td>
              <td><strong>{market?.candleCount ?? 'N/A'}</strong><small>{dateTime(market?.candleTime)}</small></td>
              <td><strong className={variantClass(market?.structureBias)}>{market?.structureBias || 'N/A'}</strong><small>BOS {market?.breakOfStructure || 'N/A'} · CHoCH {market?.changeOfCharacter || 'N/A'}</small></td>
              <td><strong className={variantClass(pair?.main?.action)}>{pair?.main?.action || 'N/A'}</strong><small>{setupScoreText(pair?.main)}</small></td>
              <td><strong className={variantClass(pair?.inverse?.action)}>{pair?.inverse?.action || 'N/A'}</strong><small>{pair?.inverse?.derivedFrom ? 'DERIVED SAME SNAPSHOT' : 'N/A'}</small></td>
              <td><strong>{symbol === 'XAUUSD' ? 'ANALYSIS ONLY' : mode.paper ? 'PAPER / SHADOW' : oandaExecutionReady ? pair?.main?.selectedForExecution ? pair.main.executionState : pair?.inverse?.selectedForExecution ? pair.inverse.executionState : 'NOT SELECTED' : mode.oanda ? 'BLOCKED' : 'N/A'}</strong><small>{pair?.pairId || 'Pair ID N/A'}</small></td>
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
            {(displayedIntelligence?.frames || []).map((frame: any) => <div key={frame.timeframe} className={frame.available ? variantClass(frame.direction) : 'neutral'}><span>{frame.timeframe}</span><strong>{frame.available ? frame.direction : 'N/A'}</strong><small>{frame.available ? `${frame.structure || 'N/A'} · ALIGN ${finite(frame.alignmentScore) ? `${Math.round(frame.alignmentScore)}/100` : 'N/A'}` : frame.reason || 'UNAVAILABLE'}</small></div>)}
            {!displayedIntelligence && <div className="empty-state">{displayedIntelligenceError || 'MULTI-TIMEFRAME DATA N/A'}</div>}
          </div>
        </div>

        <div className="command-panel snapshot-panel">
          <header><div><span>SHARED SIGNAL ENVELOPE</span><h2>{selectedPair?.pairId || 'NO PAIR YET'}</h2></div><b>{dateTime(selectedPair?.evaluatedAt)}</b></header>
          {selectedPair ? <><div className="envelope-proof"><div><span>OANDA tick</span><strong>{dateTime(selectedPair.market.time)}</strong></div><div><span>Same quote</span><strong>{price(selectedPair.market.bid, selectedSymbol)} / {price(selectedPair.market.ask, selectedSymbol)}</strong></div><div><span>Validation</span><strong>{selectedPair.marketValid ? 'CAPTURED FRESH' : selectedPair.marketValidationReason || 'BLOCKED'}</strong></div><div><span>Data source</span><strong>{selectedPair.analysis.structureSource || selectedPair.market.source}</strong></div></div><div className="lane-grid"><Lane lane={selectedPair.main} executionReady={oandaExecutionReady} symbol={selectedSymbol} /><Lane lane={selectedPair.inverse} executionReady={oandaExecutionReady} symbol={selectedSymbol} /></div>{(selectedPair.executionBlockedReason || (mode.oanda && !oandaExecutionReady)) && <div className="hard-block">EXECUTION BLOCK: {selectedPair.executionBlockedReason || modeLabel}</div>}</> : <div className="empty-state">Nessun pair snapshot reale disponibile per {selectedSymbol}.</div>}
        </div>
      </section>

      <section className="receipt-columns">
        <div className="command-panel"><header><div><span>OANDA SOURCE OF TRUTH</span><h2>Verified open receipts</h2></div><b>{oandaLedgerAvailable ? verifiedOpen.length : 'N/A'}</b></header><div className="receipt-list">{verifiedOpen.length ? verifiedOpen.map((trade) => <Receipt key={trade.id} trade={trade} />) : <div className="empty-state">{oandaLedgerAvailable ? 'Nessuna posizione OANDA verificata aperta.' : 'DATI NON DISPONIBILI: riconciliazione OANDA non verificata.'}</div>}</div></div>
        <div className="command-panel danger-panel"><header><div><span>RECONCILIATION EXCEPTIONS</span><h2>Local orphans</h2></div><b>{status ? orphans.length : 'N/A'}</b></header><div className="receipt-list">{orphans.length ? orphans.map((trade) => <Receipt key={trade.id} trade={trade} />) : <div className="empty-state">{status ? 'Nessun LOCAL ORPHAN / NOT VERIFIED.' : 'DATI NON DISPONIBILI'}</div>}</div></div>
      </section>

      <section className="receipt-columns">
        <div className="command-panel"><header><div><span>SEPARATE LEDGER</span><h2>Paper shadow</h2></div><b>{status ? `${status.shadowOpenTrades?.length || 0} open · ${status.shadowClosedTrades?.length || 0} closed` : 'N/A'}</b></header><div className="receipt-list">{(status?.shadowOpenTrades || []).slice(0, 8).map((trade) => <article className="shadow-command" key={trade.id}><strong>{trade.strategyVariant || 'SHADOW'} · {trade.symbol} · {trade.side}</strong><span>Entry {price(trade.entryPrice, cleanSymbol(trade.symbol))} · Current {price(trade.currentPrice, cleanSymbol(trade.symbol))}</span><b>NO OANDA ORDER</b></article>)}{status && (status.shadowOpenTrades || []).length === 0 && <div className="empty-state">Nessuna posizione shadow aperta.</div>}</div></div>
        <div className="command-panel"><header><div><span>LAST EXECUTION ATTEMPT</span><h2>{status?.lastOrderStatus || 'N/A'}</h2></div><b>{dateTime(status?.lastOrderAttemptAt)}</b></header><div className="envelope-proof"><div><span>Reason</span><strong>{status?.lastOrderReason || 'N/A'}</strong></div><div><span>Order ID</span><strong>{status?.lastOandaOrderId || 'N/A'}</strong></div><div><span>Trade ID</span><strong>{status?.lastOandaTradeId || 'N/A'}</strong></div><div><span>Mode</span><strong>{modeLabel}</strong></div></div></div>
      </section>

      <section className="command-panel diagnostics-panel">
        <header><div><span>DIAGNOSTICS</span><h2>Strategy and error stream</h2></div><b>{status ? `Latest ${Math.min(status.logs.length, 40)} events` : 'EVENTS N/A'}</b></header>
        {oandaStatus.errorMessage && <div className="hard-block">OANDA {oandaStatus.errorStatus || ''} {oandaStatus.errorCode || ''}: {oandaStatus.errorMessage}</div>}
        <div className="diagnostic-stream">{(status?.logs || []).slice(-40).reverse().map((line, index) => <div key={`${line}-${index}`}><span>{String(index + 1).padStart(2, '0')}</span><p>{line}</p></div>)}{status && status.logs.length === 0 && <div className="empty-state">Nessun evento registrato.</div>}{!status && <div className="empty-state">DATI NON DISPONIBILI</div>}</div>
      </section>

      <section className="command-footer"><div><span>APPLICATION API</span><strong>{status ? 'RESPONDING' : 'UNAVAILABLE'}</strong><small>{status ? `Snapshot ${dateTime(status.lastUpdated)}` : 'Nessuna risposta di stato verificata'}</small></div><div><span>RAILWAY RESTART POLICY</span><strong>VERIFY IN RAILWAY</strong><small>Non dedotta dal browser</small></div><div><span>CALENDAR</span><strong>{news.length ? 'CONNECTED' : 'NOT CONFIGURED'}</strong><small>Nessun evento inventato</small></div><div><span>SECURITY</span><strong>SECRETS HIDDEN</strong><small>Account ID masked · token never rendered</small></div></section>
    </div>
  );
}
