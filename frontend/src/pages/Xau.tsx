import { useEffect, useRef, useState } from 'react';
import { RealMiniChart } from '../components/RealMiniChart';
import { fetchIntelligence } from '../services/api';
import { executionView } from '../trading-state';
import { StatusSnapshot } from '../types';

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

export function XauPage({ status }: { status: StatusSnapshot | null }) {
  const [timeframe, setTimeframe] = useState('M5');
  const [intelligence, setIntelligence] = useState<any>(null);
  const [intelligenceError, setIntelligenceError] = useState('');
  const requestRef = useRef(0);
  const mode = executionView(status);
  const market = status?.marketData?.[XAU];
  const quote = status?.livePrices?.[XAU];
  const pair = status?.pairedSignals?.[XAU];
  const signal = pair?.main;
  const currentPrice = quote?.mid ?? market?.closePrice;
  const configured = Boolean(status?.symbols?.map(cleanSymbol).includes(XAU));

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
          <p>Analisi reale OANDA separata dal motore Forex. Nessun ordine XAU viene simulato o inviato da questa pagina.</p>
        </div>
        <div className="analysis-only-seal">
          <span>EXECUTION</span>
          <strong>ANALYSIS ONLY</strong>
          <small>{modeLabel}</small>
        </div>
      </header>

      <section className="xau-kpi-grid">
        <article><span>Market structure</span><strong>{market?.structureBias || 'N/A'}</strong><small>{market?.structureSource || 'SOURCE N/A'}</small></article>
        <article><span>Signal</span><strong>{signal?.action || 'N/A'}</strong><small>SETUP SCORE {setupScore(signal)}</small></article>
        <article><span>Trend</span><strong>{market?.trend || 'N/A'}</strong><small>EMA 20 / 50 / 200</small></article>
        <article><span>Momentum</span><strong>RSI {numeric(market?.rsi, 1)}</strong><small>MACD hist {numeric(market?.macdHistogram, 5)}</small></article>
        <article><span>Volatility</span><strong>{market?.volatility || 'N/A'}</strong><small>ATR {price(market?.atr)}</small></article>
        <article><span>Last quote</span><strong>{quote?.tradeable === true ? 'TRADEABLE' : 'N/A'}</strong><small>{dateTime(quote?.time)}</small></article>
      </section>

      <section className="xau-main-grid">
        <article className="cockpit-panel xau-chart-card">
          <header className="cockpit-panel__header">
            <div><span>REAL CANDLES</span><h2>XAUUSD MARKET MAP</h2></div>
            <div className="xau-timeframe-tabs">
              {XAU_TIMEFRAMES.map((item) => <button key={item} className={timeframe === item ? 'active' : ''} onClick={() => setTimeframe(item)}>{item}</button>)}
            </div>
          </header>
          <RealMiniChart symbol={configured ? XAU : undefined} timeframe={timeframe} />
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
            <span>MAIN DIRECTION</span>
            <strong className={signal?.action === 'BUY' ? 'positive' : signal?.action === 'SELL' ? 'negative' : 'neutral'}>{signal?.action || 'N/A'}</strong>
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
          <p>{signal?.reasoning || 'RAGIONAMENTO STRUTTURALE NON DISPONIBILE'}</p>
        </aside>
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
