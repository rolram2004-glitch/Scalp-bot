import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createChart, CrosshairMode, LineStyle, ISeriesApi, CandlestickData, LineData, UTCTimestamp } from 'lightweight-charts';
import { fetchCandles, fetchIntelligence } from '../services/api';
import { StatusSnapshot } from '../types';
import { executionView, hasVerifiedOandaLedger } from '../trading-state';
const TIMEFRAMES = [['M1', '1m'], ['M5', '5m'], ['M15', '15m'], ['H1', '1h']];

function compactSymbol(symbol: unknown) {
  return String(symbol || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

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

function price(value: unknown, symbol: string) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 'N/A';
  return parsed.toFixed(pricePrecision(symbol));
}

function pricePrecision(symbol: string, metadata?: any) {
  if (symbol.includes('XAU')) return Number.isInteger(metadata?.displayPrecision) ? metadata.displayPrecision : 3;
  return symbol.includes('JPY') ? 3 : 5;
}

function dedupeLevels(values: unknown[], symbol: string, atr?: unknown) {
  const threshold = Math.max(Number(atr) || 0, symbol.includes('JPY') ? 0.003 : symbol.includes('XAU') ? 0.15 : 0.00003);
  return values.map(Number).filter((value) => Number.isFinite(value) && value > 0).sort((a, b) => a - b).filter((value, index, all) => index === 0 || Math.abs(value - all[index - 1]) >= threshold).slice(0, 3);
}

function dateTime(value?: string) {
  if (!value) return 'N/A';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 'N/A' : parsed.toLocaleString();
}

function tradePnl(trade: any) {
  if (!finite(trade?.pnl)) return 'N/A';
  const verifiedLive = trade.source === 'OANDA' && trade.verificationStatus === 'VERIFIED';
  const paper = String(trade.source || '').startsWith('PAPER');
  if (!verifiedLive && !paper) return 'N/A';
  const currency = verifiedLive ? trade.accountCurrency : trade.pnlCurrency;
  if (!currency) return 'N/A';
  return `${trade.pnl >= 0 ? '+' : '-'}${Math.abs(trade.pnl).toFixed(2)} ${currency}`;
}

function containingCandleTime(candles: CandlestickData<UTCTimestamp>[], eventTime: unknown) {
  const timestamp = Date.parse(String(eventTime || '')) / 1000;
  if (!Number.isFinite(timestamp) || candles.length === 0) return undefined;
  const first = candles[0].time as number;
  const last = candles[candles.length - 1].time as number;
  if (timestamp < first || timestamp > last + 3600) return undefined;

  for (let index = candles.length - 1; index >= 0; index -= 1) {
    if ((candles[index].time as number) <= timestamp) return candles[index].time;
  }
  return undefined;
}

function emaSeries(data: CandlestickData<UTCTimestamp>[], period: number): LineData<UTCTimestamp>[] {
  if (data.length < period) return [];
  const multiplier = 2 / (period + 1);
  let ema = data.slice(0, period).reduce((sum, candle) => sum + candle.close, 0) / period;
  const result: LineData<UTCTimestamp>[] = [{ time: data[period - 1].time, value: ema }];
  for (let index = period; index < data.length; index += 1) {
    ema = (data[index].close - ema) * multiplier + ema;
    result.push({ time: data[index].time, value: ema });
  }
  return result;
}

function ScenarioCard({
  title,
  lane,
  pair,
  symbol,
  stopLoss,
  takeProfit
}: {
  title: string;
  lane: any;
  pair: any;
  symbol: string;
  stopLoss?: number;
  takeProfit?: number;
}) {
  const action = lane?.action;
  const entry = action === 'BUY' ? pair?.market?.ask : action === 'SELL' ? pair?.market?.bid : undefined;
  const conditions = [
    pair?.analysis?.trend ? `Trend ${pair.analysis.trend}` : undefined,
    pair?.analysis?.structureBias ? `Structure ${pair.analysis.structureBias}` : undefined,
    pair?.analysis?.breakOfStructure ? `BOS ${pair.analysis.breakOfStructure}` : undefined,
    pair?.analysis?.changeOfCharacter ? `CHoCH ${pair.analysis.changeOfCharacter}` : undefined,
    typeof pair?.analysis?.rsi === 'number' ? `RSI ${pair.analysis.rsi.toFixed(1)}` : undefined
  ].filter((item): item is string => Boolean(item));
  return (
    <article className={`scenario-card ${action === 'BUY' ? 'buy' : action === 'SELL' ? 'sell' : 'hold'}`}>
      <header>
        <div><span>{title}</span><strong className={action === 'BUY' ? 'positive' : action === 'SELL' ? 'negative' : 'neutral'}>{action || 'N/A'}</strong></div>
        <b>SETUP SCORE {setupScoreText(lane)}</b>
      </header>
      <div className="scenario-card__body">
        <ul>{conditions.length ? conditions.map((condition) => <li key={condition}>{condition}</li>) : <li>CONDIZIONI N/A</li>}</ul>
        <dl>
          <div><dt>Entry quote</dt><dd>{price(entry, symbol)}</dd></div>
          <div><dt>Stop</dt><dd>{price(stopLoss, symbol)}</dd></div>
          <div><dt>Take profit</dt><dd>{price(takeProfit, symbol)}</dd></div>
          <div><dt>Execution</dt><dd>{lane?.executionState || 'N/A'}</dd></div>
        </dl>
      </div>
      <footer>{lane?.reasoning || 'NESSUNO SNAPSHOT REALE DISPONIBILE'}</footer>
    </article>
  );
}

export function ChartPage({ status, marketData }: { status: StatusSnapshot | null; marketData: Record<string, any> }) {
  const configuredSymbols = Array.isArray(status?.symbols) && status.symbols.length > 0
    ? status.symbols.map(compactSymbol)
    : [];
  const configuredKey = configuredSymbols.join('|');
  const [symbol, setSymbol] = useState('EURUSD');
  const [timeframe, setTimeframe] = useState('M5');
  const [candles, setCandles] = useState<any[]>([]);
  const [candleDatasetKey, setCandleDatasetKey] = useState('');
  const [chartError, setChartError] = useState('');
  const [intelligence, setIntelligence] = useState<any>(null);
  const [intelligenceSymbol, setIntelligenceSymbol] = useState('');
  const [intelligenceError, setIntelligenceError] = useState('');
  const [layers, setLayers] = useState({ trades: true, structure: true, levels: true });
  const chartContainerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<ReturnType<typeof createChart> | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const emaSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const priceLinesRef = useRef<any[]>([]);
  const candleRequestRef = useRef(0);
  const intelligenceRequestRef = useRef(0);
  const fittedDatasetRef = useRef('');
  const displaySymbol = compactSymbol(symbol);
  const activeCandleKey = `${displaySymbol}:${timeframe}`;
  const displayedChartError = candleDatasetKey === activeCandleKey ? chartError : '';
  const displayedIntelligence = intelligenceSymbol === displaySymbol ? intelligence : null;
  const displayedIntelligenceError = intelligenceSymbol === displaySymbol ? intelligenceError : '';
  const mode = executionView(status);
  const oandaLedgerAvailable = hasVerifiedOandaLedger(status);
  const tradeLedgerAvailable = mode.paper || oandaLedgerAvailable;
  const selectedMarket = marketData?.[displaySymbol] || marketData?.[`${displaySymbol.slice(0, 3)}_${displaySymbol.slice(3)}`];
  const tradeEligible = (trade: any) => {
    if (trade?.source === 'LOCAL_ORPHAN' || trade?.verificationStatus === 'NOT_VERIFIED') return false;
    if (mode.paper) return trade?.source === 'PAPER';
    return oandaLedgerAvailable && trade?.source === 'OANDA' && trade?.verificationStatus === 'VERIFIED';
  };
  const selectedOpenTrades = (status?.openTrades || []).filter((trade: any) => compactSymbol(trade.symbol) === displaySymbol && tradeEligible(trade));
  const selectedClosedTrades = (status?.closedTrades || []).filter((trade: any) => compactSymbol(trade.symbol) === displaySymbol && tradeEligible(trade));
  const allVisibleOpenTrades = tradeLedgerAvailable ? (status?.openTrades || []).filter(tradeEligible) : [];
  const selectedHistory = [...selectedOpenTrades, ...selectedClosedTrades].slice(0, 12);

  useEffect(() => {
    if (configuredSymbols.length > 0 && !configuredSymbols.includes(displaySymbol)) {
      setSymbol(configuredSymbols[0]);
    }
  }, [configuredKey, displaySymbol]);

  const loadCandles = useCallback((clearBeforeLoad = false) => {
    const requestedSymbol = displaySymbol;
    const requestedTimeframe = timeframe;
    const requestId = ++candleRequestRef.current;
    if (clearBeforeLoad) {
      setCandles([]);
      setCandleDatasetKey(`${requestedSymbol}:${requestedTimeframe}`);
      setChartError('');
    }
    if (!configuredKey || !configuredSymbols.includes(requestedSymbol)) {
      setCandles([]);
      setCandleDatasetKey(`${requestedSymbol}:${requestedTimeframe}`);
      setChartError('Stato strumenti non disponibile');
      return Promise.resolve();
    }
    return fetchCandles(requestedSymbol, requestedTimeframe, 250)
      .then((data) => {
        if (requestId !== candleRequestRef.current) return;
        setCandles(Array.isArray(data) ? data : []);
        setCandleDatasetKey(`${requestedSymbol}:${requestedTimeframe}`);
        setChartError(Array.isArray(data) && data.length > 0 ? '' : 'Candele OANDA non disponibili');
      })
      .catch(() => {
        if (requestId !== candleRequestRef.current) return;
        setCandles([]);
        setCandleDatasetKey(`${requestedSymbol}:${requestedTimeframe}`);
        setChartError('Candele OANDA non disponibili');
      });
  }, [configuredKey, displaySymbol, timeframe]);

  useEffect(() => {
    void loadCandles(true);
    const timer = window.setInterval(() => void loadCandles(false), 15000);
    return () => {
      candleRequestRef.current += 1;
      window.clearInterval(timer);
    };
  }, [loadCandles]);

  useEffect(() => {
    const requestedSymbol = displaySymbol;
    const requestId = ++intelligenceRequestRef.current;
    setIntelligence(null);
    setIntelligenceSymbol(requestedSymbol);
    setIntelligenceError('');
    if (!configuredKey || !configuredSymbols.includes(requestedSymbol)) {
      setIntelligenceError('Stato strumenti non disponibile');
      return;
    }
    const refresh = () => {
      const refreshId = ++intelligenceRequestRef.current;
      return fetchIntelligence(requestedSymbol)
      .then((data) => {
        if (refreshId !== intelligenceRequestRef.current) return;
        if (compactSymbol(data?.symbol) !== requestedSymbol) {
          setIntelligence(null);
          setIntelligenceSymbol(requestedSymbol);
          setIntelligenceError('Risposta multi-timeframe per simbolo non corrispondente');
          return;
        }
        setIntelligence(data);
        setIntelligenceSymbol(requestedSymbol);
        setIntelligenceError('');
      })
      .catch(() => {
        if (refreshId !== intelligenceRequestRef.current) return;
        setIntelligence(null);
        setIntelligenceSymbol(requestedSymbol);
        setIntelligenceError('Analisi multi-timeframe OANDA non disponibile');
      });
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 30000);
    return () => {
      if (requestId <= intelligenceRequestRef.current) intelligenceRequestRef.current += 1;
      window.clearInterval(timer);
    };
  }, [configuredKey, displaySymbol]);

  useEffect(() => {
    if (!chartContainerRef.current) return;
    const container = chartContainerRef.current;
    const chart = createChart(container, {
      width: container.clientWidth,
      height: container.clientHeight || 500,
      layout: { background: { color: '#f8fbfa' }, textColor: '#687770' },
      grid: { vertLines: { color: '#e8efec' }, horzLines: { color: '#e8efec' } },
      crosshair: { mode: CrosshairMode.Magnet },
      rightPriceScale: { borderColor: '#dce6e2', autoScale: true },
      timeScale: { borderColor: '#dce6e2', timeVisible: true, secondsVisible: false }
    });
    const candleSeries = chart.addCandlestickSeries({
      upColor: '#0c9f6e', downColor: '#dd4f68', borderVisible: false,
      wickUpColor: '#0c9f6e', wickDownColor: '#dd4f68', priceFormat: { type: 'price', precision: pricePrecision(displaySymbol), minMove: displaySymbol.includes('JPY') ? 0.001 : 0.00001 }
    });
    const ema = chart.addLineSeries({ color: '#f7c948', lineWidth: 2, lineStyle: LineStyle.Solid, title: 'EMA20', priceFormat: { type: 'price', precision: pricePrecision(displaySymbol), minMove: displaySymbol.includes('JPY') ? 0.001 : 0.00001 } });
    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    emaSeriesRef.current = ema;
    const resize = () => {
      const width = container.clientWidth;
      const height = container.clientHeight;
      if (width > 0 && height > 0) chart.applyOptions({ width, height });
    };
    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(container);
    resize();
    return () => {
      resizeObserver.disconnect();
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      emaSeriesRef.current = null;
    };
  }, [displaySymbol]);

  const formatted = useMemo(() => (candleDatasetKey === activeCandleKey ? candles : []).flatMap((candle) => {
    const timestamp = Math.floor(Date.parse(String(candle?.time || '')) / 1000);
    const open = Number(candle?.mid?.o);
    const high = Number(candle?.mid?.h);
    const low = Number(candle?.mid?.l);
    const close = Number(candle?.mid?.c);
    if (![timestamp, open, high, low, close].every(Number.isFinite) || high < low || low <= 0) return [];
    return [{ time: timestamp as UTCTimestamp, open, high, low, close }];
  }), [activeCandleKey, candleDatasetKey, candles]);

  useEffect(() => {
    const series = candleSeriesRef.current;
    const ema = emaSeriesRef.current;
    if (!series || !ema) return;
    series.setData(formatted);
    ema.setData(emaSeries(formatted, 20));
    const datasetKey = `${displaySymbol}:${timeframe}`;
    if (formatted.length > 0 && fittedDatasetRef.current !== datasetKey) {
      chartRef.current?.timeScale().fitContent();
      fittedDatasetRef.current = datasetKey;
    }
  }, [displaySymbol, formatted, timeframe]);

  useEffect(() => {
    const series = candleSeriesRef.current;
    if (!series) return;

    const markers: any[] = [];
    if (layers.trades) {
      selectedHistory.forEach((trade: any) => {
        const time = containingCandleTime(formatted, trade.openedAt);
        if (!time || (trade.side !== 'BUY' && trade.side !== 'SELL')) return;
        const identifier = String(trade.signalId || trade.oandaTradeId || trade.id || 'N/A');
        markers.push({
          time,
          position: trade.side === 'BUY' ? 'belowBar' : 'aboveBar',
          color: trade.side === 'BUY' ? '#22c55e' : '#ef476f',
          shape: trade.side === 'BUY' ? 'arrowUp' : 'arrowDown',
          text: `${trade.side} ${new Date(trade.openedAt).toLocaleTimeString()} · ${identifier.slice(-12)}`
        });
      });
    }
    if (layers.structure) {
      [...(selectedMarket?.swingHighs || [])].slice(-2).forEach((swing: any) => {
        const time = containingCandleTime(formatted, swing.time);
        if (time) markers.push({ time, position: 'aboveBar', color: '#a78bfa', shape: 'circle', text: `SWING H ${price(swing.price, displaySymbol)}` });
      });
      [...(selectedMarket?.swingLows || [])].slice(-2).forEach((swing: any) => {
        const time = containingCandleTime(formatted, swing.time);
        if (time) markers.push({ time, position: 'belowBar', color: '#38bdf8', shape: 'circle', text: `SWING L ${price(swing.price, displaySymbol)}` });
      });
      const fvgTime = containingCandleTime(formatted, selectedMarket?.fairValueGapZone?.time);
      if (fvgTime) markers.push({
        time: fvgTime,
        position: selectedMarket.fairValueGapZone.direction === 'BULLISH' ? 'belowBar' : 'aboveBar',
        color: '#f59e0b', shape: 'square', text: `FVG ${selectedMarket.fairValueGapZone.direction}`
      });
    }
    markers.sort((left, right) => Number(left.time) - Number(right.time));
    series.setMarkers(markers);

    priceLinesRef.current.forEach((line) => {
      try { series.removePriceLine(line); } catch (_error) { /* already removed */ }
    });
    priceLinesRef.current = [];
    const addLine = (value: unknown, color: string, title: string, style = LineStyle.Dashed, axisLabelVisible = true) => {
      const parsed = Number(value);
      if (!Number.isFinite(parsed) || parsed <= 0) return;
      priceLinesRef.current.push(series.createPriceLine({ price: parsed, color, lineWidth: 1, lineStyle: style, axisLabelVisible, title }));
    };
    if (layers.trades) selectedOpenTrades.slice(0, 1).forEach((trade: any) => {
      addLine(trade.entryPrice, '#60a5fa', `ENTRY ${trade.side || ''}`, LineStyle.Solid);
      addLine(trade.stopLoss, '#ef476f', 'STOP');
      addLine(trade.takeProfit, '#22c55e', 'TAKE PROFIT');
    });
    if (layers.levels) {
      dedupeLevels(selectedMarket?.supportLevels || [], displaySymbol, selectedMarket?.atr).forEach((level: number, index: number) => addLine(level, '#38bdf8', `S${index + 1}`, LineStyle.Dotted, false));
      dedupeLevels(selectedMarket?.resistanceLevels || [], displaySymbol, selectedMarket?.atr).forEach((level: number, index: number) => addLine(level, '#a78bfa', `R${index + 1}`, LineStyle.Dotted, false));
      addLine(selectedMarket?.fairValueGapZone?.low, '#f59e0b', 'FVG LOW', LineStyle.Dotted, false);
      addLine(selectedMarket?.fairValueGapZone?.high, '#f59e0b', 'FVG HIGH', LineStyle.Dotted, false);
    }
  }, [formatted, layers, selectedHistory, selectedMarket, selectedOpenTrades, displaySymbol]);

  const latestPrice = formatted.length > 0 ? formatted[formatted.length - 1].close : undefined;
  const selectedPair = status?.pairedSignals?.[displaySymbol];
  const selectedOperationalLane = displaySymbol === 'XAUUSD'
    ? selectedPair?.main
    : status?.liveExecutionVariant === 'INVERSE'
      ? selectedPair?.inverse
      : selectedPair?.main;
  const selectedOpenTrade = selectedOpenTrades[0];
  const snapshotMatchesSymbol = compactSymbol(status?.currentSymbol) === displaySymbol;
  const mainOpenTrade = selectedOpenTrades.find((trade: any) => (trade.strategyVariant || 'MAIN') === 'MAIN');
  const inverseOpenTrade = selectedOpenTrades.find((trade: any) => trade.strategyVariant === 'INVERSE');
  const mainScenarioStop = mainOpenTrade?.stopLoss ?? (snapshotMatchesSymbol ? status?.stopLoss : undefined);
  const mainScenarioTakeProfit = mainOpenTrade?.takeProfit ?? (snapshotMatchesSymbol ? status?.takeProfit : undefined);
  const inverseScenarioStop = inverseOpenTrade?.stopLoss;
  const inverseScenarioTakeProfit = inverseOpenTrade?.takeProfit;
  const xauSymbol = 'XAUUSD';
  const xauMarket = status?.marketData?.[xauSymbol] || marketData?.[xauSymbol];
  const xauPair = status?.pairedSignals?.[xauSymbol];
  const xauQuote = status?.livePrices?.[xauSymbol];
  const xauPrice = xauQuote?.mid ?? xauMarket?.closePrice;
  const displayMode = !mode.known
    ? 'MODE N/A'
    : mode.paper
      ? 'PAPER'
      : mode.ready && oandaLedgerAvailable ? mode.label : mode.demo ? 'OANDA DEMO BLOCKED' : 'OANDA LIVE BLOCKED';

  return (
    <div className="trading-room-page">
      <section className="trading-room-grid">
        <aside className="cockpit-panel scanner-rail">
          <header className="cockpit-panel__header">
            <div><span>REAL MARKET</span><h2>SCANNER</h2></div>
            <b>{configuredSymbols.length || 'N/A'}</b>
          </header>
          <div className="scanner-rail__rows">
            {configuredSymbols.map((item) => {
              const market = status?.marketData?.[item] || marketData?.[item];
              const pair = status?.pairedSignals?.[item];
              const quote = status?.livePrices?.[item];
              const activeLane = item === 'XAUUSD'
                ? pair?.main
                : status?.liveExecutionVariant === 'INVERSE'
                  ? pair?.inverse
                  : pair?.main;
              const action = activeLane?.action || status?.lastSignals?.[item]?.action;
              const scoreSource = activeLane || status?.lastSignals?.[item];
              return (
                <button key={item} className={item === displaySymbol ? 'active' : ''} onClick={() => setSymbol(item)}>
                  <strong>{item}</strong>
                  <span className={action === 'BUY' ? 'positive' : action === 'SELL' ? 'negative' : 'neutral'}>{action || market?.trend || 'N/A'}</span>
                  <b>{setupScoreText(scoreSource)}</b>
                  <small>{price(quote?.mid ?? market?.closePrice, item)}</small>
                </button>
              );
            })}
            {configuredSymbols.length === 0 && <div className="dense-empty">SCANNER N/A</div>}
          </div>
          <div className="scanner-filter">
            <span>TIMEFRAME</span>
            <div>{TIMEFRAMES.map(([value, label]) => <button key={value} className={value === timeframe ? 'active' : ''} onClick={() => setTimeframe(value)}>{label}</button>)}</div>
          </div>
          <section className="rail-positions">
            <header><span>POSIZIONI APERTE</span><b>{tradeLedgerAvailable ? allVisibleOpenTrades.length : 'N/A'}</b></header>
            {allVisibleOpenTrades.slice(0, 6).map((trade: any) => (
              <div key={trade.id}>
                <strong>{trade.symbol}</strong>
                <b className={trade.side === 'BUY' ? 'positive' : 'negative'}>{trade.side}</b>
                <span>{price(trade.entryPrice, trade.symbol)}</span>
                <em>{tradePnl(trade)}</em>
              </div>
            ))}
            {allVisibleOpenTrades.length === 0 && <div className="dense-empty">{tradeLedgerAvailable ? 'NESSUNA POSIZIONE' : 'LEDGER N/A'}</div>}
          </section>
        </aside>

        <main className="trading-room-center">
          <article className="cockpit-panel pro-chart-panel">
            <header className="pro-chart-panel__header">
              <div className="instrument-title">
                <span>{displaySymbol || 'N/A'}</span>
                <strong>{price(latestPrice, displaySymbol)}</strong>
                <small>{selectedMarket?.trend || 'TREND N/A'} · {selectedMarket?.structureBias || 'STRUCTURE N/A'}</small>
              </div>
              <div className="chart-control-row">
                {TIMEFRAMES.map(([value, label]) => <button key={value} className={value === timeframe ? 'active' : ''} onClick={() => setTimeframe(value)}>{label}</button>)}
                {Object.entries(layers).map(([name, enabled]) => (
                  <button key={name} className={enabled ? 'active layer' : 'layer'} onClick={() => setLayers((current) => ({ ...current, [name]: !enabled }))}>{name}</button>
                ))}
                <button onClick={() => void loadCandles(false)}>↻</button>
              </div>
            </header>
            <div className="pro-chart-statbar">
              <span>O {formatted.length ? price(formatted[formatted.length - 1].open, displaySymbol) : 'N/A'}</span>
              <span>H {formatted.length ? price(formatted[formatted.length - 1].high, displaySymbol) : 'N/A'}</span>
              <span>L {formatted.length ? price(formatted[formatted.length - 1].low, displaySymbol) : 'N/A'}</span>
              <span>C {price(latestPrice, displaySymbol)}</span>
              <strong>{formatted.length ? `${formatted.length} OANDA CANDLES` : 'DATA N/A'}</strong>
            </div>
            <div className="chart-frame pro-chart-frame">
              {finite(latestPrice) && latestPrice > 0 && <div className="chart-price-tag">{price(latestPrice, displaySymbol)}</div>}
              <div className="chart-canvas" ref={chartContainerRef} />
              {displayedChartError && <div className="chart-empty">{displayedChartError}</div>}
            </div>
          </article>

          <section className="scenario-grid">
            <ScenarioCard title="CORSIA MAIN" lane={selectedPair?.main} pair={selectedPair} symbol={displaySymbol} stopLoss={mainScenarioStop} takeProfit={mainScenarioTakeProfit} />
            <ScenarioCard title="CORSIA MIRROR / INVERSE" lane={selectedPair?.inverse} pair={selectedPair} symbol={displaySymbol} stopLoss={inverseScenarioStop} takeProfit={inverseScenarioTakeProfit} />
          </section>

          <section className="cockpit-panel final-decision-panel">
            <span>DECISIONE FINALE</span>
            <strong>{selectedOperationalLane?.action || 'HOLD'}</strong>
            <small>{displaySymbol === 'XAUUSD' ? 'ANALISI MAIN · NESSUN ORDINE' : `CORSIA ${status?.liveExecutionVariant || 'N/A'} · NESSUN DOPPIO ORDINE`}</small>
          </section>

          <section className="cockpit-panel target-ladder-panel">
            <header className="cockpit-panel__header">
              <div><span>STRUCTURAL TARGET LADDER</span><h2>TP1 · TP2 · TP3</h2></div>
              <b>{displaySymbol === 'XAUUSD' ? 'ANALYSIS ONLY' : 'REAL LEVELS ONLY'}</b>
            </header>
            <div className="target-ladder-grid">
              {[xauMarket?.resistanceLevels?.[0], xauMarket?.resistanceLevels?.[1], xauMarket?.resistanceLevels?.[2]].map((level: number | undefined, index: number) => (
                <div key={`tp-${index + 1}`}><span>TP{index + 1}</span><strong>{displaySymbol === 'XAUUSD' ? price(level, displaySymbol) : 'N/A'}</strong><small>{displaySymbol === 'XAUUSD' ? 'struttura / liquidità OANDA' : 'non configurato per Forex'}</small></div>
              ))}
            </div>
          </section>

          <section className="cockpit-panel mtf-command-strip">
            <header className="cockpit-panel__header">
              <div><span>MULTI-TIMEFRAME</span><h2>ALIGNMENT</h2></div>
              <b>{displayedIntelligence ? `${displayedIntelligence.availableFrames}/4 · ${displayedIntelligence.consensus}` : 'N/A'}</b>
            </header>
            <div>
              {(displayedIntelligence?.frames || []).map((frame: any) => (
                <article key={frame.timeframe}>
                  <span>{frame.timeframe}</span>
                  <strong className={frame.direction === 'BULLISH' ? 'positive' : frame.direction === 'BEARISH' ? 'negative' : 'neutral'}>{frame.available ? frame.direction : 'N/A'}</strong>
                  <small>{frame.available ? `${frame.structure || 'N/A'} · ALIGN ${finite(frame.alignmentScore) ? `${Math.round(frame.alignmentScore)}/100` : 'N/A'}` : frame.reason || 'N/A'}</small>
                </article>
              ))}
              {!displayedIntelligence && <div className="dense-empty">{displayedIntelligenceError || 'MTF DATA N/A'}</div>}
            </div>
          </section>
        </main>

        <aside className="structure-rail">
          <article className="cockpit-panel xau-structure-panel">
            <header className="cockpit-panel__header">
              <div><span>XAUUSD GOLD</span><h2>{price(xauPrice, xauSymbol)}</h2></div>
              <b>ANALYSIS ONLY</b>
            </header>
            <div className="xau-rail-targets">
              <div><span>Direction</span><strong>{xauPair?.main?.action || 'N/A'}</strong></div>
              <div><span>Setup score</span><strong>{setupScoreText(xauPair?.main)}</strong></div>
              <div><span>Structure</span><strong>{xauMarket?.structureBias || 'N/A'}</strong></div>
              <div><span>Trend</span><strong>{xauMarket?.trend || 'N/A'}</strong></div>
            </div>
            <section>
              <h3>STRUTTURA MERCATO</h3>
              <p>{xauPair?.main?.reasoning || 'DATI STRUTTURALI NON DISPONIBILI'}</p>
            </section>
            <section>
              <h3>LIVELLI CHIAVE</h3>
              <dl className="key-level-list">
                <div><dt>Swing high</dt><dd>{price(xauMarket?.swingHigh, xauSymbol)}</dd></div>
                <div><dt>Swing low</dt><dd>{price(xauMarket?.swingLow, xauSymbol)}</dd></div>
                {(xauMarket?.resistanceLevels || []).slice(0, 3).map((level: number, index: number) => <div key={`r-${level}`}><dt>Resistance R{index + 1}</dt><dd>{price(level, xauSymbol)}</dd></div>)}
                {(xauMarket?.supportLevels || []).slice(0, 3).map((level: number, index: number) => <div key={`s-${level}`}><dt>Support S{index + 1}</dt><dd>{price(level, xauSymbol)}</dd></div>)}
              </dl>
            </section>
          </article>

          <article className="cockpit-panel active-trade-proof">
            <header className="cockpit-panel__header"><div><span>SELECTED SYMBOL</span><h2>TRADE PROOF</h2></div><b>{displayMode}</b></header>
            {selectedOpenTrade ? (
              <dl>
                <div><dt>Trade ID</dt><dd>{selectedOpenTrade.oandaTradeId || selectedOpenTrade.signalId || 'N/A'}</dd></div>
                <div><dt>Side</dt><dd>{selectedOpenTrade.side}</dd></div>
                <div><dt>Entry</dt><dd>{price(selectedOpenTrade.entryPrice, displaySymbol)}</dd></div>
                <div><dt>SL</dt><dd>{price(selectedOpenTrade.stopLoss, displaySymbol)}</dd></div>
                <div><dt>TP</dt><dd>{price(selectedOpenTrade.takeProfit, displaySymbol)}</dd></div>
                <div><dt>Source</dt><dd>{selectedOpenTrade.source}</dd></div>
              </dl>
            ) : <div className="dense-empty">{tradeLedgerAvailable ? 'NESSUNA POSIZIONE SELEZIONATA' : 'LEDGER N/A'}</div>}
          </article>
        </aside>
      </section>

      <footer className="trading-room-status">
        <span>MODE <b>{displayMode}</b></span>
        <span>OANDA <b>{status?.oandaConnected ? 'CONNECTED' : 'DISCONNECTED'}</b></span>
        <span>FEED <b>{status?.priceFeedStatus || 'N/A'}</b></span>
        <span>LAST TICK <b>{status?.lastPriceAt ? dateTime(status.lastPriceAt) : 'N/A'}</b></span>
      </footer>
    </div>
  );
}
