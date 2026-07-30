import { useEffect, useMemo, useRef, useState } from 'react';
import { ChartPriceLine, ChartSignalMarker } from '../components/RealMiniChart';
import { ProfessionalXauChart } from '../components/ProfessionalXauChart';
import { fetchIntelligence } from '../services/api';
import { executionView } from '../trading-state';
import { SignalLaneSnapshot, StatusSnapshot, XauSignalRecord } from '../types';

const XAU = 'XAUUSD';
const XAU_TIMEFRAMES = ['M1', 'M5', 'M15', 'H1'];

function cleanSymbol(value: unknown) {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function price(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed.toFixed(3) : 'N/A';
}

function numeric(value: unknown, digits = 2) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed.toFixed(digits) : 'N/A';
}

function setupScore(source: { setupScore?: unknown; confidence?: unknown } | null | undefined) {
  const explicit = Number(source?.setupScore);
  const fallback = Number(source?.confidence);
  const value = Number.isFinite(explicit) ? explicit : Number.isFinite(fallback) ? fallback : undefined;
  return value === undefined ? 'N/A' : `${Math.max(0, Math.min(100, Math.round(value)))}/100`;
}

function dateTime(value: unknown) {
  const parsed = new Date(String(value || ''));
  return Number.isNaN(parsed.getTime()) ? 'N/A' : parsed.toLocaleString();
}

function directionClass(action?: string) {
  return action === 'BUY' ? 'positive' : action === 'SELL' ? 'negative' : 'neutral';
}

function rValue(value: unknown, live = false) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 'N/A';
  const sign = parsed > 0 ? '+' : '';
  return `${sign}${parsed.toFixed(2)}R${live ? ' LIVE' : ''}`;
}

function XauResultRow({ signal }: { signal: XauSignalRecord }) {
  const result = signal.closedAt ? signal.resultR : signal.liveR;
  return (
    <div className="xau-result-row">
      <time>{dateTime(signal.openedAt)}</time>
      <b className={directionClass(signal.side)}>{signal.side}</b>
      <span>{signal.status.replace(/_/g, ' ')}</span>
      <span>{price(signal.entryPrice)} → {price(signal.currentPrice)}</span>
      <strong className={result > 0 ? 'positive' : result < 0 ? 'negative' : 'neutral'}>{rValue(result, !signal.closedAt)}</strong>
      <em>{signal.ai.provider} {signal.ai.status}</em>
    </div>
  );
}

function TradePlan({ title, lane, timestamp }: { title: string; lane?: SignalLaneSnapshot; timestamp?: string }) {
  const targets = lane?.structuralTargets || [];
  return (
    <article className={`cockpit-panel xau-trade-plan ${lane?.variant?.toLowerCase() || ''}`}>
      <header className="cockpit-panel__header">
        <div><span>{title}</span><h2 className={directionClass(lane?.action)}>{lane?.action || 'N/A'}</h2></div>
        <b>{setupScore(lane)}</b>
      </header>
      <div className="xau-plan-grid">
        <div><span>ENTRY</span><strong>{price(lane?.entryPrice)}</strong></div>
        <div><span>STOP LOSS</span><strong className="negative">{price(lane?.stopLossPrice)}</strong></div>
        <div><span>TP1</span><strong className="positive">{price(targets[0] ?? lane?.takeProfitPrice)}</strong></div>
        <div><span>TP2</span><strong className="positive">{price(targets[1])}</strong></div>
        <div><span>TP3</span><strong className="positive">{price(targets[2])}</strong></div>
        <div><span>R:R</span><strong>{Number.isFinite(Number(lane?.riskRewardRatio)) ? `1:${Number(lane?.riskRewardRatio).toFixed(2)}` : 'N/A'}</strong></div>
      </div>
      <div className="xau-plan-meta">
        <span>{lane?.mode || 'N/A'}</span>
        <span>{lane?.executionState || 'N/A'}</span>
        <span>{dateTime(timestamp)}</span>
      </div>
      <p>{lane?.reasoning || 'PIANO NON DISPONIBILE'}</p>
    </article>
  );
}

export function XauPage({ status }: { status: StatusSnapshot | null }) {
  const [timeframe, setTimeframe] = useState('M5');
  const [layers, setLayers] = useState({
    ema: true,
    volume: true,
    strategy: true,
    structure: true,
    signals: true
  });
  const [intelligence, setIntelligence] = useState<any>(null);
  const [intelligenceError, setIntelligenceError] = useState('');
  const requestRef = useRef(0);
  const mode = executionView(status);
  const market = status?.marketData?.[XAU];
  const quote = status?.livePrices?.[XAU];
  const pair = status?.pairedSignals?.[XAU];
  const signal = pair?.main;
  const lab = status?.xauSignalLab;
  const candidate = lab?.latestCandidate;
  const activeSignal = lab?.signals?.find((item) => !item.closedAt);
  const currentPrice = quote?.mid ?? market?.closePrice;
  const configured = Boolean(status?.symbols?.map(cleanSymbol).includes(XAU));
  const chartLevels = useMemo<ChartPriceLine[]>(() => {
    const lines: ChartPriceLine[] = [];
    const addLine = (value: unknown, label: string, color: string, style: ChartPriceLine['style'] = 'dashed') => {
      const parsed = Number(value);
      if (!Number.isFinite(parsed) || parsed <= 0) return;
      if (lines.some((line) => Math.abs(line.price - parsed) < 0.001 && line.label === label)) return;
      lines.push({ price: parsed, label, color, style });
    };
    const entry = activeSignal?.entryPrice ?? candidate?.entryPrice;
    const stop = activeSignal?.activeStop ?? candidate?.stopLoss;
    const targets = activeSignal?.takeProfits ?? candidate?.takeProfits ?? [];
    const prefix = activeSignal ? '' : 'WATCH ';
    if (layers.strategy) {
      addLine(entry, `${prefix}ENTRY`, '#4d8dff', 'solid');
      addLine(stop, activeSignal?.protectedAtBreakEven ? 'BREAK EVEN' : `${prefix}STOP`, '#ff4c70');
      targets.slice(0, 3).forEach((target, index) => {
        addLine(target, `${prefix}TP${index + 1}`, index === 2 ? '#e2a93f' : '#1ed391');
      });
    }
    if (layers.structure) {
      (market?.resistanceLevels || []).slice(0, 3).forEach((level: number, index: number) => {
        addLine(level, `RESISTANCE ${index + 1}`, '#ff7690', 'dotted');
      });
      (market?.supportLevels || []).slice(0, 3).forEach((level: number, index: number) => {
        addLine(level, `SUPPORT ${index + 1}`, '#42c8ff', 'dotted');
      });
      addLine(market?.swingHigh, 'SWING HIGH', '#e2a93f', 'dotted');
      addLine(market?.swingLow, 'SWING LOW', '#e2a93f', 'dotted');
      addLine(market?.equalHigh, 'EQUAL HIGH', '#b78cff', 'dotted');
      addLine(market?.equalLow, 'EQUAL LOW', '#b78cff', 'dotted');
      addLine(market?.fairValueGapZone?.high, 'FVG HIGH', '#8a6cff', 'dotted');
      addLine(market?.fairValueGapZone?.low, 'FVG LOW', '#8a6cff', 'dotted');
    }
    return lines;
  }, [
    activeSignal,
    candidate,
    layers.strategy,
    layers.structure,
    market?.equalHigh,
    market?.equalLow,
    market?.fairValueGapZone?.high,
    market?.fairValueGapZone?.low,
    market?.resistanceLevels,
    market?.supportLevels,
    market?.swingHigh,
    market?.swingLow
  ]);
  const chartMarkers = useMemo<ChartSignalMarker[]>(() => (
    layers.signals ? (lab?.signals || []).slice(0, 12).map((item) => ({
      time: item.candleTime,
      side: item.side,
      label: `${item.side} ${item.closedAt ? rValue(item.resultR) : 'LIVE'}`
    })) : []
  ), [lab?.signals, layers.signals]);

  useEffect(() => {
    const requestId = ++requestRef.current;
    setIntelligence(null);
    setIntelligenceError('');
    if (!configured) {
      setIntelligenceError(status ? 'XAUUSD NON CONFIGURATO' : 'STATUS API NON DISPONIBILE');
      return;
    }
    const refresh = async () => {
      const refreshId = ++requestRef.current;
      try {
        const data = await fetchIntelligence(XAU);
        if (refreshId !== requestRef.current) return;
        if (cleanSymbol(data?.symbol) !== XAU) {
          setIntelligence(null);
          setIntelligenceError('RISPOSTA OANDA PER SIMBOLO NON CORRISPONDENTE');
          return;
        }
        setIntelligence(data);
        setIntelligenceError('');
      } catch (_error) {
        if (refreshId !== requestRef.current) return;
        setIntelligence(null);
        setIntelligenceError('INTELLIGENCE OANDA NON DISPONIBILE');
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 30000);
    return () => {
      if (requestId <= requestRef.current) requestRef.current += 1;
      window.clearInterval(timer);
    };
  }, [configured, status === null]);

  const levels = [
    ...(market?.resistanceLevels || []).map((value: number, index: number) => ({ label: `Resistance R${index + 1}`, value, kind: 'resistance' })),
    ...(market?.supportLevels || []).map((value: number, index: number) => ({ label: `Support S${index + 1}`, value, kind: 'support' }))
  ].slice(0, 8);
  const modeLabel = !mode.known ? 'MODE N/A' : mode.paper ? 'PAPER' : mode.ready ? mode.label : mode.demo ? 'OANDA DEMO BLOCKED' : 'OANDA LIVE BLOCKED';

  return (
    <div className="xau-page-pro">
      <header className="xau-command-hero">
        <div>
          <span>XAUUSD · DEDICATED STRUCTURE ENGINE</span>
          <h1>{price(currentPrice)}</h1>
          <p>Laboratorio segnali XAUUSD su dati reali OANDA. L’AI può approvare o rifiutare, ma non può inviare ordini. TP e SL compaiono solo da livelli strutturali reali.</p>
        </div>
        <div className="analysis-only-seal">
          <span>EXECUTION</span>
          <strong>ANALYSIS ONLY</strong>
          <small>{modeLabel} · ORDER COUNT {lab?.orderCount ?? 0} · SEMPRE ZERO</small>
        </div>
      </header>

      <section className="xau-kpi-grid">
        <article><span>Bot</span><strong>{status?.isRunning ? 'RUNNING' : 'STOPPED'}</strong><small>{dateTime(status?.startedAt)}</small></article>
        <article><span>OANDA</span><strong>{status?.oandaConnected ? 'CONNECTED' : 'DISCONNECTED'}</strong><small>{status?.oandaReason || status?.dataSource || 'N/A'}</small></article>
        <article><span>Market structure</span><strong>{market?.structureBias || 'N/A'}</strong><small>{market?.structureSource || 'SOURCE N/A'}</small></article>
        <article><span>AI signal</span><strong className={directionClass(candidate?.side)}>{candidate?.ai?.approved ? candidate.side : candidate?.eligible ? 'AI CHECK' : 'WAIT'}</strong><small>{candidate?.ai ? `${candidate.ai.provider} ${candidate.ai.status}` : 'GATES IN ANALISI'}</small></article>
        <article><span>Signals today</span><strong>{lab ? `${lab.todaySignals}/${lab.strategy.maxSignalsPerDay}` : 'N/A'}</strong><small>{lab ? `${lab.remainingToday} DISPONIBILI · NON FORZATI` : 'LEDGER N/A'}</small></article>
        <article><span>Last quote</span><strong>{quote?.tradeable === true ? 'TRADEABLE' : 'N/A'}</strong><small>{dateTime(quote?.time)}</small></article>
      </section>

      <section className="xau-main-grid">
        <article className="cockpit-panel xau-chart-card xau-chart-card--institutional">
          <header className="cockpit-panel__header">
            <div><span>INSTITUTIONAL CHART · REAL OANDA DATA</span><h2>XAUUSD PROFESSIONAL MARKET MAP</h2></div>
            <div className="xau-timeframe-tabs">
              {XAU_TIMEFRAMES.map((item) => <button key={item} className={timeframe === item ? 'active' : ''} onClick={() => setTimeframe(item)}>{item}</button>)}
            </div>
          </header>

          <div className="xau-chart-toolbar">
            <div className="xau-chart-toolbar__status">
              <span className={quote?.tradeable ? 'online' : ''}><i />{quote?.tradeable ? 'OANDA LIVE' : 'FEED N/A'}</span>
              <b>{market?.session || status?.session || 'SESSION N/A'}</b>
              <b>SPREAD {numeric(market?.spread, 2)}</b>
              <b>{dateTime(quote?.time)}</b>
            </div>
            <div className="xau-layer-controls" aria-label="Livelli grafico">
              {([
                ['ema', 'EMA 20/50/200'],
                ['volume', 'VOLUME'],
                ['strategy', 'ENTRY · SL · TP'],
                ['structure', 'STRUCTURE'],
                ['signals', 'AI SIGNALS']
              ] as const).map(([key, label]) => (
                <button
                  key={key}
                  className={layers[key] ? 'active' : ''}
                  onClick={() => setLayers((current) => ({ ...current, [key]: !current[key] }))}
                  aria-pressed={layers[key]}
                >
                  <i />{label}
                </button>
              ))}
            </div>
          </div>

          <ProfessionalXauChart
            symbol={configured ? XAU : undefined}
            timeframe={timeframe}
            showEma={layers.ema}
            showVolume={layers.volume}
            priceLines={chartLevels}
            markers={chartMarkers}
          />
          <footer className="market-proof-strip">
            <div><span>BOS</span><strong>{market?.breakOfStructure || 'N/A'}</strong></div>
            <div><span>CHoCH</span><strong>{market?.changeOfCharacter || 'N/A'}</strong></div>
            <div><span>Sweep</span><strong>{market?.liquiditySweep || 'N/A'}</strong></div>
            <div><span>FVG</span><strong>{market?.fairValueGap || 'N/A'}</strong></div>
            <div><span>Volume ratio</span><strong>{numeric(market?.volumeRatio)}</strong></div>
          </footer>
        </article>

        <aside className="cockpit-panel xau-blueprint">
          <header className="cockpit-panel__header">
            <div><span>SHARED SIGNAL</span><h2>STRUCTURE BLUEPRINT</h2></div>
            <b>{pair?.pairId ? pair.pairId.slice(-12) : 'PAIR N/A'}</b>
          </header>
          <div className="xau-blueprint__signal">
            <span>FINAL DECISION</span>
            <strong className={directionClass(signal?.action)}>{signal?.action || 'N/A'}</strong>
            <small>{signal?.setupType || 'SETUP N/A'}</small>
          </div>
          <dl>
            <div><dt>Bid</dt><dd>{price(quote?.bid)}</dd></div>
            <div><dt>Ask</dt><dd>{price(quote?.ask)}</dd></div>
            <div><dt>Spread</dt><dd>{numeric(market?.spread, 2)}</dd></div>
            <div><dt>Swing high</dt><dd>{price(market?.swingHigh)}</dd></div>
            <div><dt>Swing low</dt><dd>{price(market?.swingLow)}</dd></div>
            <div><dt>Equal high</dt><dd>{price(market?.equalHigh)}</dd></div>
            <div><dt>Equal low</dt><dd>{price(market?.equalLow)}</dd></div>
            <div><dt>Candle count</dt><dd>{typeof market?.candleCount === 'number' ? market.candleCount : 'N/A'}</dd></div>
          </dl>
          <p>{pair?.executionBlockedReason || signal?.executionReason || signal?.reasoning || 'RAGIONAMENTO STRUTTURALE NON DISPONIBILE'}</p>
        </aside>
      </section>

      <section className="xau-signal-lab-grid">
        <article className="cockpit-panel xau-ai-gate">
          <header className="cockpit-panel__header">
            <div><span>PROFESSIONAL FILTER</span><h2>AI SIGNAL GATE</h2></div>
            <b className={candidate?.ai?.approved ? 'positive' : candidate?.ai?.status === 'REJECTED' || candidate?.ai?.status === 'ERROR' ? 'negative' : 'neutral'}>
              {candidate?.ai?.status || candidate?.runtimeBlocker || candidate?.blocker || 'WAITING'}
            </b>
          </header>
          <div className="xau-ai-verdict">
            <div>
              <span>DECISIONE</span>
              <strong className={directionClass(candidate?.side)}>{candidate?.ai?.approved ? candidate.side : 'NO SIGNAL'}</strong>
            </div>
            <div><span>SCORE</span><strong>{candidate ? `${Math.round(candidate.setupScore)}/100` : 'N/A'}</strong></div>
            <div><span>MTF</span><strong>{candidate ? `${candidate.multiTimeframeConsensus} · ${candidate.multiTimeframeAlignment ?? 'N/A'}%` : 'N/A'}</strong></div>
            <div><span>MIN R:R</span><strong>1:{lab?.strategy.minimumRiskReward ?? 2}</strong></div>
          </div>
          <p>{candidate?.ai?.reason || candidate?.reasoning || 'Il motore attende uno snapshot XAUUSD completo.'}</p>
          <div className="xau-gate-list">
            {(candidate?.gates || []).map((item) => (
              <div key={item.key} className={item.passed ? 'pass' : 'fail'}>
                <i>{item.passed ? '✓' : '—'}</i>
                <span><strong>{item.label}</strong><small>{item.detail}</small></span>
              </div>
            ))}
            {!candidate?.gates?.length && <div className="dense-empty">CHECKLIST IN ATTESA DI DATI OANDA</div>}
          </div>
        </article>

        <article className="cockpit-panel xau-performance">
          <header className="cockpit-panel__header">
            <div><span>SIGNAL-ONLY LEDGER</span><h2>RISULTATI XAUUSD</h2></div>
            <b>{lab?.historyScope === 'CURRENT_BOT_RUNTIME' ? 'SESSIONE BOT' : 'N/A'}</b>
          </header>
          <div className="xau-performance-kpis">
            <div><span>TOTAL R</span><strong className={(lab?.totalR || 0) >= 0 ? 'positive' : 'negative'}>{lab ? rValue(lab.totalR) : 'N/A'}</strong></div>
            <div><span>WIN RATE</span><strong>{lab?.winRate === undefined ? 'N/A' : `${lab.winRate.toFixed(1)}%`}</strong></div>
            <div><span>W / L / BE</span><strong>{lab ? `${lab.wins} / ${lab.losses} / ${lab.breakevens}` : 'N/A'}</strong></div>
            <div><span>OPEN</span><strong>{lab?.openSignals ?? 'N/A'}</strong></div>
          </div>
          <div className="xau-result-list">
            {(lab?.signals || []).slice(0, 10).map((item) => <XauResultRow key={item.id} signal={item} />)}
            {!lab?.signals?.length && <div className="dense-empty">NESSUN SEGNALE AI VALIDATO IN QUESTA SESSIONE BOT</div>}
          </div>
          <footer className="xau-ledger-note">Risultati da quote OANDA bid/ask, espressi in R. Nessun ordine, nessuna commissione nascosta e nessun rendimento garantito.</footer>
        </article>
      </section>

      <section className="xau-plan-compare">
        <TradePlan title="SCENARIO MAIN · ANALISI" lane={pair?.main} timestamp={pair?.evaluatedAt} />
        <TradePlan title="SCENARIO INVERSE · CONTROLLO" lane={pair?.inverse} timestamp={pair?.evaluatedAt} />
      </section>

      <section className="xau-detail-grid">
        <article className="cockpit-panel">
          <header className="cockpit-panel__header"><div><span>OANDA FRAMES</span><h2>MULTI-TIMEFRAME</h2></div><b>{intelligence ? `${intelligence.availableFrames}/4 · ${intelligence.consensus}` : 'N/A'}</b></header>
          <div className="xau-mtf-grid">
            {(intelligence?.frames || []).map((frame: any) => (
              <div key={frame.timeframe}>
                <span>{frame.timeframe}</span>
                <strong className={frame.direction === 'BULLISH' ? 'positive' : frame.direction === 'BEARISH' ? 'negative' : 'neutral'}>{frame.available ? frame.direction : 'N/A'}</strong>
                <small>{frame.available ? `${frame.structure || 'N/A'} · BOS ${frame.bos || 'N/A'} · ALIGN ${Number.isFinite(Number(frame.alignmentScore)) ? `${Math.round(Number(frame.alignmentScore))}/100` : 'N/A'}` : frame.reason || 'N/A'}</small>
              </div>
            ))}
            {!intelligence && <div className="dense-empty">{intelligenceError || 'MTF N/A'}</div>}
          </div>
        </article>

        <article className="cockpit-panel">
          <header className="cockpit-panel__header"><div><span>ACTUAL STRUCTURE</span><h2>KEY LEVELS</h2></div><b>{levels.length || 'N/A'}</b></header>
          <div className="xau-level-table">
            {levels.map((level) => <div key={`${level.kind}-${level.value}`} className={level.kind}><span>{level.label}</span><strong>{price(level.value)}</strong></div>)}
            {levels.length === 0 && <div className="dense-empty">LIVELLI STRUTTURALI N/A</div>}
          </div>
        </article>

        <article className="cockpit-panel">
          <header className="cockpit-panel__header"><div><span>LIQUIDITY MAP</span><h2>PRICE ACTION</h2></div><b>REAL CANDLES</b></header>
          <dl className="xau-action-map">
            <div><dt>Liquidity sweep</dt><dd>{market?.liquiditySweep || 'N/A'}</dd></div>
            <div><dt>Fair value gap</dt><dd>{market?.fairValueGap || 'N/A'}</dd></div>
            <div><dt>FVG low</dt><dd>{price(market?.fairValueGapZone?.low)}</dd></div>
            <div><dt>FVG high</dt><dd>{price(market?.fairValueGapZone?.high)}</dd></div>
            <div><dt>Session</dt><dd>{market?.session || status?.session || 'N/A'}</dd></div>
            <div><dt>Killzone</dt><dd>{market?.killzone === true ? 'ACTIVE' : market?.killzone === false ? 'INACTIVE' : 'N/A'}</dd></div>
          </dl>
        </article>
      </section>
    </div>
  );
}
