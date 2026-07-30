import { Link } from 'react-router-dom';
import { RealMiniChart } from '../components/RealMiniChart';
import { BotTrade, OandaStatus, SignalLaneSnapshot, StatusSnapshot, XauSignalRecord } from '../types';
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
  const sign = parsed > 0 ? '+' : '';
  return `${sign}${parsed.toFixed(2)} ${currency}`;
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
  return Number.isNaN(parsed.getTime()) ? 'N/A' : parsed.toLocaleTimeString();
}

function directionClass(action?: string) {
  return action === 'BUY' ? 'positive' : action === 'SELL' ? 'negative' : 'neutral';
}

function rValue(value: unknown, live = false) {
  const parsed = numeric(value);
  if (parsed === undefined) return 'N/A';
  return `${parsed > 0 ? '+' : ''}${parsed.toFixed(2)}R${live ? ' LIVE' : ''}`;
}

function XauSetupResult({ signal }: { signal: XauSignalRecord }) {
  const result = signal.closedAt ? signal.resultR : signal.liveR;
  return (
    <div className="xau-setup-result">
      <time>{time(signal.openedAt)}</time>
      <b className={directionClass(signal.side)}>{signal.side}</b>
      <span>{signal.status.replace(/_/g, ' ')}</span>
      <span>{price(signal.entryPrice, 'XAUUSD')}</span>
      <strong className={result > 0 ? 'positive' : result < 0 ? 'negative' : 'neutral'}>{rValue(result, !signal.closedAt)}</strong>
      <em>{signal.ai.provider} {signal.ai.status}</em>
    </div>
  );
}

function LaneCard({ title, lane, symbol }: { title: string; lane?: SignalLaneSnapshot; symbol: string }) {
  const targets = lane?.structuralTargets || [];
  const laneScore = score(lane);
  return (
    <article className={`elite-lane ${lane?.action === 'BUY' ? 'buy' : lane?.action === 'SELL' ? 'sell' : 'hold'}`}>
      <header>
        <div><span>{title}</span><strong className={directionClass(lane?.action)}>{lane?.action || 'N/A'}</strong></div>
        <b>{laneScore === undefined ? 'N/A' : `${laneScore}/100`}</b>
      </header>
      <div className="elite-level-grid">
        <div><span>ENTRY</span><strong>{price(lane?.entryPrice, symbol)}</strong></div>
        <div><span>STOP LOSS</span><strong className="negative">{price(lane?.stopLossPrice, symbol)}</strong></div>
        <div><span>TP1</span><strong className="positive">{price(targets[0] ?? lane?.takeProfitPrice, symbol)}</strong></div>
        <div><span>TP2</span><strong className="positive">{price(targets[1], symbol)}</strong></div>
        <div><span>TP3</span><strong className="positive">{price(targets[2], symbol)}</strong></div>
        <div><span>R:R</span><strong>{numeric(lane?.riskRewardRatio) === undefined ? 'N/A' : `1:${Number(lane?.riskRewardRatio).toFixed(2)}`}</strong></div>
      </div>
      <div className="elite-lane-meta">
        <span>{lane?.setupType || 'SETUP N/A'}</span>
        <span>{lane?.executionState || 'STATE N/A'}</span>
        <span>{lane?.mode || 'MODE N/A'}</span>
      </div>
      <p>{lane?.reasoning || 'Nessuno snapshot reale disponibile.'}</p>
    </article>
  );
}

function Metric({ label, value, detail, tone = 'blue' }: { label: string; value: string | number; detail: string; tone?: string }) {
  return (
    <article className={`elite-metric ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
      <i />
    </article>
  );
}

function TradeRow({ trade }: { trade: BotTrade }) {
  const currency = trade.accountCurrency || trade.pnlCurrency;
  return (
    <div className="elite-trade-row">
      <time>{time(trade.openedAt || trade.closedAt)}</time>
      <b className={directionClass(trade.side)}>{trade.side || 'N/A'}</b>
      <strong>{trade.symbol || 'N/A'}</strong>
      <span>{price(trade.currentPrice ?? trade.entryPrice, trade.symbol)}</span>
      <em className={numeric(trade.pnl) === undefined ? 'neutral' : Number(trade.pnl) >= 0 ? 'positive' : 'negative'}>{money(trade.pnl, currency)}</em>
    </div>
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
  const symbols = status?.symbols?.map(cleanSymbol) || [];
  const primarySymbol = cleanSymbol(status?.latestPairedSignal?.symbol || status?.currentSymbol || symbols.find((item) => item !== 'XAUUSD') || symbols[0]);
  const primaryPair = status?.pairedSignals?.[primarySymbol];
  const primaryMarket = status?.marketData?.[primarySymbol] || marketData?.[primarySymbol];
  const primaryQuote = status?.livePrices?.[primarySymbol];
  const accountCurrency = status?.accountCurrency || oandaStatus.currency;
  const feedAge = ageSeconds(status?.lastPriceAt);
  const feedLive = status?.priceFeedStatus !== 'DISCONNECTED' && typeof status?.priceCoverage === 'number' && status.priceCoverage > 0 && feedAge !== undefined && feedAge <= 30;
  const executionReady = status?.effectiveExecutionState === 'OANDA_DEMO_READY' || status?.effectiveExecutionState === 'OANDA_LIVE_READY';
  const modeLabel = status?.effectiveExecutionState || status?.tradingMode || 'N/A';
  const openTrades = (status?.openTrades || []).filter((trade) => trade.status === 'OPEN');
  const closedTrades = status?.closedTrades || [];
  const decided = closedTrades.filter((trade) => numeric(trade.pnl) !== undefined && Number(trade.pnl) !== 0);
  const wins = decided.filter((trade) => Number(trade.pnl) > 0).length;
  const winRate = decided.length ? Math.round((wins / decided.length) * 1000) / 10 : undefined;
  const recentTrades = [...openTrades, ...closedTrades].slice(0, 8);
  const dailyRisk = status?.dailyRiskStatus;
  const scannerRows = symbols.slice(0, 9).map((symbol) => ({
    symbol,
    market: status?.marketData?.[symbol] || marketData?.[symbol],
    signal: status?.pairedSignals?.[symbol]?.main,
    quote: status?.livePrices?.[symbol]
  }));
  const xau = status?.marketData?.XAUUSD || marketData?.XAUUSD;
  const xauPair = status?.pairedSignals?.XAUUSD;
  const xauQuote = status?.livePrices?.XAUUSD;
  const xauLab = status?.xauSignalLab;
  const xauCandidate = xauLab?.latestCandidate;

  return (
    <div className="elite-command-center">
      <section className="elite-topbar">
        <div className="elite-brand"><b>⚡</b><strong>SCALP.BOT</strong><span>REAL-MARKET COMMAND CENTER</span></div>
        <div className="elite-system-strip">
          <div><span>SCANNER</span><strong className={status?.isRunning ? 'positive' : 'negative'}>{status?.isRunning ? 'ONLINE' : 'STOPPED'}</strong></div>
          <div><span>OANDA</span><strong className={oandaStatus.connected ? 'positive' : 'negative'}>{oandaStatus.connected ? 'CONNECTED' : 'DISCONNECTED'}</strong></div>
          <div><span>MODE</span><strong className={executionReady ? 'positive' : 'warning-text'}>{modeLabel}</strong></div>
          <div><span>FEED</span><strong className={feedLive ? 'positive' : 'negative'}>{feedLive ? 'LIVE' : status?.priceFeedStatus || 'N/A'}</strong></div>
          <div><span>AGE</span><strong>{feedAge === undefined ? 'N/A' : `${feedAge}s`}</strong></div>
          <div><span>ORDERS</span><strong className={executionReady ? 'positive' : 'warning-text'}>{executionReady ? 'ENABLED' : 'BLOCKED'}</strong></div>
        </div>
      </section>

      <section className="elite-metrics">
        <Metric label="P&L TODAY" value={dailyRisk?.complete ? money(dailyRisk.pnl, dailyRisk.currency || accountCurrency) : 'N/A'} detail={dailyRisk?.complete ? `UTC ${dailyRisk.dateUTC}` : dailyRisk?.reason || 'Ledger non verificato'} tone="green" />
        <Metric label="WIN RATE" value={winRate === undefined ? 'N/A' : `${winRate.toFixed(1)}%`} detail={decided.length ? `${wins}W · ${decided.length - wins}L` : 'Nessun trade chiuso verificato'} tone="purple" />
        <Metric label="TRADES TODAY" value={dailyRisk?.tradeCount ?? status?.dailyTradeCount ?? 'N/A'} detail={`Limite ${dailyRisk?.maxTrades ?? status?.maxDailyTrades ?? 1000}`} tone="amber" />
        <Metric label="OPEN POSITIONS" value={openTrades.length} detail={`${status?.maxOpenPositions ?? 15} massime · ${accountCurrency || 'currency N/A'}`} tone="green" />
      </section>

      <section className="elite-workspace">
        <aside className="elite-scanner elite-panel">
          <header><div><span>MARKET SCANNER</span><h2>INSTRUMENTS</h2></div><b>{status?.priceCoverage ?? 0}/{status?.priceExpected ?? symbols.length}</b></header>
          <div className="elite-scanner-list">
            {scannerRows.map(({ symbol, market, signal, quote }) => (
              <div key={symbol}>
                <strong>{symbol}</strong>
                <span className={directionClass(signal?.action)}>{signal?.action || 'HOLD'}</span>
                <span>{score(signal) === undefined ? 'N/A' : `${score(signal)}%`}</span>
                <em>{price(quote?.mid ?? market?.closePrice, symbol)}</em>
              </div>
            ))}
            {!scannerRows.length && <p className="elite-empty">DATI NON DISPONIBILI</p>}
          </div>
          <div className="elite-open-box">
            <span>POSITIONS OPEN</span>
            {openTrades.slice(0, 5).map((trade) => <TradeRow key={trade.id} trade={trade} />)}
            {!openTrades.length && <p className="elite-empty">NESSUNA POSIZIONE OANDA APERTA</p>}
          </div>
        </aside>

        <main className="elite-chart elite-panel">
          <header>
            <div><span>REAL OANDA CHART</span><h2>{primarySymbol || 'SYMBOL N/A'}</h2></div>
            <div className="elite-chart-tags"><b>M5</b><b>{primaryMarket?.trend || 'TREND N/A'}</b><b>{primaryMarket?.structureBias || 'STRUCTURE N/A'}</b></div>
          </header>
          <RealMiniChart symbol={primarySymbol || undefined} timeframe="M5" />
          <footer>
            <div><span>BOS</span><strong>{primaryMarket?.breakOfStructure || 'N/A'}</strong></div>
            <div><span>CHoCH</span><strong>{primaryMarket?.changeOfCharacter || 'N/A'}</strong></div>
            <div><span>FVG</span><strong>{primaryMarket?.fairValueGap || 'N/A'}</strong></div>
            <div><span>RSI</span><strong>{numeric(primaryMarket?.rsi)?.toFixed(1) || 'N/A'}</strong></div>
            <div><span>SPREAD</span><strong>{numeric(primaryMarket?.spread)?.toFixed(2) || 'N/A'}</strong></div>
          </footer>
        </main>

        <aside className="elite-live-feed elite-panel">
          <header><div><span>VERIFIED LEDGER</span><h2>LIVE TRADE FEED</h2></div><Link to="/history">VIEW ALL</Link></header>
          <div>{recentTrades.map((trade) => <TradeRow key={trade.id} trade={trade} />)}</div>
          {!recentTrades.length && <p className="elite-empty">NESSUN ORDINE VERIFICATO DA OANDA</p>}
          <footer><span>Last order</span><strong>{status?.lastOrderStatus || 'N/A'}</strong><small>{status?.lastOrderReason || status?.lastOandaTradeId || 'Nessun tentativo recente'}</small></footer>
        </aside>
      </section>

      <section className="elite-duel">
        <LaneCard title="SCENARIO MAIN" lane={primaryPair?.main} symbol={primarySymbol} />
        <div className="elite-vs">VS</div>
        <LaneCard title="SCENARIO INVERSE" lane={primaryPair?.inverse} symbol={primarySymbol} />
      </section>

      <section className="elite-bottom-grid">
        <article className="elite-panel elite-history">
          <header><div><span>TRADE HISTORY</span><h2>RECENT VERIFIED RESULTS</h2></div><b>{closedTrades.length}</b></header>
          <div>{closedTrades.slice(0, 8).map((trade) => <TradeRow key={trade.id} trade={trade} />)}</div>
          {!closedTrades.length && <p className="elite-empty">NESSUN TRADE CHIUSO VERIFICATO</p>}
        </article>

        <article className="elite-panel elite-xau">
          <header><div><span>XAUUSD · SIGNAL ONLY</span><h2>GOLD AI SETUP</h2></div><Link to="/xauusd">OPEN LAB</Link></header>
          <strong className="elite-xau-price">{price(xauQuote?.mid ?? xau?.closePrice, 'XAUUSD')}</strong>
          <div className="elite-xau-grid">
            <div><span>AI SIGNAL</span><strong className={directionClass(xauCandidate?.side)}>{xauCandidate?.ai?.approved ? xauCandidate.side : 'WAIT'}</strong></div>
            <div><span>TODAY</span><strong>{xauLab ? `${xauLab.todaySignals}/${xauLab.strategy.maxSignalsPerDay}` : 'N/A'}</strong></div>
            <div><span>TOTAL R</span><strong className={(xauLab?.totalR || 0) >= 0 ? 'positive' : 'negative'}>{xauLab ? rValue(xauLab.totalR) : 'N/A'}</strong></div>
            <div><span>WIN RATE</span><strong>{xauLab?.winRate === undefined ? 'N/A' : `${xauLab.winRate.toFixed(1)}%`}</strong></div>
            <div><span>ORDERS</span><strong className="positive">{xauLab?.orderCount ?? 0}</strong></div>
            <div><span>MODE</span><strong>SIGNAL ONLY</strong></div>
          </div>
          <p>{xauCandidate?.ai?.reason || xauCandidate?.reasoning || xauPair?.main?.reasoning || 'XAUUSD analysis not available.'}</p>
        </article>
      </section>

      <section className="elite-panel xau-setup-lab">
        <header>
          <div><span>XAUUSD ONLY · RESULTS LAB</span><h2>GOLD LIQUIDITY CONFLUENCE</h2></div>
          <Link to="/xauusd">FULL CHART</Link>
        </header>
        <div className="xau-setup-overview">
          <div><span>MAX / DAY</span><strong>{xauLab?.strategy.maxSignalsPerDay ?? 10}</strong><small>segnali validi, mai forzati</small></div>
          <div><span>AI GATE</span><strong className={xauCandidate?.ai?.approved ? 'positive' : xauCandidate?.ai?.status === 'ERROR' || xauCandidate?.ai?.status === 'REJECTED' ? 'negative' : 'neutral'}>{xauCandidate?.ai?.status || 'WAITING'}</strong><small>{xauCandidate?.ai?.provider || status?.aiProvider || 'N/A'}</small></div>
          <div><span>MTF ALIGN</span><strong>{xauCandidate?.multiTimeframeAlignment === undefined ? 'N/A' : `${xauCandidate.multiTimeframeAlignment}%`}</strong><small>M1 · M5 · M15 · H1</small></div>
          <div><span>OPEN / CLOSED</span><strong>{xauLab ? `${xauLab.openSignals} / ${xauLab.closedSignals}` : 'N/A'}</strong><small>sessione bot corrente</small></div>
          <div><span>AVG RESULT</span><strong className={(xauLab?.averageR || 0) >= 0 ? 'positive' : 'negative'}>{xauLab?.averageR === undefined ? 'N/A' : rValue(xauLab.averageR)}</strong><small>unità rischio R</small></div>
        </div>
        <div className="xau-setup-body">
          <div className="xau-setup-checks">
            <h3>CHECKLIST CORRENTE</h3>
            {(xauCandidate?.gates || []).map((item) => (
              <div key={item.key} className={item.passed ? 'pass' : 'fail'}>
                <i>{item.passed ? '✓' : '—'}</i>
                <span><strong>{item.label}</strong><small>{item.detail}</small></span>
              </div>
            ))}
            {!xauCandidate?.gates?.length && <p className="elite-empty">IN ATTESA DI SNAPSHOT XAUUSD</p>}
          </div>
          <div className="xau-setup-results">
            <div className="xau-setup-result xau-setup-result--head">
              <time>TIME</time><b>SIDE</b><span>STATUS</span><span>ENTRY</span><strong>RESULT</strong><em>AI</em>
            </div>
            {(xauLab?.signals || []).slice(0, 10).map((signal) => <XauSetupResult key={signal.id} signal={signal} />)}
            {!xauLab?.signals?.length && <p className="elite-empty">NESSUN SEGNALE AI VALIDATO IN QUESTA SESSIONE</p>}
          </div>
        </div>
        <footer>Solo segnali XAUUSD da quote OANDA reali. Il motore non invia ordini XAU e non promette profitti.</footer>
      </section>
    </div>
  );
}
