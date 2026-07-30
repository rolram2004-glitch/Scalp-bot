import { BotTrade, PairedSignalSnapshot, StatusSnapshot } from '../types';

type Lane = 'MAIN' | 'INVERSE';

type LaneMetrics = {
  trades: BotTrade[];
  open: BotTrade[];
  closed: BotTrade[];
  wins: number;
  losses: number;
  decided: number;
  winRate?: number;
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

function tradeTime(trade: BotTrade) {
  return Date.parse(trade.closedAt || trade.openedAt || '') || 0;
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

function price(value: unknown, symbol?: string) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 'N/A';
  const normalized = String(symbol || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return parsed.toFixed(normalized.includes('JPY') || normalized.includes('XAU') ? 3 : 5);
}

function currencyFor(trade: BotTrade) {
  return cleanText(trade.source === 'OANDA' ? trade.accountCurrency : trade.pnlCurrency);
}

function money(trade: BotTrade) {
  const currency = currencyFor(trade);
  if (!finite(trade.pnl) || !currency) return 'N/A';
  return `${trade.pnl >= 0 ? '+' : '-'}${Math.abs(trade.pnl).toFixed(2)} ${currency}`;
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

function calculateMetrics(trades: BotTrade[]): LaneMetrics {
  const open = trades.filter((trade) => trade.status === 'OPEN');
  const closed = trades.filter((trade) => trade.status === 'CLOSED');
  const wins = closed.filter((trade) => finite(trade.pnl) && trade.pnl > 0).length;
  const losses = closed.filter((trade) => finite(trade.pnl) && trade.pnl < 0).length;
  const decided = wins + losses;
  const totals = new Map<string, number>();

  trades.forEach((trade) => {
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
    decided,
    winRate: decided > 0 ? Math.round((wins / decided) * 1000) / 10 : undefined,
    pnlByCurrency: [...totals.entries()].sort(([left], [right]) => left.localeCompare(right))
  };
}

function laneMode(status: StatusSnapshot | null, lane: Lane) {
  if (!status) return 'DATI NON DISPONIBILI';
  if (status.tradingMode === 'PAPER' && lane === 'MAIN') return 'PAPER MAIN';
  if (cleanLane(status.liveExecutionVariant) === lane && status.tradingMode !== 'PAPER') {
    return status.tradingMode === 'OANDA_DEMO'
      ? 'OANDA PRACTICE · VERIFIED'
      : 'OANDA LIVE · VERIFIED';
  }
  return 'PAPER SHADOW · NO OANDA ORDER';
}

function scoreText(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? `${Math.max(0, Math.min(100, Math.round(parsed)))}/100` : 'N/A';
}

function resultClass(trade: BotTrade) {
  if (!finite(trade.pnl)) return 'neutral';
  return trade.pnl >= 0 ? 'positive' : 'negative';
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
          <span>{selected ? 'CORSIA SELEZIONATA' : 'CORSIA DI CONFRONTO'}</span>
          <h2>{lane}</h2>
        </div>
        <b>{mode}</b>
      </header>

      <div className="vs-lane-kpis">
        <div><span>Win rate</span><strong>{metrics.winRate === undefined ? 'N/A' : `${metrics.winRate.toFixed(1)}%`}</strong></div>
        <div><span>W / L</span><strong>{metrics.decided ? `${metrics.wins} / ${metrics.losses}` : 'N/A'}</strong></div>
        <div><span>Aperti</span><strong>{metrics.open.length}</strong></div>
        <div><span>Chiusi</span><strong>{metrics.closed.length}</strong></div>
      </div>

      <div className="vs-pnl-block">
        <span>P&amp;L registrato per valuta</span>
        <div>
          {metrics.pnlByCurrency.length > 0
            ? metrics.pnlByCurrency.map(([currency, value]) => (
                <b key={currency} className={value >= 0 ? 'positive' : 'negative'}>
                  {value >= 0 ? '+' : '-'}{Math.abs(value).toFixed(2)} {currency}
                </b>
              ))
            : <b>N/A</b>}
        </div>
        {!selected && <small>Le valute PAPER SHADOW non vengono sommate tra loro.</small>}
      </div>
    </article>
  );
}

function LaneTradeList({ lane, metrics, mode }: { lane: Lane; metrics: LaneMetrics; mode: string }) {
  const trades = metrics.trades.slice(0, 12);
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
              <span>Current/Exit <b>{price(trade.currentPrice, trade.symbol)}</b></span>
              <span>SL <b className="negative">{price(trade.stopLoss, trade.symbol)}</b></span>
              <span>TP <b className="positive">{price(trade.takeProfit, trade.symbol)}</b></span>
            </div>
            <div className="vs-trade-row__result">
              <strong className={resultClass(trade)}>{money(trade)}</strong>
              <span>{trade.closeReason || trade.setupType || 'RISULTATO IN CORSO'}</span>
            </div>
            <footer>
              <span>{trade.source || 'N/A'} · {trade.strategyVariant || lane}</span>
              <span>Signal {trade.signalId ? trade.signalId.slice(-16) : 'N/A'}</span>
              <span>{trade.oandaTradeId ? `OANDA ID ${trade.oandaTradeId}` : 'NO OANDA ORDER'}</span>
            </footer>
          </article>
        )) : (
          <div className="dense-empty">NESSUNA OPERAZIONE {lane} REGISTRATA</div>
        )}
      </div>
    </article>
  );
}

function pairedTrades(main: BotTrade[], inverse: BotTrade[]) {
  const mainBySignal = new Map(main.filter((trade) => trade.signalId).map((trade) => [trade.signalId as string, trade]));
  const inverseBySignal = new Map(inverse.filter((trade) => trade.signalId).map((trade) => [trade.signalId as string, trade]));

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
    )
    .slice(0, 12);
}

function latestPairs(status: StatusSnapshot | null) {
  return Object.values(status?.pairedSignals || {})
    .filter((pair): pair is PairedSignalSnapshot => Boolean(pair))
    .sort((left, right) => Date.parse(right.evaluatedAt) - Date.parse(left.evaluatedAt))
    .slice(0, 10);
}

export function VersusPage({ status }: { status: StatusSnapshot | null }) {
  const selectedLane = cleanLane(status?.liveExecutionVariant);
  const executionLabel = status?.tradingMode === 'PAPER'
    ? 'DISABLED'
    : selectedLane || 'INVALID';
  const mainMetrics = calculateMetrics(laneTrades(status, 'MAIN'));
  const inverseMetrics = calculateMetrics(laneTrades(status, 'INVERSE'));
  const matched = pairedTrades(mainMetrics.trades, inverseMetrics.trades);
  const signals = latestPairs(status);
  const scanSeconds = finite(status?.scanIntervalMs) ? Math.round(status.scanIntervalMs / 1000) : undefined;

  const comparison = mainMetrics.winRate !== undefined && inverseMetrics.winRate !== undefined
    ? mainMetrics.winRate === inverseMetrics.winRate
      ? `Win rate pari: ${mainMetrics.winRate.toFixed(1)}%`
      : mainMetrics.winRate > inverseMetrics.winRate
        ? `MAIN avanti di ${(mainMetrics.winRate - inverseMetrics.winRate).toFixed(1)} punti`
        : `INVERSE avanti di ${(inverseMetrics.winRate - mainMetrics.winRate).toFixed(1)} punti`
    : 'Servono risultati chiusi in entrambe le corsie';

  return (
    <div className="versus-page">
      <section className="cockpit-panel vs-hero">
        <div>
          <p className="vs-eyebrow">MAIN VS INVERSE · STESSO SNAPSHOT OANDA</p>
          <h1>Confronto separato delle operazioni normali e al contrario.</h1>
          <p>
            La corsia selezionata può inviare un solo ordine verificato a OANDA.
            L’altra registra il contrario con prezzi reali come PAPER SHADOW.
          </p>
        </div>
        <div className="vs-hero__state">
          <span>OANDA EXECUTION</span>
          <strong>{executionLabel}</strong>
          <small>{status?.tradingMode || 'MODE N/A'}</small>
        </div>
      </section>

      <section className="vs-profile-strip" aria-label="Profilo operativo">
        <div><span>Scansione</span><strong>{scanSeconds ? `${scanSeconds}s` : 'N/A'}</strong></div>
        <div><span>Setup minimo</span><strong>{status?.minimumConfidence ?? 'N/A'}/100</strong></div>
        <div><span>Nuovi / ciclo</span><strong>{status?.maxNewTradesPerCycle ?? 'N/A'}</strong></div>
        <div><span>Posizioni max</span><strong>{status?.maxOpenPositions ?? 'N/A'}</strong></div>
        <div><span>Trade / simbolo</span><strong>{status?.maxTradesPerSymbol ?? 1}</strong></div>
        <div><span>Tetto giornaliero</span><strong>{status?.maxDailyTrades ?? 'N/A'}</strong></div>
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
          <small>Confronto win rate; P&amp;L mostrato senza mescolare valute.</small>
        </div>
        <LaneScoreCard
          lane="INVERSE"
          metrics={inverseMetrics}
          selected={selectedLane === 'INVERSE'}
          mode={laneMode(status, 'INVERSE')}
        />
      </section>

      <section className="cockpit-panel vs-paired-ledger">
        <header className="cockpit-panel__header">
          <div><span>STESSO SIGNAL ID</span><h2>RISULTATI APPAIATI</h2></div>
          <b>{matched.length} COPPIE VISIBILI</b>
        </header>
        <div className="vs-paired-table">
          <div className="vs-paired-head">
            <span>Segnale</span><span>MAIN</span><span>INVERSE</span><span>Confronto</span>
          </div>
          {matched.length > 0 ? matched.map((row) => {
            const bothClosed = row.main.status === 'CLOSED' && row.inverse.status === 'CLOSED';
            const mainPnl = finite(row.main.pnl) ? row.main.pnl : undefined;
            const inversePnl = finite(row.inverse.pnl) ? row.inverse.pnl : undefined;
            const comparable = bothClosed &&
              mainPnl !== undefined &&
              inversePnl !== undefined &&
              currencyFor(row.main) === currencyFor(row.inverse);
            const verdict = comparable
              ? mainPnl === inversePnl
                ? 'PARI'
                : mainPnl > inversePnl ? 'MAIN' : 'INVERSE'
              : bothClosed ? 'VALUTE DIVERSE' : 'IN CORSO';
            return (
              <article className="vs-paired-row" key={row.signalId}>
                <div>
                  <strong>{row.main.symbol || row.inverse.symbol || 'N/A'}</strong>
                  <span>{localTime(row.main.openedAt || row.inverse.openedAt)}</span>
                  <small>{row.signalId.slice(-16)}</small>
                </div>
                <div>
                  <b className={row.main.side === 'BUY' ? 'positive' : 'negative'}>{row.main.side || 'N/A'}</b>
                  <strong className={resultClass(row.main)}>{money(row.main)}</strong>
                  <span>{row.main.status || 'N/A'}</span>
                </div>
                <div>
                  <b className={row.inverse.side === 'BUY' ? 'positive' : 'negative'}>{row.inverse.side || 'N/A'}</b>
                  <strong className={resultClass(row.inverse)}>{money(row.inverse)}</strong>
                  <span>{row.inverse.status || 'N/A'}</span>
                </div>
                <div><strong>{verdict}</strong><span>{bothClosed ? 'RISULTATO CHIUSO' : 'ATTENDERE CHIUSURA'}</span></div>
              </article>
            );
          }) : <div className="dense-empty">NESSUNA COPPIA CON LO STESSO SIGNAL ID ANCORA DISPONIBILE</div>}
        </div>
      </section>

      <section className="cockpit-panel vs-live-signals">
        <header className="cockpit-panel__header">
          <div><span>16 STRUMENTI · ULTIMO CICLO</span><h2>SEGNALI SPECULARI</h2></div>
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
              <div><strong>{pair.main.selectedForExecution ? pair.main.executionState : pair.inverse.selectedForExecution ? pair.inverse.executionState : 'SHADOW'}</strong><span>{pair.marketValid ? 'OANDA QUOTE VERIFIED' : pair.marketValidationReason || 'QUOTE N/A'}</span></div>
            </article>
          )) : <div className="dense-empty">NESSUN SEGNALE SPECULARE DISPONIBILE</div>}
        </div>
      </section>

      <section className="vs-ledger-grid">
        <LaneTradeList lane="MAIN" metrics={mainMetrics} mode={laneMode(status, 'MAIN')} />
        <LaneTradeList lane="INVERSE" metrics={inverseMetrics} mode={laneMode(status, 'INVERSE')} />
      </section>

      <section className="vs-safety-note">
        <strong>SEPARAZIONE OBBLIGATORIA</strong>
        <span>
          OANDA VERIFIED e PAPER SHADOW non vengono mai sommati nello stesso P&amp;L.
          La corsia shadow non possiede order ID OANDA e non può apparire come ordine reale.
        </span>
      </section>
    </div>
  );
}
