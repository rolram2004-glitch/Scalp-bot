import { useState } from 'react';
import { BotTrade, PairedSignalSnapshot, StatusSnapshot } from '../types';

type Lane = 'MAIN' | 'INVERSE';
type Scope = 'TODAY' | 'ALL';

type LaneMetrics = {
  trades: BotTrade[];
  open: BotTrade[];
  closed: BotTrade[];
  wins: number;
  losses: number;
  breakeven: number;
  decided: number;
  winRate?: number;
  totalR?: number;
  comparableResults: number;
  pnlByCurrency: Array<[string, number]>;
};

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function cleanLane(value: unknown): Lane | undefined {
  return value === 'MAIN' || value === 'INVERSE' ? value : undefined;
}

function cleanText(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function cleanSymbol(value: unknown) {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function tradeTime(trade: BotTrade) {
  return Date.parse(trade.closedAt || trade.openedAt || '') || 0;
}

function utcDate(value?: string) {
  return cleanText(value)?.slice(0, 10);
}

function localTime(value?: string) {
  if (!value) return 'N/A';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime())
    ? 'N/A'
    : parsed.toLocaleString([], {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit'
      });
}

function resetLabel(value?: string) {
  if (!value) return '00:00 UTC';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '00:00 UTC';
  return `${String(parsed.getUTCHours()).padStart(2, '0')}:${String(parsed.getUTCMinutes()).padStart(2, '0')} UTC`;
}

function price(value: unknown, symbol?: string) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 'N/A';
  const normalized = cleanSymbol(symbol);
  return parsed.toFixed(normalized.includes('JPY') || normalized.includes('XAU') ? 3 : 5);
}

function currencyFor(trade: BotTrade) {
  return cleanText(trade.source === 'OANDA' ? trade.accountCurrency : trade.pnlCurrency);
}

function money(trade: BotTrade) {
  const currency = currencyFor(trade);
  if (!finite(trade.pnl) || !currency) return 'P&L N/A';
  return `${trade.pnl >= 0 ? '+' : '-'}${Math.abs(trade.pnl).toFixed(2)} ${currency}`;
}

function resultR(trade: BotTrade) {
  if (finite(trade.pnlR)) return trade.pnlR;
  if (finite(trade.pnlPips) && finite(trade.riskPips) && trade.riskPips > 0) {
    return trade.pnlPips / trade.riskPips;
  }
  const riskAmount = Number(trade.riskAmount);
  if (finite(trade.pnl) && Number.isFinite(riskAmount) && riskAmount > 0) {
    return trade.pnl / riskAmount;
  }
  return undefined;
}

function formatR(value: number | undefined) {
  if (!finite(value)) return 'R N/A';
  if (Math.abs(value) < 0.005) return '0.00R';
  return `${value > 0 ? '+' : ''}${value.toFixed(2)}R`;
}

function resultClass(trade: BotTrade) {
  const normalized = resultR(trade);
  if (finite(normalized)) return normalized > 0 ? 'positive' : normalized < 0 ? 'negative' : 'neutral';
  if (!finite(trade.pnl)) return 'neutral';
  return trade.pnl > 0 ? 'positive' : trade.pnl < 0 ? 'negative' : 'neutral';
}

function laneTrades(status: StatusSnapshot | null, lane: Lane) {
  if (!status) return [];
  const selectedLane = cleanLane(status.liveExecutionVariant);
  const brokerTrades = [...(status.openTrades || []), ...(status.closedTrades || [])];
  const shadowTrades = [...(status.shadowOpenTrades || []), ...(status.shadowClosedTrades || [])];

  if (status.tradingMode === 'PAPER' && lane === 'MAIN') {
    return brokerTrades
      .filter((trade) => trade.source === 'PAPER')
      .sort((left, right) => tradeTime(right) - tradeTime(left));
  }

  if (selectedLane === lane && status.tradingMode !== 'PAPER') {
    return brokerTrades
      .filter((trade) =>
        trade.source === 'OANDA' &&
        trade.verificationStatus === 'VERIFIED' &&
        (!cleanLane(trade.strategyVariant) || trade.strategyVariant === lane)
      )
      .sort((left, right) => tradeTime(right) - tradeTime(left));
  }

  return shadowTrades
    .filter((trade) =>
      trade.source === 'PAPER_SHADOW' &&
      (!cleanLane(trade.strategyVariant) || trade.strategyVariant === lane)
    )
    .sort((left, right) => tradeTime(right) - tradeTime(left));
}

function scopedTrades(trades: BotTrade[], scope: Scope, dateUTC: string) {
  if (scope === 'ALL') return trades;
  return trades.filter((trade) => utcDate(trade.openedAt) === dateUTC);
}

function calculateMetrics(trades: BotTrade[]): LaneMetrics {
  const open = trades.filter((trade) => trade.status === 'OPEN');
  const closed = trades.filter((trade) => trade.status === 'CLOSED');
  const comparable = closed
    .map((trade) => ({ trade, value: resultR(trade) }))
    .filter((item): item is { trade: BotTrade; value: number } => finite(item.value));
  const wins = comparable.filter((item) => item.value > 0).length;
  const losses = comparable.filter((item) => item.value < 0).length;
  const breakeven = comparable.filter((item) => item.value === 0).length;
  const decided = wins + losses;
  const totals = new Map<string, number>();

  closed.forEach((trade) => {
    const currency = currencyFor(trade);
    if (!currency || !finite(trade.pnl)) return;
    totals.set(currency, (totals.get(currency) || 0) + trade.pnl);
  });

  return {
    trades,
    open,
    closed,
    wins,
    losses,
    breakeven,
    decided,
    winRate: decided > 0 ? Math.round((wins / decided) * 1000) / 10 : undefined,
    totalR: comparable.length > 0
      ? comparable.reduce((sum, item) => sum + item.value, 0)
      : undefined,
    comparableResults: comparable.length,
    pnlByCurrency: [...totals.entries()].sort(([left], [right]) => left.localeCompare(right))
  };
}

function laneMode(status: StatusSnapshot | null, lane: Lane) {
  if (!status) return 'DATI NON DISPONIBILI';
  if (status.tradingMode === 'PAPER' && lane === 'MAIN') return 'PAPER MAIN · 0 ORDINI';
  if (cleanLane(status.liveExecutionVariant) === lane && status.tradingMode !== 'PAPER') {
    return status.tradingMode === 'OANDA_DEMO'
      ? 'OANDA PRACTICE · VERIFICATO'
      : 'OANDA LIVE · VERIFICATO';
  }
  return 'SIMULAZIONE CONTRARIA · 0 ORDINI';
}

function scoreText(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? `${Math.max(0, Math.min(100, Math.round(parsed)))}/100` : 'N/A';
}

function LaneScoreCard({
  lane,
  metrics,
  selected,
  mode
}: {
  lane: Lane;
  metrics: LaneMetrics;
  selected: boolean;
  mode: string;
}) {
  return (
    <article className={`vs-lane-card ${lane.toLowerCase()} ${selected ? 'selected' : 'shadow'}`}>
      <header>
        <div>
          <span>{selected ? 'CORSIA OANDA SELEZIONATA' : 'SOLO CONFRONTO PAPER'}</span>
          <h2>{lane}</h2>
        </div>
        <b>{mode}</b>
      </header>

      <div className="vs-lane-primary">
        <span>RISULTATO NORMALIZZATO</span>
        <strong className={finite(metrics.totalR) ? metrics.totalR > 0 ? 'positive' : metrics.totalR < 0 ? 'negative' : 'neutral' : 'neutral'}>
          {formatR(metrics.totalR)}
        </strong>
        <small>{metrics.comparableResults} chiusure confrontabili · rischio iniziale = 1R</small>
      </div>

      <div className="vs-lane-kpis">
        <div><span>Win rate</span><strong>{metrics.winRate === undefined ? 'N/A' : `${metrics.winRate.toFixed(1)}%`}</strong></div>
        <div><span>W / L / BE</span><strong>{metrics.comparableResults ? `${metrics.wins}/${metrics.losses}/${metrics.breakeven}` : 'N/A'}</strong></div>
        <div><span>Aperti</span><strong>{metrics.open.length}</strong></div>
        <div><span>Chiusi</span><strong>{metrics.closed.length}</strong></div>
      </div>

      <div className="vs-money-proof">
        <span>P&amp;L originale — mai sommato tra valute diverse</span>
        <div>
          {metrics.pnlByCurrency.length > 0
            ? metrics.pnlByCurrency.map(([currency, value]) => (
                <b key={currency} className={value > 0 ? 'positive' : value < 0 ? 'negative' : 'neutral'}>
                  {value > 0 ? '+' : ''}{value.toFixed(2)} {currency}
                </b>
              ))
            : <b className="neutral">N/A</b>}
        </div>
      </div>
    </article>
  );
}

function LaneTradeList({ lane, metrics, mode }: { lane: Lane; metrics: LaneMetrics; mode: string }) {
  const trades = metrics.trades.slice(0, 10);
  return (
    <article className={`cockpit-panel vs-trade-ledger ${lane.toLowerCase()}`}>
      <header className="cockpit-panel__header">
        <div><span>{mode}</span><h2>OPERAZIONI {lane}</h2></div>
        <b>{metrics.trades.length} RECORD</b>
      </header>
      <div className="vs-trade-list">
        {trades.length > 0 ? trades.map((trade) => (
          <article className="vs-trade-row" key={`${lane}-${trade.id}`}>
            <div className="vs-trade-row__lead">
              <b className={trade.side === 'BUY' ? 'positive' : trade.side === 'SELL' ? 'negative' : 'neutral'}>
                {trade.side || 'N/A'}
              </b>
              <div>
                <strong>{trade.symbol || 'N/A'}</strong>
                <span>{localTime(trade.closedAt || trade.openedAt)}</span>
              </div>
              <em className={trade.status === 'OPEN' ? 'open' : 'closed'}>{trade.status || 'N/A'}</em>
            </div>
            <div className="vs-trade-row__prices">
              <span>Entry <b>{price(trade.entryPrice, trade.symbol)}</b></span>
              <span>Exit / Current <b>{price(trade.currentPrice, trade.symbol)}</b></span>
              <span>SL · {trade.riskPips ?? 10}p <b className="negative">{price(trade.stopLoss, trade.symbol)}</b></span>
              <span>TP · {trade.rewardPips ?? 20}p <b className="positive">{price(trade.takeProfit, trade.symbol)}</b></span>
            </div>
            <div className="vs-trade-row__result">
              <strong className={resultClass(trade)}>{formatR(resultR(trade))}</strong>
              <span>{money(trade)} · {trade.closeReason || trade.setupType || 'IN CORSO'}</span>
            </div>
            <footer>
              <span>{trade.source || 'N/A'} · {trade.strategyVariant || lane}</span>
              <span>Signal {trade.signalId ? trade.signalId.slice(-18) : 'N/A'}</span>
              <span>{trade.oandaTradeId ? `OANDA ${trade.oandaTradeId}` : '0 ORDINI OANDA'}</span>
            </footer>
          </article>
        )) : (
          <div className="dense-empty">NESSUNA OPERAZIONE {lane} NEL PERIODO</div>
        )}
      </div>
    </article>
  );
}

function pairedTrades(main: BotTrade[], inverse: BotTrade[]) {
  const mainBySignal = new Map(
    main.filter((trade) => trade.signalId).map((trade) => [trade.signalId as string, trade])
  );
  const inverseBySignal = new Map(
    inverse.filter((trade) => trade.signalId).map((trade) => [trade.signalId as string, trade])
  );

  return [...mainBySignal.entries()]
    .filter(([signalId]) => inverseBySignal.has(signalId))
    .map(([signalId, mainTrade]) => ({
      signalId,
      main: mainTrade,
      inverse: inverseBySignal.get(signalId) as BotTrade
    }))
    .sort((left, right) =>
      Math.max(tradeTime(right.main), tradeTime(right.inverse)) -
      Math.max(tradeTime(left.main), tradeTime(left.inverse))
    );
}

function latestPairs(status: StatusSnapshot | null) {
  return Object.values(status?.pairedSignals || {})
    .filter((pair): pair is PairedSignalSnapshot => Boolean(pair) && !cleanSymbol(pair.symbol).startsWith('XAU'))
    .sort((left, right) => Date.parse(right.evaluatedAt) - Date.parse(left.evaluatedAt))
    .slice(0, 10);
}

export function VersusPage({ status }: { status: StatusSnapshot | null }) {
  const [scope, setScope] = useState<Scope>('TODAY');
  const dateUTC = status?.dailyRiskStatus?.dateUTC || new Date().toISOString().slice(0, 10);
  const selectedLane = cleanLane(status?.liveExecutionVariant);
  const mainAll = laneTrades(status, 'MAIN');
  const inverseAll = laneTrades(status, 'INVERSE');
  const mainTrades = scopedTrades(mainAll, scope, dateUTC);
  const inverseTrades = scopedTrades(inverseAll, scope, dateUTC);
  const mainMetrics = calculateMetrics(mainTrades);
  const inverseMetrics = calculateMetrics(inverseTrades);
  const matched = pairedTrades(mainTrades, inverseTrades).slice(0, 12);
  const pairedTotal = pairedTrades(mainTrades, inverseTrades).length;
  const signals = latestPairs(status);
  const scanSeconds = finite(status?.scanIntervalMs) ? Math.round(status.scanIntervalMs / 1000) : undefined;
  const remaining = status?.dailyRemainingTrades ?? status?.dailyRiskStatus?.remainingTrades;
  const gate = status?.entryGateStatus || (status?.isRunning ? 'CHECKING' : 'SCANNER_STOPPED');
  const gateReady = gate === 'READY';

  const mainTotal = mainMetrics.totalR;
  const inverseTotal = inverseMetrics.totalR;
  const comparison = finite(mainTotal) && finite(inverseTotal)
    ? Math.abs(mainTotal - inverseTotal) < 0.005
      ? 'RISULTATO PARI'
      : mainTotal > inverseTotal
        ? `MAIN +${(mainTotal - inverseTotal).toFixed(2)}R`
        : `INVERSE +${(inverseTotal - mainTotal).toFixed(2)}R`
    : 'ATTENDO COPPIE CHIUSE';

  return (
    <div className="versus-page">
      <section className="cockpit-panel vs-hero">
        <div>
          <p className="vs-eyebrow">$Rohato$🤖111 · MAIN / INVERSE LAB</p>
          <h1>Stesso segnale. Direzione opposta. Risultato finalmente chiaro.</h1>
          <p>
            MAIN è la corsia operativa verificata. INVERSE è la simulazione contraria,
            aperta soltanto quando esiste il trade MAIN corrispondente: un Signal ID, una coppia, zero numeri inventati.
          </p>
        </div>
        <div className="vs-hero__state">
          <span>ENTRY GATE</span>
          <strong className={gateReady ? 'positive' : gate === 'DAILY_LOSS_LIMIT' ? 'negative' : 'warning-text'}>{gate}</strong>
          <small>{status?.tradingMode || 'MODE N/A'} · {selectedLane || 'LANE N/A'}</small>
        </div>
      </section>

      <section className="vs-control-bar" aria-label="Controlli e limite operativo">
        <div className="vs-scope-toggle" role="group" aria-label="Periodo risultati">
          <button className={scope === 'TODAY' ? 'active' : ''} onClick={() => setScope('TODAY')}>OGGI UTC</button>
          <button className={scope === 'ALL' ? 'active' : ''} onClick={() => setScope('ALL')}>RUNTIME</button>
        </div>
        <div><span>Ingressi oggi</span><strong>{status?.dailyTradeCount ?? 'N/A'} / {status?.maxDailyTrades ?? 'N/A'}</strong></div>
        <div><span>Posti rimasti</span><strong>{remaining ?? 'N/A'}</strong></div>
        <div><span>Reset limite</span><strong>{resetLabel(status?.nextDailyResetAt || status?.dailyRiskStatus?.resetAt)}</strong></div>
        <div><span>Cooldown coppia</span><strong>{finite(status?.symbolReentryCooldownMs) ? `${Math.round(status.symbolReentryCooldownMs / 60000)} min` : 'N/A'}</strong></div>
      </section>

      <section className="vs-profile-strip" aria-label="Profilo operativo">
        <div><span>Profilo</span><strong>{status?.signalProfile || 'N/A'}</strong></div>
        <div><span>Scansione</span><strong>{scanSeconds ? `${scanSeconds}s` : 'N/A'}</strong></div>
        <div><span>Setup minimo</span><strong>{status?.minimumConfidence ?? 'N/A'}/100</strong></div>
        <div><span>Nuovi / ciclo</span><strong>{status?.maxNewTradesPerCycle ?? 'N/A'}</strong></div>
        <div><span>Posizioni max</span><strong>{status?.maxOpenPositions ?? 'N/A'}</strong></div>
        <div><span>FX / XAU orders</span><strong>15 / 0</strong></div>
      </section>

      <section className="vs-scoreboard">
        <LaneScoreCard
          lane="MAIN"
          metrics={mainMetrics}
          selected={selectedLane === 'MAIN' || status?.tradingMode === 'PAPER'}
          mode={laneMode(status, 'MAIN')}
        />
        <div className="vs-scoreboard__center">
          <span>VS</span>
          <strong>{comparison}</strong>
          <small>{pairedTotal} coppie uno-a-uno nel periodo</small>
        </div>
        <LaneScoreCard
          lane="INVERSE"
          metrics={inverseMetrics}
          selected={selectedLane === 'INVERSE'}
          mode={laneMode(status, 'INVERSE')}
        />
      </section>

      <section className="vs-explainer">
        <strong>INVERSE ≠ PERDITA</strong>
        <span>INVERSE indica soltanto la direzione opposta. Verde = profitto, rosso = perdita, menta = corsia di simulazione.</span>
      </section>

      <section className="cockpit-panel vs-paired-ledger">
        <header className="cockpit-panel__header">
          <div><span>STESSO SIGNAL ID · RISULTATO IN R</span><h2>CONFRONTO UNO-A-UNO</h2></div>
          <b>{pairedTotal} COPPIE</b>
        </header>
        <div className="vs-paired-table">
          <div className="vs-paired-head">
            <span>Segnale</span><span>MAIN OANDA</span><span>INVERSE PAPER</span><span>Vantaggio</span>
          </div>
          {matched.length > 0 ? matched.map((row) => {
            const mainR = resultR(row.main);
            const inverseR = resultR(row.inverse);
            const bothClosed = row.main.status === 'CLOSED' && row.inverse.status === 'CLOSED';
            const comparable = bothClosed && finite(mainR) && finite(inverseR);
            const verdict = comparable
              ? Math.abs(mainR - inverseR) < 0.005
                ? 'PARI'
                : mainR > inverseR ? `MAIN +${(mainR - inverseR).toFixed(2)}R` : `INVERSE +${(inverseR - mainR).toFixed(2)}R`
              : bothClosed ? 'R N/A' : 'IN CORSO';
            return (
              <article className="vs-paired-row" key={row.signalId}>
                <div>
                  <strong>{row.main.symbol || row.inverse.symbol || 'N/A'}</strong>
                  <span>{localTime(row.main.openedAt || row.inverse.openedAt)}</span>
                  <small>{row.signalId.slice(-18)}</small>
                </div>
                <div>
                  <b className={row.main.side === 'BUY' ? 'positive' : 'negative'}>{row.main.side || 'N/A'}</b>
                  <strong className={resultClass(row.main)}>{formatR(mainR)}</strong>
                  <span>{money(row.main)} · {row.main.status || 'N/A'}</span>
                </div>
                <div>
                  <b className={row.inverse.side === 'BUY' ? 'positive' : 'negative'}>{row.inverse.side || 'N/A'}</b>
                  <strong className={resultClass(row.inverse)}>{formatR(inverseR)}</strong>
                  <span>{money(row.inverse)} · {row.inverse.status || 'N/A'}</span>
                </div>
                <div><strong>{verdict}</strong><span>{comparable ? 'CONFRONTO VALIDO' : 'ATTENDO RISULTATO'}</span></div>
              </article>
            );
          }) : <div className="dense-empty">LE NUOVE COPPIE COMPARIRANNO DOPO IL PROSSIMO INGRESSO MAIN VERIFICATO</div>}
        </div>
      </section>

      <section className="cockpit-panel vs-live-signals">
        <header className="cockpit-panel__header">
          <div><span>15 MERCATI FX · ULTIMO CICLO</span><h2>SEGNALI SPECULARI</h2></div>
          <b>{signals.length || 'N/A'} SNAPSHOT</b>
        </header>
        <div className="vs-signal-list">
          {signals.length > 0 ? signals.map((pair) => (
            <article key={pair.pairId}>
              <div><strong>{pair.symbol}</strong><span>{localTime(pair.evaluatedAt)}</span></div>
              <div className={pair.main.action === 'BUY' ? 'buy' : pair.main.action === 'SELL' ? 'sell' : 'hold'}>
                <span>MAIN</span><strong>{pair.main.action}</strong><small>{scoreText(pair.main.setupScore ?? pair.main.confidence)}</small>
              </div>
              <b>VS</b>
              <div className={pair.inverse.action === 'BUY' ? 'buy' : pair.inverse.action === 'SELL' ? 'sell' : 'hold'}>
                <span>INVERSE</span><strong>{pair.inverse.action}</strong><small>{scoreText(pair.inverse.setupScore ?? pair.inverse.confidence)}</small>
              </div>
              <div><strong>{pair.main.selectedForExecution ? pair.main.executionState : pair.inverse.selectedForExecution ? pair.inverse.executionState : 'ANALISI'}</strong><span>{pair.marketValid ? 'QUOTE OANDA VERIFICATA' : pair.marketValidationReason || 'QUOTE N/A'}</span></div>
            </article>
          )) : <div className="dense-empty">NESSUN SEGNALE SPECULARE DISPONIBILE</div>}
        </div>
      </section>

      <section className="vs-ledger-grid">
        <LaneTradeList lane="MAIN" metrics={mainMetrics} mode={laneMode(status, 'MAIN')} />
        <LaneTradeList lane="INVERSE" metrics={inverseMetrics} mode={laneMode(status, 'INVERSE')} />
      </section>

      <section className="vs-safety-note">
        <strong>SEPARAZIONE VERIFICABILE</strong>
        <span>
          MAIN usa trade OANDA verificati. INVERSE usa PAPER SHADOW con 0 ordini OANDA.
          Il confronto in R evita di sommare CHF, JPY, USD o CAD come se fossero la stessa valuta.
        </span>
      </section>
    </div>
  );
}
