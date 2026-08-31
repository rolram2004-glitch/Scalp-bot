import { Link } from 'react-router-dom';
import { ChartPriceLine, ChartSignalMarker, RealMiniChart } from '../components/RealMiniChart';
import { calculateTradeMetrics, tradeResultR } from '../../../src/strategy-metrics';
import { BotTrade, OandaStatus, SignalLaneSnapshot, StatusSnapshot } from '../types';
import '../command-setup.css';

function cleanSymbol(value: unknown) {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function numeric(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function price(value: unknown, symbol = '') {
  const parsed = numeric(value);
  if (parsed === undefined || parsed <= 0) return 'N/A';
  const normalized = cleanSymbol(symbol);
  return parsed.toFixed(normalized.includes('JPY') || normalized.includes('XAU') ? 3 : 5);
}

function money(value: unknown, currency?: string) {
  const parsed = numeric(value);
  if (parsed === undefined || !currency) return 'N/A';
  return `${parsed > 0 ? '+' : ''}${parsed.toFixed(2)} ${currency}`;
}

function formatR(value: number | undefined) {
  if (value === undefined || !Number.isFinite(value)) return 'N/A';
  return `${value > 0 ? '+' : ''}${value.toFixed(2)}R`;
}

function formatFactor(value: number | undefined) {
  if (value === Number.POSITIVE_INFINITY) return '∞';
  return value !== undefined && Number.isFinite(value) ? value.toFixed(2) : 'N/A';
}

function score(source: { setupScore?: unknown; confidence?: unknown } | null | undefined) {
  const value = numeric(source?.setupScore) ?? numeric(source?.confidence);
  return value === undefined ? undefined : Math.max(0, Math.min(100, Math.round(value)));
}

function ageSeconds(value?: string) {
  if (!value) return undefined;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return undefined;
  return Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
}

function time(value?: string) {
  if (!value) return 'N/A';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 'N/A' : parsed.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function fullTime(value?: string) {
  if (!value) return 'N/A';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 'N/A' : parsed.toLocaleString();
}

function resultTone(value: number | undefined) {
  return value === undefined || !Number.isFinite(value) ? 'neutral' : value > 0 ? 'positive' : value < 0 ? 'negative' : 'neutral';
}

function metricTone(value: number | undefined) {
  return value === undefined || !Number.isFinite(value) ? 'neutral' : value >= 0 ? 'good' : 'bad';
}

function sideClass(action?: string) {
  return action === 'BUY' ? 'side-buy' : action === 'SELL' ? 'side-sell' : 'side-hold';
}

function tradeTime(trade: BotTrade) {
  return Date.parse(trade.closedAt || trade.openedAt || trade.signalAt || '') || 0;
}

function operationDiagnosis(status: StatusSnapshot | null, oandaStatus: OandaStatus, feedAge?: number) {
  if (!status) return { tone: 'blocked', eyebrow: 'DATI NON DISPONIBILI', title: 'STATO NON VERIFICATO', detail: 'La dashboard non ha ricevuto lo snapshot del bot.', action: 'ATTENDO API' };
  if (!status.isRunning) return { tone: 'blocked', eyebrow: 'SCANNER FERMO', title: 'BOT NON IN ESECUZIONE', detail: 'Il processo non sta analizzando i mercati.', action: 'CONTROLLO RAILWAY' };
  if (!oandaStatus.connected) return { tone: 'danger', eyebrow: 'BROKER GATE', title: 'OANDA NON CONNESSA', detail: 'Il conto non è verificato; nessun nuovo ingresso può essere inviato.', action: 'VERIFICA CONNESSIONE' };

  const utcDay = new Date().getUTCDay();
  const weekend = (utcDay === 0 || utcDay === 6) && (feedAge === undefined || feedAge > 30);
  if (weekend) {
    return {
      tone: 'paused',
      eyebrow: 'PAUSA DI MERCATO RILEVATA',
      title: 'MERCATO FX CHIUSO · WEEKEND',
      detail: `OANDA è connessa e il ledger è ${status.reconciliationStatus || 'N/A'}, ma non arrivano nuove quote. Il bot riprenderà automaticamente quando OANDA pubblicherà prezzi freschi.`,
      action: 'NESSUN INTERVENTO NECESSARIO'
    };
  }
  if (status.reconciliationStatus !== 'VERIFIED') return { tone: 'danger', eyebrow: 'LEDGER GATE', title: 'RICONCILIAZIONE NON VERIFICATA', detail: 'La dashboard non considera affidabili posizioni e P&L finché OANDA non conferma il ledger.', action: 'ATTENDO RICONCILIAZIONE' };
  if (status.priceFeedStatus !== 'CONNECTED' || feedAge === undefined || feedAge > 30) return { tone: 'danger', eyebrow: 'PRICE GATE', title: 'FEED OANDA NON FRESCO', detail: `Ultimo prezzo: ${fullTime(status.lastPriceAt)}. Gli ingressi restano bloccati per sicurezza.`, action: 'RECUPERO AUTOMATICO FEED' };
  if (status.entryGateStatus === 'MINUTE_RATE_LIMIT') return { tone: 'paused', eyebrow: 'VELOCITÀ GATE', title: '100 INGRESSI/MINUTO RAGGIUNTI', detail: 'Il bot continua a monitorare e libera automaticamente capacità nella finestra mobile di 60 secondi.', action: 'RESET MOBILE AUTOMATICO' };
  if (status.entryGateStatus === 'DAILY_TRADE_LIMIT') return { tone: 'paused', eyebrow: 'RISK GATE', title: 'LIMITE TRADE RAGGIUNTO', detail: 'Il bot continua a monitorare, ma non apre altri ingressi fino al reset UTC.', action: `RESET ${status.nextDailyResetAt ? fullTime(status.nextDailyResetAt) : 'UTC'}` };
  if (status.entryGateStatus === 'DAILY_LOSS_LIMIT') return { tone: 'danger', eyebrow: 'RISK GATE', title: 'STOP PERDITA GIORNALIERA', detail: 'La protezione di perdita ha bloccato nuovi ingressi.', action: 'ATTENDO RESET UTC' };
  if (status.entryGateStatus === 'MAX_OPEN_POSITIONS') return { tone: 'paused', eyebrow: 'CAPACITY GATE', title: 'POSIZIONI MASSIME APERTE', detail: 'Il bot attende la chiusura di una posizione prima di un nuovo ingresso.', action: 'GESTIONE POSIZIONI ATTIVA' };
  if (status.entryGateStatus === 'READY') return { tone: 'ready', eyebrow: 'TUTTI I GATE VERIFICATI', title: 'BOT PRONTO A VALUTARE INGRESSI', detail: 'Broker, prezzi, ledger, rischio e profilo sono pronti. Un trade parte solo con un setup valido.', action: 'SCANNER ATTIVO' };
  return { tone: 'blocked', eyebrow: 'EXECUTION GATE', title: String(status.entryGateStatus || 'CHECKING').replace(/_/g, ' '), detail: String(status.entryGateReason || 'Controlli operativi in corso.').replace(/_/g, ' '), action: 'ATTENDO GATE' };
}

function StatusTile({ label, value, detail, state }: { label: string; value: string; detail: string; state: 'ok' | 'warn' | 'bad' | 'idle' }) {
  return (
    <article className={`pro-status-tile ${state}`}>
      <i aria-hidden="true">{state === 'ok' ? '✓' : state === 'bad' ? '!' : state === 'warn' ? 'Ⅱ' : '·'}</i>
      <div><span>{label}</span><strong>{value}</strong><small>{detail}</small></div>
    </article>
  );
}

function Metric({ label, value, detail, tone = 'neutral' }: { label: string; value: string | number; detail: string; tone?: string }) {
  return (
    <article className={`pro-metric ${tone}`}>
      <span>{label}</span><strong>{value}</strong><small>{detail}</small><i />
    </article>
  );
}

function TradeRow({ trade }: { trade: BotTrade }) {
  const r = tradeResultR(trade);
  const currency = trade.accountCurrency || trade.pnlCurrency;
  return (
    <div className="pro-trade-row">
      <time>{time(trade.closedAt || trade.openedAt)}</time>
      <b className={sideClass(trade.side)}>{trade.side || 'N/A'}</b>
      <strong>{trade.symbol || 'N/A'}</strong>
      <span>{trade.status || 'N/A'}</span>
      <em className={resultTone(r)}>{r === undefined ? money(trade.pnl, currency) : formatR(r)}</em>
    </div>
  );
}

function LaneCard({ variant, lane, symbol, executionReady }: { variant: 'MAIN' | 'INVERSE'; lane?: SignalLaneSnapshot; symbol: string; executionReady: boolean }) {
  const targets = lane?.structuralTargets || [];
  const laneScore = score(lane);
  const label = variant === 'INVERSE' ? 'MIRROR' : 'MAIN';
  const selected = lane?.selectedForExecution === true;
  const mode = selected
    ? executionReady ? 'OANDA PRACTICE READY' : 'OANDA PRACTICE BLOCKED'
    : 'PAPER SHADOW · 0 ORDINI';
  return (
    <article className={`pro-lane-card ${variant.toLowerCase()}`}>
      <header>
        <div><span>{selected ? 'CORSIA OPERATIVA' : variant === 'INVERSE' ? 'GEMELLO CONTRARIO' : 'GEMELLO NORMALE'}</span><h3>{label}</h3></div>
        <b>{mode}</b>
      </header>
      <div className="pro-lane-decision">
        <strong className={sideClass(lane?.action)}>{lane?.action || 'HOLD'}</strong>
        <div><span>SETUP SCORE</span><b>{laneScore === undefined ? 'N/A' : `${laneScore}/100`}</b></div>
      </div>
      <div className="pro-level-grid">
        <div><span>ENTRY</span><strong>{price(lane?.entryPrice, symbol)}</strong></div>
        <div><span>STOP</span><strong className="negative">{price(lane?.stopLossPrice, symbol)}</strong></div>
        <div><span>TARGET 1</span><strong className="positive">{price(targets[0] ?? lane?.takeProfitPrice, symbol)}</strong></div>
        <div><span>R:R</span><strong>{numeric(lane?.riskRewardRatio) === undefined ? 'N/A' : `1:${Number(lane?.riskRewardRatio).toFixed(2)}`}</strong></div>
      </div>
      <div className="pro-lane-tags"><span>{lane?.setupType || 'SETUP N/A'}</span><span>{lane?.executionState || 'STATE N/A'}</span><span>{lane?.mode || 'MODE N/A'}</span></div>
      <p>{selected ? variant === 'MAIN' ? 'MAIN OPERATIVA: direzione normale invariata, TP nominale +0,03 CHF, SL nominale -0,30 CHF. ' : 'MIRROR OPERATIVA: direzione opposta, TP nominale +0,03 CHF, SL nominale -0,30 CHF. ' : ''}{lane?.reasoning || 'Nessuno snapshot OANDA disponibile.'}</p>
    </article>
  );
}

export function CommandSetupPage({
  status,
  marketData = {},
  oandaStatus = {}
}: {
  status: StatusSnapshot | null;
  marketData?: Record<string, any>;
  oandaStatus?: OandaStatus;
}) {
  const allSymbols = status?.symbols?.map(cleanSymbol) || [];
  const fxSymbols = allSymbols.filter((item) => item && item !== 'XAUUSD').slice(0, 15);
  const latestSymbol = cleanSymbol(status?.latestPairedSignal?.symbol);
  const primarySymbol = latestSymbol && latestSymbol !== 'XAUUSD'
    ? latestSymbol
    : cleanSymbol(status?.currentSymbol) !== 'XAUUSD'
      ? cleanSymbol(status?.currentSymbol || fxSymbols[0])
      : fxSymbols[0];
  const primaryPair = status?.pairedSignals?.[primarySymbol];
  const primaryMarket = status?.marketData?.[primarySymbol] || marketData?.[primarySymbol];
  const accountCurrency = status?.accountCurrency || oandaStatus.currency;
  const feedAge = ageSeconds(status?.lastPriceAt);
  const feedLive = status?.priceFeedStatus === 'CONNECTED' && typeof status?.priceCoverage === 'number' && status.priceCoverage > 0 && feedAge !== undefined && feedAge <= 30;
  const executionReady = status?.effectiveExecutionState === 'OANDA_DEMO_READY' || status?.effectiveExecutionState === 'OANDA_LIVE_READY';
  const diagnostic = operationDiagnosis(status, oandaStatus, feedAge);
  const openTrades = (status?.openTrades || []).filter((trade) => trade.status === 'OPEN');
  const activeVariant = status?.liveExecutionVariant === 'INVERSE' ? 'INVERSE' : 'MAIN';
  const closedTrades = (status?.closedTrades || []).filter((trade) =>
    status?.tradingMode === 'PAPER'
      ? trade.source === 'PAPER'
      : trade.source === 'OANDA' && trade.verificationStatus === 'VERIFIED' && trade.strategyVariant === activeVariant
  );
  const performance = calculateTradeMetrics(closedTrades);
  const recentTrades = [...openTrades, ...closedTrades].sort((left, right) => tradeTime(right) - tradeTime(left)).slice(0, 10);
  const dailyRisk = status?.dailyRiskStatus;
  const scannerRows = fxSymbols.map((symbol) => ({
    symbol,
    market: status?.marketData?.[symbol] || marketData?.[symbol],
    signal: activeVariant === 'INVERSE' ? status?.pairedSignals?.[symbol]?.inverse : status?.pairedSignals?.[symbol]?.main,
    quote: status?.livePrices?.[symbol]
  }));
  const validNow = scannerRows.filter((row) => row.signal && row.signal.action !== 'HOLD' && (score(row.signal) || 0) >= (status?.minimumConfidence ?? 55)).length;
  const buyNow = scannerRows.filter((row) => row.signal?.action === 'BUY').length;
  const sellNow = scannerRows.filter((row) => row.signal?.action === 'SELL').length;
  const holdNow = scannerRows.filter((row) => !row.signal || row.signal.action === 'HOLD').length;
  const setupMap = new Map<string, BotTrade[]>();
  closedTrades.forEach((trade) => {
    const key = trade.setupType || 'LEGACY · SENZA TAG';
    setupMap.set(key, [...(setupMap.get(key) || []), trade]);
  });
  const setupRows = [...setupMap.entries()]
    .map(([name, trades]) => ({ name, trades, metrics: calculateTradeMetrics(trades) }))
    .sort((left, right) => right.metrics.sampleSize - left.metrics.sampleSize)
    .slice(0, 8);
  const xau = status?.marketData?.XAUUSD || marketData?.XAUUSD;
  const xauQuote = status?.livePrices?.XAUUSD;
  const xauLab = status?.xauSignalLab;
  const xauCandidate = xauLab?.latestCandidate;
  const samplePass = performance.sampleSize >= 30;
  const expectancyPass = (performance.averageR ?? Number.NEGATIVE_INFINITY) > 0;
  const factorPass = (performance.profitFactor ?? 0) > 1;
  const brokerPass = oandaStatus.connected === true && status?.reconciliationStatus === 'VERIFIED';
  const xauPass = xauLab?.executionEnabled === false && xauLab?.orderCount === 0;
  const reviewCandidate = samplePass && expectancyPass && factorPass && brokerPass && xauPass;
  const currentLane = activeVariant === 'INVERSE' ? primaryPair?.inverse : primaryPair?.main;
  const currentLaneLabel = activeVariant === 'INVERSE' ? 'MIRROR' : 'MAIN';
  const chartLines: ChartPriceLine[] = currentLane?.action && currentLane.action !== 'HOLD' ? [
    { price: Number(currentLane.entryPrice), label: `${currentLaneLabel} ENTRY`, color: '#63a8ff', style: 'solid' as const },
    { price: Number(currentLane.stopLossPrice), label: 'STOP LOSS', color: '#ff7185', style: 'dashed' as const },
    { price: Number(currentLane.takeProfitPrice || currentLane.structuralTargets?.[0]), label: 'TARGET 1', color: '#48df98', style: 'dashed' as const }
  ].filter((line) => Number.isFinite(line.price) && line.price > 0) : [];
  const chartMarkers: ChartSignalMarker[] = primaryPair?.evaluatedAt && (currentLane?.action === 'BUY' || currentLane?.action === 'SELL') ? [
    { time: primaryPair.evaluatedAt, side: currentLane.action, label: `${currentLaneLabel} ${currentLane.action}` }
  ] : [];
  const executionLabel = diagnostic.tone === 'paused'
    ? 'PAUSA WEEKEND'
    : executionReady
      ? 'OANDA READY'
      : String(status?.effectiveExecutionState || 'N/A').replace(/_/g, ' ');
  const executionVariantLabel = activeVariant === 'INVERSE' ? 'MIRROR (INVERSE)' : 'MAIN';
  const executionDetail = diagnostic.tone === 'paused'
    ? `${executionVariantLabel} · ripresa automatica`
    : `${executionVariantLabel} · ${status?.entryGateStatus || 'N/A'}`;

  return (
    <div className="pro-setup">
      <section className="pro-setup-hero">
        <div className="pro-hero-brand">
          <span>$Rohato$🤖111 · PROFESSIONAL SETUP</span>
          <h1>SEL Scalp Bot Command Center</h1>
          <p>Modalità NORMALE ULTRA: il segnale BUY apre BUY e SELL apre SELL. Scansione ogni 1s; massimo 100 ingressi al minuto e 15.000 al giorno, senza limite di perdita giornaliera su OANDA Practice. Protezioni fisse: TP +0,03 CHF e SL -0,30 CHF. Size massima 1.000 unità, ridotta automaticamente soltanto quando lo spread lo richiede.</p>
        </div>
        <div className={`pro-diagnosis ${diagnostic.tone}`}>
          <span>{diagnostic.eyebrow}</span><strong>{diagnostic.title}</strong><p>{diagnostic.detail}</p><b>{diagnostic.action}</b>
        </div>
      </section>

      <section className="pro-status-grid" aria-label="Stato verificato dei sistemi">
        <StatusTile label="BROKER" value={oandaStatus.connected ? 'OANDA CONNESSA' : 'NON CONNESSA'} detail={`${oandaStatus.mode || 'practice'} · ${accountCurrency || 'currency N/A'}`} state={oandaStatus.connected ? 'ok' : 'bad'} />
        <StatusTile label="PRICE FEED" value={feedLive ? 'LIVE' : diagnostic.tone === 'paused' ? 'PAUSA WEEKEND' : status?.priceFeedStatus || 'N/A'} detail={feedAge === undefined ? 'Età N/A' : `Ultimo prezzo ${feedAge}s fa`} state={feedLive ? 'ok' : diagnostic.tone === 'paused' ? 'warn' : 'bad'} />
        <StatusTile label="LEDGER" value={status?.reconciliationStatus || 'N/A'} detail={status?.lastReconciledAt ? `Verificato ${time(status.lastReconciledAt)}` : 'Nessuna ricevuta'} state={status?.reconciliationStatus === 'VERIFIED' ? 'ok' : 'bad'} />
        <StatusTile label="EXECUTION" value={executionLabel} detail={executionDetail} state={executionReady ? 'ok' : diagnostic.tone === 'paused' ? 'warn' : 'bad'} />
        <StatusTile label="AI GATE" value={status?.aiProvider || 'DISABLED'} detail={status?.aiStatus || status?.lastAiReason || 'Fallback deterministico'} state={status?.aiStatus === 'ERROR' ? 'bad' : status?.aiProvider && status.aiProvider !== 'DISABLED' ? 'ok' : 'idle'} />
        <StatusTile label="PROFILO" value={status?.signalProfile || 'N/A'} detail={`${(status?.scanIntervalMs ?? 0) / 1000}s · max ${status?.maxTradesPerMinute ?? 'N/A'}/min`} state={status?.signalProfile === 'ROHATO_ULTRA_100_PER_MINUTE' ? 'ok' : 'warn'} />
        <StatusTile label="XAUUSD" value="SIGNAL ONLY" detail={`${xauLab?.orderCount ?? 0} ordini · protetto`} state={xauPass ? 'ok' : 'bad'} />
      </section>

      <section className="pro-metrics">
        <Metric label="P&L OGGI" value={dailyRisk?.complete ? money(dailyRisk.pnl, dailyRisk.currency || accountCurrency) : 'N/A'} detail={dailyRisk?.complete ? `${status?.dailyLossLimitEnabled === false ? 'LIMITE PERDITA DISATTIVATO · ' : ''}UTC ${dailyRisk.dateUTC}` : dailyRisk?.reason || 'Ledger non completo'} tone={numeric(dailyRisk?.pnl) === undefined ? 'neutral' : Number(dailyRisk?.pnl) >= 0 ? 'good' : 'bad'} />
        <Metric label="RISULTATO STORICO" value={formatR(performance.totalR)} detail={`${performance.sampleSize} chiusure con R`} tone={metricTone(performance.totalR)} />
        <Metric label="EXPECTANCY" value={formatR(performance.averageR)} detail="Risultato medio per trade" tone={metricTone(performance.averageR)} />
        <Metric label="PROFIT FACTOR" value={formatFactor(performance.profitFactor)} detail="Sopra 1 = profitti > perdite" tone={factorPass ? 'good' : 'bad'} />
        <Metric label="TRADES OGGI" value={dailyRisk?.tradeCount ?? status?.dailyTradeCount ?? 'N/A'} detail={`${status?.tradesLastMinute ?? 0}/${status?.maxTradesPerMinute ?? 'N/A'} ultimo minuto · ${status?.dailyRemainingTrades ?? dailyRisk?.remainingTrades ?? 'N/A'} rimasti`} tone="warn" />
        <Metric label="POSIZIONI APERTE" value={openTrades.length} detail={`${status?.maxOpenPositions ?? 15} massime · 1 per coppia`} tone={openTrades.length >= (status?.maxOpenPositions ?? 15) ? 'warn' : 'neutral'} />
      </section>

      <section className="pro-pipeline" aria-label="Pipeline decisionale corrente">
        <div><span>UNIVERSO</span><strong>{fxSymbols.length} FX</strong><small>+ XAU signal only</small></div>
        <i>→</i><div><span>QUOTE FX COPERTE</span><strong>{status?.priceCoverage ?? 0}/{status?.priceExpected ?? 15}</strong><small>OANDA · XAU SIGNAL ONLY separato</small></div>
        <i>→</i><div><span>DIREZIONI</span><strong>{buyNow} BUY · {sellNow} SELL</strong><small>{holdNow} HOLD</small></div>
        <i>→</i><div><span>SETUP VALIDABILI</span><strong>{validNow}</strong><small>soglia {status?.minimumConfidence ?? 'N/A'}/100</small></div>
        <i>→</i><div><span>CAPACITÀ</span><strong>{status?.minuteRemainingTrades ?? 'N/A'} ingressi/min</strong><small>{status?.maxDailyTrades ?? 'N/A'} ingressi UTC massimi</small></div>
      </section>

      <section className="pro-workspace">
        <aside className="pro-panel pro-scanner">
          <header><div><span>MARKET SCANNER COMPLETO</span><h2>15 COPPIE FOREX</h2></div><b>{status?.signalProfile || 'PROFILE N/A'}</b></header>
          <div className="pro-scanner-head"><span>PAIR</span><span>QUOTE</span><span>SIGNAL</span><span>SCORE</span></div>
          <div className="pro-scanner-list">
            {scannerRows.map(({ symbol, market, signal, quote }) => (
              <div key={symbol}>
                <strong>{symbol}</strong><span>{price(quote?.mid ?? market?.closePrice, symbol)}</span><b className={sideClass(signal?.action)}>{signal?.action || 'HOLD'}</b><em>{score(signal) === undefined ? 'N/A' : `${score(signal)}%`}</em>
              </div>
            ))}
            {!scannerRows.length && <p className="pro-empty">DATI NON DISPONIBILI</p>}
          </div>
        </aside>

        <main className="pro-panel pro-chart">
          <header>
            <div><span>OANDA M5 · EMA · VOLUME · LIVELLI</span><h2>{primarySymbol || 'SYMBOL N/A'}</h2></div>
            <div className="pro-chart-tags"><b>{primaryMarket?.trend || 'TREND N/A'}</b><b>{primaryMarket?.structureBias || 'STRUCTURE N/A'}</b><b>{currentLane?.setupType || 'SETUP N/A'}</b></div>
          </header>
          <RealMiniChart symbol={primarySymbol || undefined} timeframe="M5" showEma priceLines={chartLines} markers={chartMarkers} />
          <footer>
            <div><span>BOS</span><strong>{primaryMarket?.breakOfStructure || 'N/A'}</strong></div>
            <div><span>CHoCH</span><strong>{primaryMarket?.changeOfCharacter || 'N/A'}</strong></div>
            <div><span>FVG</span><strong>{primaryMarket?.fairValueGap || 'N/A'}</strong></div>
            <div><span>RSI</span><strong>{numeric(primaryMarket?.rsi)?.toFixed(1) || 'N/A'}</strong></div>
            <div><span>SPREAD</span><strong>{numeric(primaryMarket?.spread)?.toFixed(2) || 'N/A'}</strong></div>
          </footer>
        </main>

        <aside className="pro-panel pro-ledger">
          <header><div><span>RICEVUTE VERIFICATE</span><h2>OANDA TRADE FEED</h2></div><Link to="/history">STORICO</Link></header>
          <div className="pro-ledger-list">{recentTrades.map((trade) => <TradeRow key={trade.id} trade={trade} />)}{!recentTrades.length && <p className="pro-empty">NESSUNA OPERAZIONE VERIFICATA</p>}</div>
          <footer><span>Ultimo ordine</span><strong>{status?.lastOrderStatus || 'N/A'}</strong><small>{status?.lastOrderReason || status?.lastOandaTradeId || 'Nessun tentativo recente'}</small></footer>
        </aside>
      </section>

      <section className="pro-duel">
        <LaneCard variant="MAIN" lane={primaryPair?.main} symbol={primarySymbol} executionReady={executionReady} />
        <div className="pro-duel-rule"><span>STESSO SNAPSHOT</span><strong>VS</strong><p><b>MAIN/NORMALE</b> invia OANDA senza invertire BUY/SELL.<br />TP nominale +0,03 CHF · SL nominale -0,30 CHF; MIRROR resta PAPER SHADOW.</p><Link to="/vs">APRI CONFRONTO COMPLETO</Link></div>
        <LaneCard variant="INVERSE" lane={primaryPair?.inverse} symbol={primarySymbol} executionReady={executionReady} />
      </section>

      <section className="pro-insight-grid">
        <article className="pro-panel pro-strategy-table">
          <header><div><span>COSA FUNZIONA E COSA NO</span><h2>PERFORMANCE PER SETUP</h2></div><b>{closedTrades.length} CHIUSURE VERIFICATE</b></header>
          <div className="pro-table-scroll">
            <table><thead><tr><th>Setup</th><th>Trade</th><th>Win rate</th><th>Totale R</th><th>Expectancy</th><th>Stato</th></tr></thead>
              <tbody>{setupRows.map((row) => {
                const positive = (row.metrics.averageR ?? 0) > 0 && (row.metrics.profitFactor ?? 0) > 1;
                const label = row.metrics.sampleSize < 5 ? 'POCHI DATI' : positive ? 'POSITIVO' : 'DA MIGLIORARE';
                return <tr key={row.name}><th>{row.name}</th><td>{row.metrics.sampleSize}</td><td>{row.metrics.winRate === undefined ? 'N/A' : `${row.metrics.winRate.toFixed(1)}%`}</td><td className={resultTone(row.metrics.totalR)}>{formatR(row.metrics.totalR)}</td><td className={resultTone(row.metrics.averageR)}>{formatR(row.metrics.averageR)}</td><td><b className={positive ? 'good' : row.metrics.sampleSize < 5 ? 'warn' : 'bad'}>{label}</b></td></tr>;
              })}</tbody>
            </table>
            {!setupRows.length && <p className="pro-empty">NESSUN TRADE CHIUSO CON METRICHE R</p>}
          </div>
        </article>

        <article className={`pro-panel pro-readiness ${reviewCandidate ? 'candidate' : 'practice'}`}>
          <header><div><span>GO-LIVE READINESS</span><h2>{reviewCandidate ? 'CANDIDATO A REVIEW' : 'PRACTICE ONLY'}</h2></div><b>{reviewCandidate ? 'REVISIONE UMANA OBBLIGATORIA' : 'NON PRONTO PER LIVE'}</b></header>
          <div className="pro-readiness-score"><span>MAX DRAWDOWN MISURATO</span><strong>{performance.maxDrawdownR === undefined ? 'N/A' : `-${performance.maxDrawdownR.toFixed(2)}R`}</strong><small>Il bot non viene promosso automaticamente a denaro reale.</small></div>
          <div className="pro-check-list">
            {[
              { label: 'Broker + ledger OANDA verificati', pass: brokerPass, value: status?.reconciliationStatus || 'N/A' },
              { label: 'Campione minimo 30 trade in R', pass: samplePass, value: `${performance.sampleSize}/30` },
              { label: 'Expectancy positiva', pass: expectancyPass, value: formatR(performance.averageR) },
              { label: 'Profit factor sopra 1', pass: factorPass, value: formatFactor(performance.profitFactor) },
              { label: 'XAUUSD bloccato a zero ordini', pass: xauPass, value: `${xauLab?.orderCount ?? 'N/A'} ordini` }
            ].map((item) => <div key={item.label} className={item.pass ? 'pass' : 'fail'}><i>{item.pass ? '✓' : '×'}</i><span><strong>{item.label}</strong><small>{item.value}</small></span></div>)}
          </div>
        </article>
      </section>

      <section className="pro-panel pro-xau-strip">
        <header><div><span>XAUUSD · SEPARATO DAL BOT FX</span><h2>GOLD SIGNAL LAB</h2></div><Link to="/xauusd">APRI GRAFICO XAU</Link></header>
        <div className="pro-xau-body">
          <div className="pro-xau-price"><span>ULTIMO PREZZO OANDA</span><strong>{price(xauQuote?.mid ?? xau?.closePrice, 'XAUUSD')}</strong><b>SIGNAL ONLY · 0 ORDINI</b></div>
          <div><span>AI SIGNAL</span><strong className={sideClass(xauCandidate?.side)}>{xauCandidate?.ai?.approved ? xauCandidate.side : 'WAIT'}</strong></div>
          <div><span>OGGI</span><strong>{xauLab ? `${xauLab.todaySignals}/${xauLab.strategy.maxSignalsPerDay}` : 'N/A'}</strong></div>
          <div><span>TOTALE</span><strong className={resultTone(xauLab?.totalR)}>{xauLab ? formatR(xauLab.totalR) : 'N/A'}</strong></div>
          <div><span>WIN RATE</span><strong>{xauLab?.winRate === undefined ? 'N/A' : `${xauLab.winRate.toFixed(1)}%`}</strong></div>
          <div><span>MTF ALIGN</span><strong>{xauCandidate?.multiTimeframeAlignment === undefined ? 'N/A' : `${xauCandidate.multiTimeframeAlignment}%`}</strong></div>
          <p>{xauCandidate?.ai?.reason || xauCandidate?.reasoning || 'In attesa del prossimo snapshot XAUUSD.'}</p>
        </div>
      </section>
    </div>
  );
}
