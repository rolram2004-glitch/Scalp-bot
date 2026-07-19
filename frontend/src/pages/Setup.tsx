import { OandaStatus, SignalLaneSnapshot, StatusSnapshot } from '../types';

function valueOrNA(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value === 'string' && value.trim()) return value.trim();
  return 'N/A';
}

function price(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? String(value) : 'N/A';
}

function dateTime(value?: string) {
  if (!value) return 'N/A';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 'N/A' : parsed.toLocaleString();
}

function laneStatus(lane: SignalLaneSnapshot) {
  if (lane.mode === 'PAPER') return 'PAPER — NESSUN ORDINE OANDA';
  if (!lane.selectedForExecution) return 'PAPER SHADOW — NESSUN ORDINE OANDA';
  if (lane.executionState === 'OPEN_VERIFIED') return 'OPEN VERIFIED OANDA';
  if (lane.executionState === 'REJECTED') return 'ORDER REJECTED';
  if (lane.executionState === 'SKIPPED') return 'ORDER SKIPPED';
  if (lane.executionState === 'SUBMITTING') return 'SUBMITTING TO OANDA';
  if (lane.executionState === 'NOT_ELIGIBLE') return 'NON ELIGIBILE — NESSUN ORDINE';
  return 'CORSIA LIVE SELEZIONATA — READY';
}

function laneBadgeClass(lane: SignalLaneSnapshot) {
  if (!lane.selectedForExecution) return 'lane-shadow';
  if (lane.executionState === 'REJECTED' || lane.executionState === 'SKIPPED') return 'lane-alert';
  return 'lane-live';
}

function SignalLaneCard({ lane }: { lane: SignalLaneSnapshot }) {
  const actionClass = lane.action === 'BUY' ? 'win' : lane.action === 'SELL' ? 'loss' : '';

  return (
    <article className={`signal-lane ${lane.selectedForExecution ? 'selected' : 'shadow'}`}>
      <div className="signal-lane-head">
        <div>
          <span>Corsia strategia</span>
          <strong>{lane.variant}</strong>
        </div>
        <b className={laneBadgeClass(lane)}>{laneStatus(lane)}</b>
      </div>
      <div className="signal-lane-action">
        <strong className={actionClass}>{lane.action}</strong>
        <span>{Number.isFinite(lane.confidence) ? `${lane.confidence}% confidence` : 'N/A'}</span>
      </div>
      <div className="signal-lane-meta">
        <span>Setup</span><strong>{lane.setupType || 'N/A'}</strong>
        <span>Origine</span><strong>{lane.derivedFrom ? `DERIVATO DA ${lane.derivedFrom}` : 'STRATEGIA MAIN INVARIATA'}</strong>
        <span>Esito</span><strong>{lane.executionState}{lane.executionReason ? ` — ${lane.executionReason}` : ''}</strong>
        <span>OANDA IDs</span><strong>{lane.oandaTradeId ? `Trade ${lane.oandaTradeId}${lane.oandaOrderId ? ` · Order ${lane.oandaOrderId}` : ''}` : 'N/A'}</strong>
      </div>
      <p>{lane.reasoning || 'N/A'}</p>
    </article>
  );
}

export function SetupPage({
  status,
  news = [],
  oandaStatus
}: {
  status: StatusSnapshot | null;
  news?: any[];
  oandaStatus?: OandaStatus;
}) {
  const hasLiveData = Boolean(oandaStatus?.connected && status?.priceFeedStatus === 'CONNECTED');
  const running = Boolean(status?.isRunning);
  const pair = status?.latestPairedSignal;
  const accountCurrency = oandaStatus?.currency || status?.accountCurrency;
  const selectedVariant = status?.tradingMode === 'LIVE' && status?.liveTradingEnabled && status?.liveExecutionVariantValid
    ? status.liveExecutionVariant
    : 'NESSUNA — ENTRAMBE SHADOW';

  return (
    <div className="setup-page">
      <section className="page-hero">
        <div>
          <p className="eyebrow">Setup</p>
          <h1>Strategia MAIN e lettura INVERSE sullo stesso dato OANDA.</h1>
        </div>
        <div className={hasLiveData ? 'system-active' : 'system-warning'}>
          {hasLiveData ? 'OANDA DATA CONNECTED' : 'OANDA DATA DISCONNECTED'}
        </div>
      </section>

      <section className="setup-grid">
        <div className="setup-card featured">
          <span>Stato bot</span>
          <strong>{running ? 'RUNNING' : 'STOPPED'}</strong>
          <p>{running ? 'Il motore analizza i simboli configurati.' : 'Il motore non sta analizzando i mercati.'}</p>
        </div>
        <div className="setup-card">
          <span>Dati mercato</span>
          <strong>{hasLiveData ? 'OANDA REAL DATA' : 'NON DISPONIBILI'}</strong>
          <p>{hasLiveData ? 'Le quotazioni arrivano dall’account OANDA Practice.' : 'Nessun fallback sintetico viene mostrato.'}</p>
        </div>
        <div className="setup-card">
          <span>Esecuzione ordini</span>
          <strong>{status?.executionMode || 'N/A'}</strong>
          <p>Corsia OANDA selezionata: {selectedVariant}. Le corsie shadow non inviano ordini.</p>
        </div>
        <div className="setup-card">
          <span>Account OANDA</span>
          <strong>{accountCurrency || 'N/A'}</strong>
          <p>Saldo {valueOrNA(oandaStatus?.balance)} · NAV {valueOrNA(oandaStatus?.nav)} · P&amp;L non realizzato {valueOrNA(oandaStatus?.unrealizedPL)}</p>
        </div>
      </section>

      <section className="panel setup-panel signal-pair-panel">
        <div className="panel-title">
          <h2>Snapshot segnale condiviso</h2>
          <span>{pair ? `${pair.symbol} · ${pair.pairId}` : 'IN ATTESA DEL PROSSIMO SCAN'}</span>
        </div>
        {pair ? (
          <>
            <div className="signal-envelope">
              <div><span>Valutato</span><strong>{dateTime(pair.evaluatedAt)}</strong></div>
              <div><span>Tick OANDA</span><strong>{dateTime(pair.market.time)}</strong></div>
              <div><span>Bid</span><strong>{price(pair.market.bid)}</strong></div>
              <div><span>Ask</span><strong>{price(pair.market.ask)}</strong></div>
              <div><span>Mid</span><strong>{price(pair.market.mid)}</strong></div>
              <div><span>Mercato</span><strong>{pair.marketValid ? 'FRESH / TRADEABLE' : 'BLOCCATO'}</strong></div>
            </div>
            <div className="signal-analysis">
              <div><span>Timeframe</span><strong>{pair.analysis.timeframe || 'N/A'}</strong></div>
              <div><span>Candela</span><strong>{dateTime(pair.analysis.candleTime)}</strong></div>
              <div><span>EMA 20 / 50 / 200</span><strong>{price(pair.analysis.ema20)} / {price(pair.analysis.ema50)} / {price(pair.analysis.ema200)}</strong></div>
              <div><span>RSI</span><strong>{valueOrNA(pair.analysis.rsi)}</strong></div>
              <div><span>Struttura / trend</span><strong>{pair.analysis.structureBias || 'N/A'} / {pair.analysis.trend || 'N/A'}</strong></div>
              <div><span>Spread</span><strong>{valueOrNA(pair.analysis.spread)}</strong></div>
            </div>
            {pair.executionBlockedReason && <div className="execution-blocked">LIVE BLOCCATO: {pair.executionBlockedReason}</div>}
            {!pair.marketValid && <div className="execution-blocked">PAPER/SHADOW BLOCCATI: {pair.marketValidationReason || 'OANDA_MARKET_DATA_INVALID'}</div>}
            <div className="signal-lanes">
              <SignalLaneCard lane={pair.main} />
              <SignalLaneCard lane={pair.inverse} />
            </div>
            <p className="signal-note">Le due letture condividono pair ID, timestamp e quotazione. Un BUY usa l’ask e un SELL usa il bid dello stesso tick; il prezzo di riempimento OANDA può differire per spread e slippage.</p>
          </>
        ) : (
          <div className="empty-state">Nessun segnale reale ancora disponibile. Il pannello non crea dati dimostrativi.</div>
        )}
      </section>

      <section className="panel setup-panel">
        <div className="panel-title"><h2>Ledger PAPER SHADOW</h2><span>SEPARATO DA OANDA E DAL P&amp;L LIVE</span></div>
        <div className="shadow-ledger-summary">
          <div><span>Aperte</span><strong>{status ? status.shadowOpenTrades.length : 'N/A'}</strong></div>
          <div><span>Chiuse</span><strong>{status ? status.shadowClosedTrades.length : 'N/A'}</strong></div>
          <div><span>Create dalla sessione</span><strong>{status ? status.shadowTradeCount : 'N/A'}</strong></div>
        </div>
        <div className="shadow-ledger-list">
          {(status?.shadowOpenTrades || []).slice(0, 8).map((trade) => (
            <div className="shadow-ledger-row" key={trade.id}>
              <strong>{trade.strategyVariant || 'SHADOW'} {trade.symbol} {trade.side}</strong>
              <span>OPEN · entry {price(trade.entryPrice)} · current {price(trade.currentPrice)} · {trade.pnlCurrency || 'quote'} {valueOrNA(trade.pnl)}</span>
              <b>NESSUN ORDINE OANDA</b>
            </div>
          ))}
          {status && status.shadowOpenTrades.length === 0 && <div className="empty-state">Nessuna posizione shadow aperta.</div>}
          {!status && <div className="empty-state">DATI NON DISPONIBILI</div>}
        </div>
      </section>

      <section className="panel setup-panel">
        <div className="panel-title"><h2>Controlli operativi</h2><span>{status?.session || 'N/A'}</span></div>
        <div className="setup-checks">
          <div className={running ? 'check-row ok' : 'check-row warn'}><b />Motore autonomo {running ? 'attivo' : 'fermo'}</div>
          <div className={hasLiveData ? 'check-row ok' : 'check-row warn'}><b />Dati OANDA {hasLiveData ? 'collegati' : 'non collegati'}</div>
          <div className={status?.tradingMode === 'LIVE' ? 'check-row warn' : 'check-row ok'}><b />Trading mode {status?.tradingMode || 'N/A'}</div>
          <div className={status?.liveExecutionVariantValid ? 'check-row ok' : 'check-row warn'}><b />Selettore esclusivo {status?.liveExecutionVariant || 'N/A'}</div>
          <div className={hasLiveData ? 'check-row ok' : 'check-row warn'}><b />Grafico solo con candele OANDA reali</div>
        </div>
      </section>

      <section className="panel setup-panel">
        <div className="panel-title"><h2>Calendario news</h2><span>{news.length ? 'FONTE REALE' : 'NON CONFIGURATO'}</span></div>
        <div className="news-list">
          {news.length > 0 ? news.map((item: any) => (
            <div key={item.id} className={`news-row ${String(item.impact).toLowerCase()}`}>
              <div><strong>{item.currency}</strong><span>{new Date(item.time).toLocaleTimeString()}</span></div>
              <div><strong>{item.title}</strong><span>{item.note}</span></div>
              <b>{item.impact}</b>
            </div>
          )) : <div className="empty-state">ECONOMIC CALENDAR NOT CONFIGURED</div>}
        </div>
      </section>

      <section className="panel setup-panel">
        <div className="panel-title"><h2>Simboli monitorati</h2><span>{status?.symbols ? `${status.symbols.length} symbols` : 'N/A'}</span></div>
        <div className="symbol-cloud">
          {(status?.symbols || []).map((symbol) => <span key={symbol}>{symbol}</span>)}
        </div>
      </section>
    </div>
  );
}
