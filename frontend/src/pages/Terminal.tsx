import { BotTrade, OandaStatus, StatusSnapshot } from '../types';
import { executionView, hasFullFreshCoverage, hasVerifiedOandaLedger } from '../trading-state';
import { RealMiniChart, RealSparkline } from '../components/RealMiniChart';
import { Link } from 'react-router-dom';
import { calculateMonetaryOutcomeSummary } from '../../../src/strategy-metrics';

function money(value: number | undefined, currency?: string) {
  if (typeof value !== 'number' || !Number.isFinite(value) || !currency) return 'N/A';
  const sign = value > 0 ? '+' : value < 0 ? '-' : '';
  return `${sign}${Math.abs(value).toFixed(2)} ${currency}`;
}

function pips(value?: number) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'N/A';
  const sign = value >= 0 ? '+' : '-';
  return `${sign}${Math.abs(value).toFixed(1)} pips`;
}

function price(value?: number, symbol?: string) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return 'N/A';
  const normalized = String(symbol || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return value.toFixed(normalized.includes('JPY') || normalized.includes('XAU') ? 3 : 5);
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

function isUtcToday(value?: string) {
  if (!value) return false;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return false;
  const now = new Date();
  return parsed.getUTCFullYear() === now.getUTCFullYear() &&
    parsed.getUTCMonth() === now.getUTCMonth() &&
    parsed.getUTCDate() === now.getUTCDate();
}

function scoreClass(value: number) {
  if (value >= 78) return 'hot';
  if (value >= 68) return 'warm';
  return 'cool';
}

function setupScore(source: { setupScore?: unknown; confidence?: unknown } | null | undefined) {
  const explicit = source?.setupScore;
  const fallback = source?.confidence;
  const value = typeof explicit === 'number' && Number.isFinite(explicit)
    ? explicit
    : typeof fallback === 'number' && Number.isFinite(fallback)
      ? fallback
      : undefined;
  return value === undefined ? undefined : Math.max(0, Math.min(100, Math.round(value)));
}

function setupScoreText(source: { setupScore?: unknown; confidence?: unknown } | null | undefined) {
  const score = setupScore(source);
  return score === undefined ? 'N/A' : `${score}/100`;
}

function sourceLabel(status: StatusSnapshot | null, oandaStatus?: OandaStatus) {
  if (!status) return 'DATA UNAVAILABLE';
  if (oandaStatus?.connected !== true) {
    return oandaStatus?.reason === 'checking' || oandaStatus?.reason === 'status_request_failed'
      ? 'OANDA STATUS UNAVAILABLE'
      : 'OANDA DISCONNECTED';
  }
  if (hasFullFreshCoverage(status) && fresh(status.lastPriceAt)) return 'OANDA 1S FULL COVERAGE';
  if (status.priceFeedStatus === 'PARTIAL') return 'OANDA FEED PARTIAL';
  return 'OANDA FEED STALE / UNAVAILABLE';
}

function textValue(value: unknown) {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return undefined;
}

function resolvedTradeMode(trade: BotTrade) {
  const explicit = textValue(trade.executionMode ?? trade.mode);
  if (explicit) return explicit;
  if (trade.source === 'PAPER' || trade.id?.startsWith('PAPER-')) return 'PAPER';
  if (trade.source === 'OANDA' && trade.verificationStatus === 'VERIFIED') return 'OANDA VERIFIED';
  if (trade.source === 'LOCAL_ORPHAN' || trade.verificationStatus === 'NOT_VERIFIED') return 'LOCAL ORPHAN / NOT VERIFIED';
  return undefined;
}

function isPaperMode(mode?: string) {
  return String(mode || '').toUpperCase().includes('PAPER');
}

function TradeFeedCard({
  trade,
  dataSource
}: {
  trade: BotTrade;
  dataSource?: string;
}) {
  const isBuy = trade.side === 'BUY';
  const isOpen = trade.status === 'OPEN';
  const score = setupScore(trade);
  const units = textValue(trade.units ?? trade.initialUnits ?? trade.currentUnits);
  const orderId = textValue(trade.oandaOrderId ?? trade.oandaOrderID ?? trade.orderId ?? trade.orderID);
  const oandaTradeId = textValue(trade.oandaTradeId ?? trade.oandaTradeID ?? trade.tradeId ?? trade.tradeID);
  const source = textValue(trade.source ?? trade.dataSource ?? dataSource) || 'N/A';
  const mode = resolvedTradeMode(trade) || 'N/A';
  const paperTrade = isPaperMode(mode);
  const pnlCurrency = paperTrade ? textValue(trade.pnlCurrency) : textValue(trade.accountCurrency);
  const verifiedOandaTrade = trade.source === 'OANDA' && trade.verificationStatus === 'VERIFIED';
  const formattedPnl = paperTrade || verifiedOandaTrade ? money(trade.pnl, pnlCurrency) : 'N/A';
  const meta = [
    trade.openedAt ? time(trade.openedAt) : undefined,
    units ? `Units ${units}` : undefined,
    typeof trade.entryPrice === 'number' ? `Entry ${price(trade.entryPrice, trade.symbol)}` : undefined,
    typeof trade.currentPrice === 'number' ? `Current ${price(trade.currentPrice, trade.symbol)}` : undefined
  ].filter(Boolean);
  const riskItems = [
    typeof trade.stopLoss === 'number' ? `SL ${price(trade.stopLoss, trade.symbol)}` : undefined,
    typeof trade.takeProfit === 'number' ? `TP ${price(trade.takeProfit, trade.symbol)}` : undefined,
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
        {score !== undefined && (
          <div className="confidence-row">
            <div className="confidence-track">
              <div className={`confidence-fill ${scoreClass(score)}`} style={{ width: `${score}%` }} />
            </div>
            <span>SETUP SCORE {score}/100</span>
          </div>
        )}
      </div>
    </article>
  );
}

function MetricTile({
  label,
  value,
  detail,
  tone = 'blue',
  spark = []
}: {
  label: string;
  value: string | number;
  detail: string;
  tone?: 'green' | 'red' | 'blue' | 'amber' | 'purple';
  spark?: number[];
}) {
  return (
    <article className={`command-metric ${tone}`}>
      <div className="command-metric__copy">
        <span>{label}</span>
        <strong>{value}</strong>
        <small>{detail}</small>
      </div>
      <RealSparkline values={spark} tone={tone} />
    </article>
  );
}

function CompactTradeRow({ trade }: { trade: BotTrade }) {
  const currency = trade.source === 'OANDA' ? trade.accountCurrency : trade.pnlCurrency;
  return (
    <div className="compact-trade-row">
      <time>{time(trade.closedAt || trade.openedAt)}</time>
      <b className={trade.side === 'BUY' ? 'positive' : trade.side === 'SELL' ? 'negative' : 'neutral'}>{trade.side || 'N/A'}</b>
      <strong>{trade.symbol || 'N/A'}</strong>
      <span>{price(trade.currentPrice ?? trade.entryPrice, trade.symbol)}</span>
      <em className={typeof trade.pnl === 'number' ? trade.pnl >= 0 ? 'positive' : 'negative' : 'neutral'}>{money(trade.pnl, currency)}</em>
    </div>
  );
}

function SignalLaneCard({ lane, title, symbol }: { lane: any; title: string; symbol: string }) {
  if (!lane) return <div className="signal-duel-card unavailable"><span>{title}</span><strong>N/A</strong><small>NESSUN SNAPSHOT REALE</small></div>;
  const directionClass = lane.action === 'BUY' ? 'positive' : lane.action === 'SELL' ? 'negative' : 'neutral';
  return (
    <article className={`signal-duel-card ${lane.action === 'BUY' ? 'buy' : lane.action === 'SELL' ? 'sell' : 'hold'}`}>
      <header><span>{title}</span><strong className={directionClass}>{lane.action || 'N/A'}</strong></header>
      <div className="signal-duel-card__confidence">
        <b>{setupScoreText(lane)}</b>
        <span>SETUP SCORE</span>
      </div>
      <dl>
        <div><dt>Entry</dt><dd>{price(lane.entryPrice, symbol)}</dd></div>
        <div><dt>SL</dt><dd>{price(lane.stopLossPrice, symbol)}</dd></div>
        <div><dt>TP</dt><dd>{price(lane.takeProfitPrice, symbol)}</dd></div>
        <div><dt>Setup</dt><dd>{lane.setupType || 'N/A'}</dd></div>
        <div><dt>State</dt><dd>{lane.executionState || 'N/A'}</dd></div>
      </dl>
      <p>{lane.reasoning || 'DATI NON DISPONIBILI'}</p>
    </article>
  );
}

export function TerminalPage({ status, marketData, news = [], oandaStatus }: { status: StatusSnapshot | null; marketData: Record<string, any>; news?: any[]; oandaStatus?: OandaStatus; }) {
  const mode = executionView(status);
  const oandaLedgerAvailable = hasVerifiedOandaLedger(status);
  const ledgerAvailable = mode.paper || oandaLedgerAvailable;
  const activeVariant = status?.liveExecutionVariant === 'MAIN' || status?.liveExecutionVariant === 'INVERSE'
    ? status.liveExecutionVariant
    : undefined;
  const activeLaneLabel = activeVariant === 'INVERSE' ? 'MIRROR' : activeVariant || 'CURRENT MODE';
  const orphanIds = new Set((status?.orphanTrades || []).map((trade) => trade.id));
  const eligible = (trade: BotTrade) => {
    if (orphanIds.has(trade.id) || trade.source === 'LOCAL_ORPHAN' || trade.verificationStatus === 'NOT_VERIFIED') return false;
    if (mode.paper) return trade.source === 'PAPER';
    return oandaLedgerAvailable && trade.source === 'OANDA' && trade.verificationStatus === 'VERIFIED';
  };
  const belongsToActiveLane = (trade: BotTrade) => !mode.oanda || !activeVariant || trade.strategyVariant === activeVariant;
  const accountOpenTrades = ledgerAvailable ? (status?.openTrades || []).filter(eligible) : [];
  const openTrades = accountOpenTrades.filter(belongsToActiveLane);
  const closedTrades = ledgerAvailable
    ? (status?.closedTrades || []).filter(eligible).filter(belongsToActiveLane)
    : [];
  const feed = [
    ...openTrades,
    ...closedTrades.slice(0, Math.max(0, 20 - openTrades.length))
  ];
  const todayTrades = [
    ...openTrades.filter((trade) => isUtcToday(trade.openedAt)),
    ...closedTrades.filter((trade) => isUtcToday(trade.closedAt))
  ];
  const pnlValues = todayTrades
    .map((trade) => trade.pnl)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  const pnlCurrencies = new Set(todayTrades.map((trade) => textValue(trade.accountCurrency)).filter((value): value is string => Boolean(value)));
  const pnlComplete = todayTrades.length > 0 && pnlValues.length === todayTrades.length && pnlCurrencies.size === 1;
  const pnlCurrency = pnlCurrencies.size === 1 ? [...pnlCurrencies][0] : undefined;
  const pnlToday = mode.oanda && oandaLedgerAvailable && pnlComplete
    ? pnlValues.reduce((sum, value) => sum + value, 0)
    : undefined;
  const closedPnl = closedTrades
    .map((trade) => trade.pnl)
    .filter((value): value is number => typeof value === 'number' && Number.isFinite(value));
  const outcome = calculateMonetaryOutcomeSummary(closedTrades);
  const closedPnlComparable = outcome.comparable;
  const wins = outcome.wins;
  const losses = outcome.losses;
  const decidedTrades = wins + losses;
  const winRate = outcome.winRate === undefined ? undefined : Math.round(outcome.winRate * 10) / 10;
  const lossRate = outcome.lossRate === undefined ? undefined : Math.round(outcome.lossRate * 10) / 10;
  const configuredSymbols = status?.symbols || [];
  const marketSymbols = [
    ...configuredSymbols,
    ...Object.keys(marketData || {}).filter((symbol) => !configuredSymbols.includes(symbol))
  ];
  const marketRows = marketSymbols.map((symbol) => [symbol, marketData?.[symbol]] as const);
  const dailyRisk = status?.dailyRiskStatus;
  const displayMode = !mode.known
    ? 'MODE UNAVAILABLE'
    : mode.paper
      ? 'PAPER'
      : mode.ready && oandaLedgerAvailable
        ? mode.label
        : mode.demo ? 'OANDA DEMO BLOCKED' : 'OANDA LIVE BLOCKED';
  const dailyCountAvailable = Boolean(
    status &&
    ledgerAvailable &&
    (mode.paper || status.reconciliationStatus === 'VERIFIED') &&
    typeof dailyRisk?.tradeCount === 'number' &&
    Number.isFinite(dailyRisk?.tradeCount)
  );
  const primarySymbol = String(status?.latestPairedSignal?.symbol || status?.currentSymbol || configuredSymbols[0] || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const primaryPair = primarySymbol ? status?.pairedSignals?.[primarySymbol] : undefined;
  const primaryMarket = primarySymbol ? status?.marketData?.[primarySymbol] || marketData?.[primarySymbol] : undefined;
  const primaryQuote = primarySymbol ? status?.livePrices?.[primarySymbol] : undefined;
  const cumulativePnl = closedPnlComparable
    ? [...closedPnl].reverse().slice(-24).reduce<number[]>((series, value) => {
        series.push((series[series.length - 1] || 0) + value);
        return series;
      }, [])
    : [];
  const outcomeSeries = [...closedPnl].reverse().slice(-24).reduce<number[]>((series, value) => {
    series.push((series[series.length - 1] || 0) + (value > 0 ? 1 : value < 0 ? -1 : 0));
    return series;
  }, []);
  const setupDistribution = [...openTrades, ...closedTrades].reduce<Record<string, number>>((distribution, trade) => {
    const key = trade.setupType || 'SETUP N/A';
    distribution[key] = (distribution[key] || 0) + 1;
    return distribution;
  }, {});
  const setupEntries = Object.entries(setupDistribution).sort((left, right) => right[1] - left[1]).slice(0, 5);
  const setupMaximum = Math.max(...setupEntries.map(([, count]) => count), 1);
  const xauSymbol = 'XAUUSD';
  const xauMarket = status?.marketData?.[xauSymbol] || marketData?.[xauSymbol];
  const xauQuote = status?.livePrices?.[xauSymbol];
  const xauPair = status?.pairedSignals?.[xauSymbol];
  const xauPrice = xauQuote?.mid ?? xauMarket?.closePrice;
  const openPositionValue = ledgerAvailable ? accountOpenTrades.length : 'N/A';
  const openUnitValues = accountOpenTrades.map((trade) => Number(trade.units)).filter((value) => Number.isFinite(value));
  const openUnits = ledgerAvailable && accountOpenTrades.length > 0 && openUnitValues.length === accountOpenTrades.length
    ? openUnitValues.reduce((sum, value) => sum + value, 0)
    : undefined;
  const otherLaneOpenPositions = Math.max(0, accountOpenTrades.length - openTrades.length);
  const recentFeed = feed.slice(0, 9);
  const recentHistory = closedTrades.slice(0, 7);
  const mirrorSelected = status?.liveExecutionVariant === 'INVERSE' && status?.tradingMode !== 'PAPER';
  const mainLaneTitle = mirrorSelected ? 'MAIN · PAPER SHADOW' : 'MAIN · OPERATIVA';
  const mirrorLaneTitle = mirrorSelected ? 'MIRROR · OPERATIVA' : 'MIRROR · PAPER SHADOW';

  return (
    <div className="dashboard-page">
      <section className="dashboard-kpis" aria-label="Metriche verificate">
        <MetricTile
          label="P&L OGGI"
          value={money(pnlToday, pnlCurrency)}
          detail={mode.paper ? 'Aggregato PAPER non convertito' : oandaLedgerAvailable ? `${activeLaneLabel} · ${status?.dailyLossLimitEnabled === false ? 'NESSUN LIMITE PERDITA · ' : ''}UTC ${dailyRisk?.dateUTC || 'N/A'}` : 'Riconciliazione OANDA richiesta'}
          tone={typeof pnlToday === 'number' && pnlToday < 0 ? 'red' : 'green'}
          spark={cumulativePnl}
        />
        <MetricTile
          label="WIN RATE"
          value={winRate === undefined ? 'N/A' : `${winRate.toFixed(1)}%`}
          detail={decidedTrades > 0 ? `${wins}W · ${losses}L · ${decidedTrades} decisi` : 'Nessun esito verificabile'}
          tone="purple"
          spark={outcomeSeries}
        />
        <MetricTile
          label="TRADE OGGI"
          value={dailyCountAvailable ? dailyRisk?.tradeCount ?? 'N/A' : 'N/A'}
          detail={dailyCountAvailable ? `${status?.dailyRemainingTrades ?? dailyRisk?.remainingTrades ?? 'N/A'} rimasti · ${status?.entryGateStatus || 'GATE N/A'} · limite ${dailyRisk?.maxTrades} UTC` : dailyRisk?.reason || 'Dati giornalieri non completi'}
          tone="amber"
        />
        <MetricTile
          label="POSIZIONI APERTE"
          value={openPositionValue}
          detail={ledgerAvailable
            ? accountOpenTrades.length === 0
              ? 'Nessuna posizione corrente'
              : `${openTrades.length} ${activeLaneLabel}${otherLaneOpenPositions ? ` · ${otherLaneOpenPositions} altra corsia` : ''}${openUnits === undefined ? ' · units N/A' : ` · ${openUnits} units totali`}`
            : 'Ledger non verificato'}
          tone="green"
        />
        <MetricTile
          label="MARKET FEED"
          value={status ? status.priceFeedStatus || 'N/A' : 'N/A'}
          detail={`${status?.priceCoverage ?? 'N/A'} / ${status?.priceExpected ?? 'N/A'} · ${sourceLabel(status, oandaStatus)}`}
          tone={hasFullFreshCoverage(status) ? 'blue' : 'red'}
        />
      </section>

      <section className="dashboard-primary-grid">
        <article className="cockpit-panel dashboard-market-card">
          <header className="cockpit-panel__header">
            <div>
              <span>REAL OANDA MARKET</span>
              <h2>{primarySymbol || 'STRUMENTO N/A'}</h2>
            </div>
            <div className="panel-header-tags">
              <b>{primaryMarket?.timeframe || 'M5'}</b>
              <b className={fresh(primaryQuote?.time) ? 'positive' : 'neutral'}>{fresh(primaryQuote?.time) ? 'TICK FRESH' : 'TICK N/A'}</b>
            </div>
          </header>
          <RealMiniChart symbol={primarySymbol} timeframe={primaryMarket?.timeframe || 'M5'} />
          <footer className="market-proof-strip">
            <div><span>Trend</span><strong>{primaryMarket?.trend || 'N/A'}</strong></div>
            <div><span>Structure</span><strong>{primaryMarket?.structureBias || 'N/A'}</strong></div>
            <div><span>RSI</span><strong>{typeof primaryMarket?.rsi === 'number' ? primaryMarket.rsi.toFixed(1) : 'N/A'}</strong></div>
            <div><span>BOS</span><strong>{primaryMarket?.breakOfStructure || 'N/A'}</strong></div>
            <div><span>CHoCH</span><strong>{primaryMarket?.changeOfCharacter || 'N/A'}</strong></div>
          </footer>
        </article>

        <section className="signal-duel cockpit-panel">
          <header className="cockpit-panel__header">
            <div><span>{mirrorSelected ? 'MIRROR OPERATIVA · BUY→SELL · SELL→BUY · TP +0,20 · SL -0,60 CHF' : 'MAIN OPERATIVA · DIREZIONE NORMALE INVARIATA · TP +0,20 · SL -0,60 CHF'}</span><h2>MAIN / MIRROR</h2></div>
            <div className="panel-header-tags">
              <b>{primaryPair?.pairId ? primaryPair.pairId.slice(-12) : 'PAIR N/A'}</b>
              <Link to="/vs">APRI VS</Link>
            </div>
          </header>
          <div className="signal-duel__body">
            <SignalLaneCard lane={primaryPair?.main} title={mainLaneTitle} symbol={primarySymbol} />
            <div className="signal-versus">VS</div>
            <SignalLaneCard lane={primaryPair?.inverse} title={mirrorLaneTitle} symbol={primarySymbol} />
          </div>
          <footer className="signal-proof">
            <span>{primaryPair?.marketValid ? 'REAL QUOTE CAPTURED' : primaryPair?.marketValidationReason || 'SNAPSHOT N/A'}</span>
            <strong>{displayMode}</strong>
          </footer>
        </section>

        <article className="cockpit-panel dashboard-feed-card">
          <header className="cockpit-panel__header">
            <div><span>{mode.paper ? 'PAPER LEDGER' : oandaLedgerAvailable ? `OANDA VERIFIED · ${activeLaneLabel} ONLY` : 'LEDGER UNAVAILABLE'}</span><h2>TRADE FEED</h2></div>
            <Link to="/history">VEDI TUTTO</Link>
          </header>
          <div className="compact-trade-list">
            {recentFeed.length > 0
              ? recentFeed.map((trade) => <CompactTradeRow key={trade.id} trade={trade} />)
              : <div className="dense-empty">{ledgerAvailable ? 'NESSUN TRADE REGISTRATO' : 'LEDGER NON VERIFICATO'}</div>}
          </div>
          <footer className="feed-summary">
            <span>{closedTrades.length} chiusi</span>
            <span>{winRate === undefined ? 'Win rate N/A' : `${winRate.toFixed(1)}% win rate`}</span>
            <strong>{money(pnlToday, pnlCurrency)}</strong>
          </footer>
        </article>
      </section>

      <section className="dashboard-secondary-grid">
        <article className="cockpit-panel dashboard-history-card">
          <header className="cockpit-panel__header">
            <div><span>LEDGER CURRENT MODE · {activeLaneLabel}</span><h2>TRADE HISTORY</h2></div>
            <b>{displayMode}</b>
          </header>
          <div className="dense-table-scroll">
            <table className="dense-table">
              <thead><tr><th>Ora</th><th>Pair</th><th>Side</th><th>Entry</th><th>Exit / Current</th><th>Result</th><th>Setup</th><th>ID</th></tr></thead>
              <tbody>
                {recentHistory.map((trade) => (
                  <tr key={trade.id}>
                    <td>{time(trade.closedAt || trade.openedAt)}</td>
                    <td><strong>{trade.symbol}</strong></td>
                    <td className={trade.side === 'BUY' ? 'positive' : 'negative'}>{trade.side}</td>
                    <td>{price(trade.entryPrice, trade.symbol)}</td>
                    <td>{price(trade.currentPrice, trade.symbol)}</td>
                    <td className={typeof trade.pnl === 'number' ? trade.pnl >= 0 ? 'positive' : 'negative' : 'neutral'}>{money(trade.pnl, trade.source === 'OANDA' ? trade.accountCurrency : trade.pnlCurrency)}</td>
                    <td>{trade.setupType || 'N/A'}</td>
                    <td>{trade.oandaTradeId || trade.signalId || 'N/A'}</td>
                  </tr>
                ))}
                {recentHistory.length === 0 && <tr><td colSpan={8}>{ledgerAvailable ? 'NESSUN TRADE CHIUSO' : 'DATI NON DISPONIBILI'}</td></tr>}
              </tbody>
            </table>
          </div>
        </article>

        <article className="cockpit-panel dashboard-analytics-card">
          <header className="cockpit-panel__header">
            <div><span>RISULTATI VERIFICATI OANDA · {activeLaneLabel} ONLY</span><h2>BILANCIO {activeLaneLabel} · {outcome.sampleSize || 'N/A'} TRADE</h2></div>
            <Link to="/analytics">DETTAGLI</Link>
          </header>
          <div className="outcome-scoreboard">
            <div className="outcome-count-grid" aria-label="Conteggio operazioni vinte e perse">
              <div className="win">
                <span>OPERAZIONI VINTE</span>
                <strong>{decidedTrades ? wins : 'N/A'}</strong>
                <small>{winRate === undefined ? 'Percentuale N/A' : `${winRate.toFixed(1)}% del campione`}</small>
              </div>
              <div className="loss">
                <span>OPERAZIONI PERSE</span>
                <strong>{decidedTrades ? losses : 'N/A'}</strong>
                <small>{lossRate === undefined ? 'Percentuale N/A' : `${lossRate.toFixed(1)}% del campione`}</small>
              </div>
            </div>
            <div className="outcome-rate-track" aria-label={decidedTrades ? `${winRate}% vinte e ${lossRate}% perse` : 'Percentuali non disponibili'}>
              <i className="win" style={{ width: `${winRate || 0}%` }} />
              <i className="loss" style={{ width: `${lossRate || 0}%` }} />
            </div>
            <div className="outcome-money-grid" aria-label="Somme monetarie reali">
              <div>
                <span>GUADAGNI LORDI</span>
                <strong className="positive">{money(outcome.grossProfit, outcome.currency)}</strong>
                <small>Somma delle {wins} vincite</small>
              </div>
              <div>
                <span>PERDITE LORDE</span>
                <strong className="negative">{money(outcome.grossLoss, outcome.currency)}</strong>
                <small>Somma delle {losses} perdite</small>
              </div>
              <div className="net">
                <span>RISULTATO NETTO</span>
                <strong className={typeof outcome.netPnl === 'number' ? outcome.netPnl >= 0 ? 'positive' : 'negative' : 'neutral'}>
                  {money(outcome.netPnl, outcome.currency)}
                </strong>
                <small>Vincite + perdite</small>
              </div>
            </div>
            <p className="outcome-proof">
              {outcome.comparable
                ? `VALUTA REALE CONTO OANDA: ${outcome.currency} · solo corsia ${activeLaneLabel}; storico dell'altra corsia escluso.`
                : outcome.sampleSize > 0
                  ? 'P&L MONETARIO NON SOMMABILE: valuta o importi incompleti.'
                  : 'NESSUN TRADE CHIUSO VERIFICABILE.'}
            </p>
            {setupEntries.length > 0 && (
              <details className="outcome-setup-details">
                <summary>DISTRIBUZIONE PER SETUP</summary>
                <div className="setup-distribution">
                  {setupEntries.map(([name, count], index) => (
                    <div key={name}>
                      <div><span>{name}</span><strong>{count}</strong></div>
                      <i><b style={{ width: `${(count / setupMaximum) * 100}%` }} data-tone={index % 5} /></i>
                    </div>
                  ))}
                </div>
              </details>
            )}
          </div>
          <div className="analytics-mini-summary">
            <div><span>VINTE</span><strong className="positive">{decidedTrades ? `${wins} · ${winRate?.toFixed(1)}%` : 'N/A'}</strong></div>
            <div><span>PERSE</span><strong className="negative">{decidedTrades ? `${losses} · ${lossRate?.toFixed(1)}%` : 'N/A'}</strong></div>
            <div><span>TOTALE CHIUSE</span><strong>{outcome.sampleSize || 'N/A'}</strong></div>
          </div>
        </article>

        <article className="cockpit-panel dashboard-xau-card">
          <header className="cockpit-panel__header">
            <div><span>XAUUSD DEDICATED</span><h2>STRUCTURE SETUP</h2></div>
            <Link to="/xauusd">APRI</Link>
          </header>
          <div className="xau-price-line">
            <strong>{price(xauPrice, xauSymbol)}</strong>
            <span>ANALYSIS ONLY</span>
          </div>
          <dl className="xau-fact-grid">
            <div><dt>Direction</dt><dd>{xauPair?.main?.action || 'N/A'}</dd></div>
            <div><dt>Setup score</dt><dd>{setupScoreText(xauPair?.main)}</dd></div>
            <div><dt>Structure</dt><dd>{xauMarket?.structureBias || 'N/A'}</dd></div>
            <div><dt>Trend</dt><dd>{xauMarket?.trend || 'N/A'}</dd></div>
            <div><dt>Swing high</dt><dd>{price(xauMarket?.swingHigh, xauSymbol)}</dd></div>
            <div><dt>Swing low</dt><dd>{price(xauMarket?.swingLow, xauSymbol)}</dd></div>
          </dl>
          <div className="xau-level-stack">
            <span>Resistance: {xauMarket?.resistanceLevels?.length ? xauMarket.resistanceLevels.slice(0, 3).map((value: number) => price(value, xauSymbol)).join(' · ') : 'N/A'}</span>
            <span>Support: {xauMarket?.supportLevels?.length ? xauMarket.supportLevels.slice(0, 3).map((value: number) => price(value, xauSymbol)).join(' · ') : 'N/A'}</span>
          </div>
        </article>
      </section>

      <section className="dashboard-event-strip">
        <div><span>DECISION</span><strong>{status?.currentSymbol || 'N/A'} · {status?.currentAction || 'N/A'} · SETUP SCORE {setupScoreText({ confidence: status?.currentConfidence })}</strong></div>
        <div><span>SESSION</span><strong>{status?.session || 'N/A'} · {status?.killzone ? 'KILLZONE' : 'STANDARD'}</strong></div>
        <div><span>CALENDAR</span><strong>{news.length ? `${news.length} REAL EVENTS` : 'NOT CONFIGURED'}</strong></div>
        <div><span>LAST EVENT</span><strong>{status?.logs?.length ? status.logs[status.logs.length - 1] : 'N/A'}</strong></div>
      </section>
    </div>
  );
}
