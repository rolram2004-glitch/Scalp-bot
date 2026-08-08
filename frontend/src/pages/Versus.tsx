import { useMemo, useState } from 'react';
import { BotTrade, PairedSignalSnapshot, StatusSnapshot } from '../types';
import {
  buildEquityCurve,
  calculatePairedLaneMetrics,
  calculateSymbolEdges,
  comparisonCounts,
  pairTradesBySignal,
  sampleQuality,
  StrategyMetrics,
  TradePairComparison,
  tradeResultR
} from '../../../src/strategy-metrics';

type Lane = 'MAIN' | 'INVERSE';
type Scope = 'TODAY' | 'ALL';

function laneLabel(lane: Lane) {
  return lane === 'INVERSE' ? 'MIRROR' : 'MAIN';
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function cleanLane(value: unknown): Lane | undefined {
  return value === 'MAIN' || value === 'INVERSE' ? value : undefined;
}

function cleanSymbol(value: unknown) {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function utcDate(value?: string) {
  return typeof value === 'string' ? value.slice(0, 10) : undefined;
}

function tradeTime(trade: BotTrade) {
  return Date.parse(trade.closedAt || trade.openedAt || trade.signalAt || '') || 0;
}

function localTime(value?: string) {
  if (!value) return 'N/A';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? 'N/A'
    : parsed.toLocaleString([], { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function price(value: unknown, symbol?: string) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 'N/A';
  const normalized = cleanSymbol(symbol);
  return parsed.toFixed(normalized.includes('JPY') || normalized.includes('XAU') ? 3 : 5);
}

function formatR(value: number | undefined) {
  if (!finite(value)) return 'N/A';
  if (Math.abs(value) < 0.005) return '0.00R';
  return `${value > 0 ? '+' : ''}${value.toFixed(2)}R`;
}

function formatPercent(value: number | undefined) {
  return finite(value) ? `${value.toFixed(1)}%` : 'N/A';
}

function formatFactor(value: number | undefined) {
  if (!finite(value)) return value === Number.POSITIVE_INFINITY ? '∞' : 'N/A';
  return value.toFixed(2);
}

function resultTone(value: number | undefined) {
  return !finite(value) ? 'neutral' : value > 0 ? 'positive' : value < 0 ? 'negative' : 'neutral';
}

function money(trade: { source?: string; accountCurrency?: string; pnlCurrency?: string; pnl?: number }) {
  const currency = trade.source === 'OANDA' ? trade.accountCurrency : trade.pnlCurrency;
  if (!finite(trade.pnl) || !currency) return 'P&L N/A';
  return `${trade.pnl > 0 ? '+' : ''}${trade.pnl.toFixed(2)} ${currency}`;
}

function scoreText(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? `${Math.max(0, Math.min(100, Math.round(parsed)))}/100` : 'N/A';
}

function resetLabel(value?: string) {
  if (!value) return '00:00 UTC';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '00:00 UTC';
  return `${String(parsed.getUTCHours()).padStart(2, '0')}:${String(parsed.getUTCMinutes()).padStart(2, '0')} UTC`;
}

function laneTrades(status: StatusSnapshot | null, lane: Lane) {
  if (!status) return [];
  const selectedLane = cleanLane(status.liveExecutionVariant);
  const brokerTrades = [...(status.openTrades || []), ...(status.closedTrades || [])];
  const shadowTrades = [...(status.shadowOpenTrades || []), ...(status.shadowClosedTrades || [])];

  if (status.tradingMode === 'PAPER' && lane === 'MAIN') {
    return brokerTrades.filter((trade) => trade.source === 'PAPER').sort((a, b) => tradeTime(b) - tradeTime(a));
  }
  if (selectedLane === lane && status.tradingMode !== 'PAPER') {
    return brokerTrades
      .filter((trade) => trade.source === 'OANDA' && trade.verificationStatus === 'VERIFIED' &&
        (!cleanLane(trade.strategyVariant) || trade.strategyVariant === lane))
      .sort((a, b) => tradeTime(b) - tradeTime(a));
  }
  return shadowTrades
    .filter((trade) => trade.source === 'PAPER_SHADOW' &&
      (!cleanLane(trade.strategyVariant) || trade.strategyVariant === lane))
    .sort((a, b) => tradeTime(b) - tradeTime(a));
}

function scopedTrades(trades: BotTrade[], scope: Scope, dateUTC: string) {
  return scope === 'ALL' ? trades : trades.filter((trade) => utcDate(trade.openedAt) === dateUTC);
}

function latestSignals(status: StatusSnapshot | null) {
  return Object.values(status?.pairedSignals || {})
    .filter((pair): pair is PairedSignalSnapshot => Boolean(pair) && !cleanSymbol(pair.symbol).startsWith('XAU'))
    .sort((left, right) => Date.parse(right.evaluatedAt) - Date.parse(left.evaluatedAt))
    .slice(0, 8);
}

function laneMode(status: StatusSnapshot | null, lane: Lane) {
  if (!status) return 'DATI NON DISPONIBILI';
  if (status.tradingMode === 'PAPER' && lane === 'MAIN') return 'PAPER MAIN';
  if (cleanLane(status.liveExecutionVariant) === lane && status.tradingMode !== 'PAPER') {
    return status.tradingMode === 'OANDA_DEMO' ? 'OANDA PRACTICE' : 'OANDA LIVE';
  }
  return 'PAPER SHADOW';
}

function weekendPause(status: StatusSnapshot | null) {
  const day = new Date().getUTCDay();
  return Boolean(status?.isRunning) &&
    status?.reconciliationStatus === 'VERIFIED' &&
    status?.priceFeedStatus !== 'CONNECTED' &&
    (day === 0 || day === 6);
}

function friendlyGate(status: StatusSnapshot | null) {
  if (weekendPause(status)) return { label: 'MERCATO IN PAUSA', detail: 'Weekend · il bot riprende con quote OANDA fresche', tone: 'paused' };
  const gate = status?.entryGateStatus || (status?.isRunning ? 'CHECKING' : 'SCANNER STOPPED');
  if (gate === 'READY') return { label: 'PRONTO', detail: 'Tutti i gate di ingresso sono verificati', tone: 'ready' };
  if (gate === 'DAILY_TRADE_LIMIT') return { label: 'LIMITE GIORNALIERO', detail: 'Nuovi ingressi bloccati fino al reset UTC', tone: 'blocked' };
  if (gate === 'DAILY_LOSS_LIMIT') return { label: 'STOP PERDITA', detail: 'Protezione perdita giornaliera attiva', tone: 'danger' };
  if (gate === 'MAX_OPEN_POSITIONS') return { label: 'POSIZIONI PIENE', detail: 'Attende la chiusura di una posizione', tone: 'blocked' };
  return { label: String(gate).replace(/_/g, ' '), detail: status?.entryGateReason?.replace(/_/g, ' ') || 'Controlli operativi non pronti', tone: 'blocked' };
}

function verdict(main: StrategyMetrics, inverse: StrategyMetrics) {
  if (!finite(main.totalR) || !finite(inverse.totalR) || main.sampleSize === 0) {
    return { title: 'ATTENDO COPPIE CHIUSE', detail: 'Il confronto parte solo quando entrambi i gemelli hanno un risultato in R.', delta: 'N/A', lane: 'NONE', tone: 'neutral' };
  }
  const difference = main.totalR - inverse.totalR;
  if (Math.abs(difference) < 0.005) {
    return { title: 'RISULTATO PARI', detail: 'Le due corsie hanno lo stesso risultato cumulativo sul campione abbinato.', delta: '0.00R', lane: 'TIE', tone: 'neutral' };
  }
  const lane: Lane = difference > 0 ? 'MAIN' : 'INVERSE';
  const label = laneLabel(lane);
  const winningTotal = lane === 'MAIN' ? main.totalR : inverse.totalR;
  const losingTotal = lane === 'MAIN' ? inverse.totalR : main.totalR;
  if (winningTotal < 0 && losingTotal < 0) {
    return {
      title: `${label} MENO NEGATIVA`,
      detail: 'Attenzione: entrambe le corsie sono negative. “Migliore” non significa profittevole.',
      delta: `+${Math.abs(difference).toFixed(2)}R`,
      lane,
      tone: 'warning'
    };
  }
  return {
    title: `${label} IN VANTAGGIO`,
    detail: losingTotal < 0 ? `${label} è l’unica corsia positiva sul campione abbinato.` : 'Entrambe positive, ma questa corsia ha il risultato cumulativo maggiore.',
    delta: `+${Math.abs(difference).toFixed(2)}R`,
    lane,
    tone: 'good'
  };
}

function LaneSummary({ lane, metrics, mode, selected }: { lane: Lane; metrics: StrategyMetrics; mode: string; selected: boolean }) {
  return (
    <article className={`vs3-lane-summary ${lane.toLowerCase()}`}>
      <header>
        <div><span>{selected ? 'CORSIA OPERATIVA' : 'GEMELLO DI CONTROLLO'}</span><h2>{laneLabel(lane)}</h2></div>
        <b>{mode}</b>
      </header>
      <div className="vs3-lane-total">
        <span>RISULTATO SU COPPIE ABBINATE</span>
        <strong className={resultTone(metrics.totalR)}>{formatR(metrics.totalR)}</strong>
        <small>{metrics.sampleSize} risultati confrontabili · rischio iniziale = 1R</small>
      </div>
      <div className="vs3-lane-mini-grid">
        <div><span>Win rate</span><strong>{formatPercent(metrics.winRate)}</strong></div>
        <div><span>Expectancy</span><strong className={resultTone(metrics.averageR)}>{formatR(metrics.averageR)}</strong></div>
        <div><span>Profit factor</span><strong>{formatFactor(metrics.profitFactor)}</strong></div>
        <div><span>Max drawdown</span><strong>{finite(metrics.maxDrawdownR) ? `-${metrics.maxDrawdownR.toFixed(2)}R` : 'N/A'}</strong></div>
      </div>
    </article>
  );
}

function EquityComparison({ pairs }: { pairs: TradePairComparison[] }) {
  const points = buildEquityCurve(pairs);
  if (points.length < 2) return <div className="vs3-chart-empty">SERVONO ALMENO DUE RISULTATI ABBINATI PER DISEGNARE LA CURVA</div>;
  const width = 760;
  const height = 270;
  const padX = 42;
  const padY = 28;
  const values = points.flatMap((point) => [point.main, point.inverse, 0]);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const x = (index: number) => padX + (index / Math.max(points.length - 1, 1)) * (width - padX * 2);
  const y = (value: number) => padY + ((max - value) / range) * (height - padY * 2);
  const path = (lane: 'main' | 'inverse') => points.map((point, index) => `${index ? 'L' : 'M'} ${x(index).toFixed(2)} ${y(point[lane]).toFixed(2)}`).join(' ');
  const zeroY = y(0);
  const last = points[points.length - 1];

  return (
    <svg className="vs3-equity-chart" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Curva cumulativa dei risultati MAIN e MIRROR in R">
      <title>Curva cumulativa MAIN e MIRROR in unità R</title>
      {[0, 0.25, 0.5, 0.75, 1].map((part) => {
        const lineY = padY + part * (height - padY * 2);
        const value = max - part * range;
        return <g key={part}><line x1={padX} x2={width - padX} y1={lineY} y2={lineY} className="grid" /><text x="4" y={lineY + 4}>{value.toFixed(1)}R</text></g>;
      })}
      <line x1={padX} x2={width - padX} y1={zeroY} y2={zeroY} className="zero" />
      <path d={path('main')} className="main-line" />
      <path d={path('inverse')} className="inverse-line" />
      <circle cx={x(points.length - 1)} cy={y(last.main)} r="4" className="main-dot" />
      <circle cx={x(points.length - 1)} cy={y(last.inverse)} r="4" className="inverse-dot" />
      <text x={width - padX} y={y(last.main) - 9} textAnchor="end" className="main-label">MAIN {formatR(last.main)}</text>
      <text x={width - padX} y={y(last.inverse) + 17} textAnchor="end" className="inverse-label">MIRROR {formatR(last.inverse)}</text>
    </svg>
  );
}

function PairRow({ pair }: { pair: TradePairComparison }) {
  const label = pair.winner === 'OPEN'
    ? 'IN CORSO'
    : pair.winner === 'UNAVAILABLE'
      ? 'R N/A'
      : pair.winner === 'TIE'
        ? 'PARI'
        : `${laneLabel(pair.winner)} MIGLIORE`;
  const mainSource = pair.main.source === 'OANDA' ? 'OANDA' : 'PAPER SHADOW';
  const mirrorSource = pair.inverse.source === 'OANDA' ? 'OANDA' : 'PAPER SHADOW';
  return (
    <details className={`vs3-pair-row ${pair.comparable ? 'comparable' : 'pending'}`}>
      <summary>
        <div className="vs3-pair-symbol"><strong>{pair.symbol}</strong><span>{localTime(pair.main.openedAt || pair.inverse.openedAt)}</span></div>
        <div className="vs3-pair-lane main"><span>MAIN · {mainSource}</span><b className={`side-${String(pair.main.side).toLowerCase()}`}>{pair.main.side || 'N/A'}</b><strong className={resultTone(pair.mainR)}>{formatR(pair.mainR)}</strong></div>
        <div className="vs3-pair-result"><span>VERDETTO</span><strong>{label}</strong><small>{pair.comparable ? `${formatR(Math.abs((pair.mainR || 0) - (pair.inverseR || 0)))} gap` : 'attendo entrambi'}</small></div>
        <div className="vs3-pair-lane inverse"><span>MIRROR · {mirrorSource}</span><b className={`side-${String(pair.inverse.side).toLowerCase()}`}>{pair.inverse.side || 'N/A'}</b><strong className={resultTone(pair.inverseR)}>{formatR(pair.inverseR)}</strong></div>
        <i aria-hidden="true">⌄</i>
      </summary>
      <div className="vs3-pair-detail">
        <div><span>Signal ID</span><strong>{pair.signalId}</strong></div>
        <div><span>MAIN Entry / SL / TP</span><strong>{price(pair.main.entryPrice, pair.symbol)} · {price(pair.main.stopLoss, pair.symbol)} · {price(pair.main.takeProfit, pair.symbol)}</strong></div>
        <div><span>MIRROR Entry / SL / TP</span><strong>{price(pair.inverse.entryPrice, pair.symbol)} · {price(pair.inverse.stopLoss, pair.symbol)} · {price(pair.inverse.takeProfit, pair.symbol)}</strong></div>
        <div><span>MAIN broker receipt</span><strong>{pair.main.oandaTradeId ? `OANDA TRADE ${pair.main.oandaTradeId}` : pair.main.status === 'CLOSED' ? 'OANDA TRADE CHIUSO' : 'ID N/A'}</strong></div>
        <div><span>P&L originale MAIN</span><strong className={resultTone(pair.mainR)}>{money(pair.main)}</strong></div>
        <div><span>P&amp;L MIRROR</span><strong className={resultTone(pair.inverseR)}>{money(pair.inverse)}{pair.inverse.source === 'OANDA' ? ' · OANDA' : ' · PAPER'}</strong></div>
      </div>
    </details>
  );
}

export function VersusPage({ status }: { status: StatusSnapshot | null }) {
  const [scope, setScope] = useState<Scope>('ALL');
  const dateUTC = status?.dailyRiskStatus?.dateUTC || new Date().toISOString().slice(0, 10);
  const selectedLane = cleanLane(status?.liveExecutionVariant);
  const mainAll = laneTrades(status, 'MAIN');
  const inverseAll = laneTrades(status, 'INVERSE');
  const mainTrades = scopedTrades(mainAll, scope, dateUTC);
  const inverseTrades = scopedTrades(inverseAll, scope, dateUTC);
  const pairs = useMemo(() => pairTradesBySignal(mainTrades, inverseTrades), [mainTrades, inverseTrades]);
  const mainMetrics = useMemo(() => calculatePairedLaneMetrics(pairs, 'MAIN'), [pairs]);
  const inverseMetrics = useMemo(() => calculatePairedLaneMetrics(pairs, 'INVERSE'), [pairs]);
  const counts = useMemo(() => comparisonCounts(pairs), [pairs]);
  const symbolEdges = useMemo(() => calculateSymbolEdges(pairs), [pairs]);
  const result = verdict(mainMetrics, inverseMetrics);
  const quality = sampleQuality(mainMetrics.sampleSize);
  const signals = latestSignals(status);
  const gate = friendlyGate(status);
  const remaining = status?.dailyRemainingTrades ?? status?.dailyRiskStatus?.remainingTrades;
  const unmatchedMain = Math.max(0, mainTrades.filter((trade) => trade.signalId).length - pairs.length);
  const unmatchedInverse = Math.max(0, inverseTrades.filter((trade) => trade.signalId).length - pairs.length);
  const oandaLabel = status?.tradingMode === 'OANDA_LIVE' ? 'OANDA LIVE' : 'OANDA PRACTICE';
  const mainMode = status?.tradingMode === 'PAPER' ? 'PAPER MAIN' : selectedLane === 'MAIN' ? oandaLabel : 'PAPER SHADOW';
  const mirrorMode = selectedLane === 'INVERSE' && status?.tradingMode !== 'PAPER' ? oandaLabel : 'PAPER SHADOW';

  return (
    <div className="versus-page vs3">
      <section className="vs3-hero">
        <div>
          <p className="vs3-eyebrow">$Rohato$🤖111 · STRATEGY COMPARISON</p>
          <h1>MAIN contro MIRROR, senza confusione.</h1>
          <p>Stesso Signal ID, direzione opposta e livelli realmente scambiati: MAIN SL → MIRROR TP; MAIN TP → MIRROR SL.</p>
        </div>
        <div className={`vs3-gate ${gate.tone}`}><span>STATO OPERATIVO</span><strong>{gate.label}</strong><small>{gate.detail}</small></div>
      </section>

      <section className="vs3-truth-bar" aria-label="Significato delle due corsie">
        <div className="main"><span>01 · NORMALE</span><strong>MAIN</strong><b>{mainMode}</b></div>
        <div className="rule">
          <span>REGOLA STRICT MIRROR · ROSSO ↔ VERDE</span>
          <div className="vs3-mirror-rules" aria-label="Mappatura degli esiti MAIN e MIRROR">
            <div className="vs3-result-swap"><b className="loss">MAIN LOSS · SL</b><i>→</i><b className="win">MIRROR WIN · TP</b></div>
            <div className="vs3-result-swap"><b className="win">MAIN WIN · TP</b><i>→</i><b className="loss">MIRROR LOSS · SL</b></div>
          </div>
          <small>Vengono scambiati gli stessi livelli di prezzo. Il P&amp;L monetario non viene copiato: usa bid/ask reali, quindi spread e slippage restano visibili.</small>
        </div>
        <div className="inverse"><span>02 · CONTRARIO</span><strong>MIRROR</strong><b>{mirrorMode}</b></div>
      </section>

      {(unmatchedMain > 0 || unmatchedInverse > 0) && (
        <section className="vs3-data-notice" aria-label="Integrità del confronto">
          <div>
            <span>INTEGRITÀ DEL CONFRONTO</span>
            <strong>{pairs.length ? 'STORICO NON ABBINATO ESCLUSO' : 'LEDGER PAPER RIPARTITO DOPO IL DEPLOY'}</strong>
            <p>OANDA conserva la corsia operativa; la corsia PAPER riparte con il processo Railway. I record senza lo stesso Signal ID su entrambe le corsie vengono esclusi: il bot non inventa risultati mancanti.</p>
          </div>
          <b>{unmatchedMain + unmatchedInverse} RECORD ESCLUSI · 0 DATI INVENTATI</b>
        </section>
      )}

      <section className="vs3-verdict-panel">
        <div className="vs3-scope" role="group" aria-label="Periodo del confronto">
          <button className={scope === 'ALL' ? 'active' : ''} onClick={() => setScope('ALL')}>SESSIONE BOT</button>
          <button className={scope === 'TODAY' ? 'active' : ''} onClick={() => setScope('TODAY')}>OGGI UTC</button>
        </div>
        <div className={`vs3-verdict ${result.tone}`}>
          <span>VERDETTO SULLO STESSO CAMPIONE</span>
          <strong>{result.title}</strong>
          <b>{result.delta}</b>
          <p>{result.detail}</p>
        </div>
        <div className="vs3-sample">
          <span>AFFIDABILITÀ LETTURA</span><strong className={quality.tone}>{quality.label}</strong>
          <small>{mainMetrics.sampleSize} chiuse · {counts.open} in corso · {pairs.length} coppie totali</small>
        </div>
      </section>

      <section className="vs3-scoreboard">
        <LaneSummary lane="MAIN" metrics={mainMetrics} mode={laneMode(status, 'MAIN')} selected={selectedLane === 'MAIN' || status?.tradingMode === 'PAPER'} />
        <div className="vs3-head-to-head">
          <span>HEAD TO HEAD</span><strong>{counts.main}<small>MAIN</small></strong><b>VS</b><strong>{counts.inverse}<small>MIRROR</small></strong>
          <p>{counts.ties} pari · solo coppie concluse</p>
        </div>
        <LaneSummary lane="INVERSE" metrics={inverseMetrics} mode={laneMode(status, 'INVERSE')} selected={selectedLane === 'INVERSE'} />
      </section>

      <section className="vs3-analysis-grid">
        <article className="vs3-panel vs3-equity-panel">
          <header><div><span>ANDAMENTO CUMULATIVO</span><h2>EQUITY CURVE IN R</h2></div><b>{mainMetrics.sampleSize} COPPIE CHIUSE</b></header>
          <div className="vs3-legend"><span className="main">MAIN · {mainMode}</span><span className="inverse">MIRROR · {mirrorMode}</span><small>La linea zero separa profitto e perdita.</small></div>
          <EquityComparison pairs={pairs} />
        </article>
        <article className="vs3-panel vs3-metrics-panel">
          <header><div><span>METRICHE PROFESSIONALI</span><h2>QUALITÀ DEL RISULTATO</h2></div><b>STESSO CAMPIONE</b></header>
          <div className="vs3-metric-table-wrap">
            <table className="vs3-metric-table">
              <thead><tr><th>Metrica</th><th className="main">MAIN</th><th className="inverse">MIRROR</th></tr></thead>
              <tbody>
                <tr><th>Totale</th><td className={resultTone(mainMetrics.totalR)}>{formatR(mainMetrics.totalR)}</td><td className={resultTone(inverseMetrics.totalR)}>{formatR(inverseMetrics.totalR)}</td></tr>
                <tr><th>Expectancy / trade</th><td className={resultTone(mainMetrics.averageR)}>{formatR(mainMetrics.averageR)}</td><td className={resultTone(inverseMetrics.averageR)}>{formatR(inverseMetrics.averageR)}</td></tr>
                <tr><th>Win rate</th><td>{formatPercent(mainMetrics.winRate)}</td><td>{formatPercent(inverseMetrics.winRate)}</td></tr>
                <tr><th>Profit factor</th><td>{formatFactor(mainMetrics.profitFactor)}</td><td>{formatFactor(inverseMetrics.profitFactor)}</td></tr>
                <tr><th>Max drawdown</th><td>{finite(mainMetrics.maxDrawdownR) ? `-${mainMetrics.maxDrawdownR.toFixed(2)}R` : 'N/A'}</td><td>{finite(inverseMetrics.maxDrawdownR) ? `-${inverseMetrics.maxDrawdownR.toFixed(2)}R` : 'N/A'}</td></tr>
                <tr><th>Migliore / peggiore</th><td>{formatR(mainMetrics.bestR)} / {formatR(mainMetrics.worstR)}</td><td>{formatR(inverseMetrics.bestR)} / {formatR(inverseMetrics.worstR)}</td></tr>
                <tr><th>Win / Loss / BE</th><td>{mainMetrics.wins} / {mainMetrics.losses} / {mainMetrics.breakeven}</td><td>{inverseMetrics.wins} / {inverseMetrics.losses} / {inverseMetrics.breakeven}</td></tr>
              </tbody>
            </table>
          </div>
        </article>
      </section>

      <section className="vs3-panel vs3-symbol-panel">
        <header><div><span>DOVE CAMBIA IL RISULTATO</span><h2>EDGE PER COPPIA</h2></div><b>{symbolEdges.length} MERCATI CON DATI</b></header>
        <div className="vs3-symbol-table-wrap">
          <table className="vs3-symbol-table">
            <thead><tr><th>Mercato</th><th>Campione</th><th>MAIN</th><th>MIRROR</th><th>Vantaggio</th></tr></thead>
            <tbody>{symbolEdges.slice(0, 15).map((edge) => (
              <tr key={edge.symbol}><th>{edge.symbol}</th><td>{edge.pairs}</td><td className={resultTone(edge.mainR)}>{formatR(edge.mainR)}</td><td className={resultTone(edge.inverseR)}>{formatR(edge.inverseR)}</td><td><b className={edge.winner.toLowerCase()}>{edge.winner === 'TIE' ? 'PARI' : laneLabel(edge.winner)}</b><span>{formatR(Math.abs(edge.deltaR))}</span></td></tr>
            ))}</tbody>
          </table>
          {!symbolEdges.length && <div className="vs3-empty">NESSUN RISULTATO ABBINATO NEL PERIODO</div>}
        </div>
      </section>

      <section className="vs3-panel vs3-ledger-panel">
        <header><div><span>STESSO SIGNAL ID · DETTAGLI ESPANDIBILI</span><h2>CONFRONTO TRADE PER TRADE</h2></div><b>{pairs.length} COPPIE</b></header>
        <div className="vs3-ledger-intro"><span>Operativa = ricevuta OANDA</span><span>Gemello = PAPER shadow</span><span>Verde = profitto</span><span>Rosso = perdita</span></div>
        <div className="vs3-pair-list">{pairs.slice(0, 30).map((pair) => <PairRow key={pair.signalId} pair={pair} />)}{!pairs.length && <div className="vs3-empty">NESSUNA COPPIA MAIN ↔ MIRROR NEL PERIODO</div>}</div>
      </section>

      <section className="vs3-panel vs3-live-panel">
        <header><div><span>ULTIMO CICLO · 15 FX</span><h2>SEGNALI SPECULARI CORRENTI</h2></div><b>{signals.length} SNAPSHOT</b></header>
        <div className="vs3-live-grid">{signals.map((pair) => (
          <article key={pair.pairId}>
            <header><strong>{pair.symbol}</strong><span>{localTime(pair.evaluatedAt)}</span></header>
            <div><b className={`side-${pair.main.action.toLowerCase()}`}>MAIN {pair.main.action}</b><i>↔</i><b className={`side-${pair.inverse.action.toLowerCase()}`}>MIRROR {pair.inverse.action}</b></div>
            <footer><span>{scoreText(pair.main.setupScore ?? pair.main.confidence)}</span><span>{pair.main.setupType || 'SETUP N/A'}</span><span>{pair.marketValid ? 'OANDA FRESH' : 'HOLD'}</span></footer>
          </article>
        ))}{!signals.length && <div className="vs3-empty">SNAPSHOT NON DISPONIBILI</div>}</div>
      </section>

      <footer className="vs3-proof-footer">
        <div><span>INGRESSI OGGI</span><strong>{status?.dailyTradeCount ?? 'N/A'} / {status?.maxDailyTrades ?? 'N/A'}</strong></div>
        <div><span>POSTI RIMASTI</span><strong>{remaining ?? 'N/A'}</strong></div>
        <div><span>RESET</span><strong>{resetLabel(status?.nextDailyResetAt || status?.dailyRiskStatus?.resetAt)}</strong></div>
        <div><span>ESCLUSI DAL CONFRONTO</span><strong>{unmatchedMain} MAIN · {unmatchedInverse} MIRROR</strong></div>
        <p>Una sola corsia può aprire ordini OANDA; l'altra resta PAPER. I risultati sono confrontati in R senza sommare valute diverse.</p>
      </footer>
    </div>
  );
}
