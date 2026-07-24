import { useEffect, useMemo, useRef, useState } from 'react';
import { createChart, CrosshairMode, LineStyle, ISeriesApi, CandlestickData, LineData, UTCTimestamp } from 'lightweight-charts';
import { fetchCandles, fetchIntelligence } from '../services/api';

const DEFAULT_SYMBOLS = ['XAUUSD', 'EURUSD', 'GBPUSD', 'USDJPY', 'USDCAD', 'AUDUSD', 'USDCHF', 'NZDUSD', 'GBPJPY', 'EURJPY', 'AUDJPY', 'NZDJPY', 'EURGBP', 'EURAUD', 'EURCAD', 'GBPAUD'];
const TIMEFRAMES = [['M1', '1m'], ['M5', '5m'], ['M15', '15m'], ['H1', '1h']];

function compactSymbol(symbol: unknown) {
  return String(symbol || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function finite(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function price(value: unknown, symbol: string) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 'N/A';
  return parsed.toFixed(symbol.includes('JPY') || symbol.includes('XAU') ? 3 : 5);
}

function dateTime(value?: string) {
  if (!value) return 'N/A';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 'N/A' : parsed.toLocaleString();
}

function quoteCurrency(symbol?: string) {
  const normalized = compactSymbol(symbol);
  return normalized.length === 6 ? normalized.slice(-3) : undefined;
}

function tradePnl(trade: any) {
  if (!finite(trade?.pnl)) return 'N/A';
  const verifiedLive = trade.source === 'OANDA' && trade.verificationStatus === 'VERIFIED';
  const paper = String(trade.source || '').startsWith('PAPER');
  if (!verifiedLive && !paper) return 'N/A';
  const currency = verifiedLive ? trade.accountCurrency : trade.pnlCurrency || quoteCurrency(trade.symbol);
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

export function ChartPage({ status, marketData }: { status: any; marketData: Record<string, any> }) {
  const configuredSymbols = Array.isArray(status?.symbols) && status.symbols.length > 0
    ? status.symbols.map(compactSymbol)
    : DEFAULT_SYMBOLS;
  const [symbol, setSymbol] = useState('XAUUSD');
  const [timeframe, setTimeframe] = useState('M5');
  const [candles, setCandles] = useState<any[]>([]);
  const [chartError, setChartError] = useState('');
  const [intelligence, setIntelligence] = useState<any>(null);
  const [intelligenceError, setIntelligenceError] = useState('');
  const [layers, setLayers] = useState({ trades: true, structure: true, levels: true });
  const chartContainerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<ReturnType<typeof createChart> | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const emaSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);
  const priceLinesRef = useRef<any[]>([]);
  const displaySymbol = compactSymbol(symbol);
  const selectedMarket = marketData?.[displaySymbol] || marketData?.[`${displaySymbol.slice(0, 3)}_${displaySymbol.slice(3)}`];
  const selectedOpenTrades = (status?.openTrades || []).filter((trade: any) => compactSymbol(trade.symbol) === displaySymbol);
  const selectedClosedTrades = (status?.closedTrades || []).filter((trade: any) => compactSymbol(trade.symbol) === displaySymbol);
  const selectedHistory = [...selectedOpenTrades, ...selectedClosedTrades].slice(0, 12);

  const loadCandles = () => fetchCandles(displaySymbol, timeframe, 250)
    .then((data) => {
      setCandles(Array.isArray(data) ? data : []);
      setChartError(Array.isArray(data) && data.length > 0 ? '' : 'Candele OANDA non disponibili');
    })
    .catch(() => {
      setCandles([]);
      setChartError('Candele OANDA non disponibili');
    });

  useEffect(() => {
    let disposed = false;
    const refresh = () => fetchCandles(displaySymbol, timeframe, 250)
      .then((data) => {
        if (disposed) return;
        setCandles(Array.isArray(data) ? data : []);
        setChartError(Array.isArray(data) && data.length > 0 ? '' : 'Candele OANDA non disponibili');
      })
      .catch(() => {
        if (disposed) return;
        setCandles([]);
        setChartError('Candele OANDA non disponibili');
      });
    void refresh();
    const timer = window.setInterval(() => void refresh(), 15000);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [displaySymbol, timeframe]);

  useEffect(() => {
    let disposed = false;
    const refresh = () => fetchIntelligence(displaySymbol)
      .then((data) => {
        if (disposed) return;
        setIntelligence(data);
        setIntelligenceError('');
      })
      .catch(() => {
        if (disposed) return;
        setIntelligence(null);
        setIntelligenceError('Analisi multi-timeframe OANDA non disponibile');
      });
    void refresh();
    const timer = window.setInterval(() => void refresh(), 30000);
    return () => {
      disposed = true;
      window.clearInterval(timer);
    };
  }, [displaySymbol]);

  useEffect(() => {
    if (!chartContainerRef.current) return;
    const chart = createChart(chartContainerRef.current, {
      width: chartContainerRef.current.clientWidth,
      height: 500,
      layout: { background: { color: '#070b13' }, textColor: '#9aa7bd' },
      grid: { vertLines: { color: '#141b2a' }, horzLines: { color: '#141b2a' } },
      crosshair: { mode: CrosshairMode.Magnet },
      rightPriceScale: { borderColor: '#1e293b' },
      timeScale: { borderColor: '#1e293b', timeVisible: true, secondsVisible: false }
    });
    const candleSeries = chart.addCandlestickSeries({
      upColor: '#22c55e', downColor: '#ef476f', borderVisible: false,
      wickUpColor: '#22c55e', wickDownColor: '#ef476f'
    });
    const ema = chart.addLineSeries({ color: '#f7c948', lineWidth: 2, lineStyle: LineStyle.Solid, title: 'EMA20' });
    chartRef.current = chart;
    candleSeriesRef.current = candleSeries;
    emaSeriesRef.current = ema;
    const resize = () => chart.applyOptions({ width: chartContainerRef.current?.clientWidth || 0 });
    window.addEventListener('resize', resize);
    return () => {
      window.removeEventListener('resize', resize);
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      emaSeriesRef.current = null;
    };
  }, []);

  const formatted = useMemo(() => candles.flatMap((candle) => {
    const timestamp = Math.floor(Date.parse(String(candle?.time || '')) / 1000);
    const open = Number(candle?.mid?.o);
    const high = Number(candle?.mid?.h);
    const low = Number(candle?.mid?.l);
    const close = Number(candle?.mid?.c);
    if (![timestamp, open, high, low, close].every(Number.isFinite) || high < low || low <= 0) return [];
    return [{ time: timestamp as UTCTimestamp, open, high, low, close }];
  }), [candles]);

  useEffect(() => {
    const series = candleSeriesRef.current;
    if (!series || !emaSeriesRef.current) return;
    series.setData(formatted);
    emaSeriesRef.current.setData(emaSeries(formatted, 20));
    if (formatted.length > 0) chartRef.current?.timeScale().fitContent();

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
      [...(selectedMarket?.swingHighs || [])].forEach((swing: any) => {
        const time = containingCandleTime(formatted, swing.time);
        if (time) markers.push({ time, position: 'aboveBar', color: '#a78bfa', shape: 'circle', text: `SWING H ${price(swing.price, displaySymbol)}` });
      });
      [...(selectedMarket?.swingLows || [])].forEach((swing: any) => {
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
    const addLine = (value: unknown, color: string, title: string, style = LineStyle.Dashed) => {
      const parsed = Number(value);
      if (!Number.isFinite(parsed) || parsed <= 0) return;
      priceLinesRef.current.push(series.createPriceLine({ price: parsed, color, lineWidth: 1, lineStyle: style, axisLabelVisible: true, title }));
    };
    if (layers.trades) selectedOpenTrades.slice(0, 1).forEach((trade: any) => {
      addLine(trade.entryPrice, '#60a5fa', `ENTRY ${trade.side || ''}`, LineStyle.Solid);
      addLine(trade.stopLoss, '#ef476f', 'STOP');
      addLine(trade.takeProfit, '#22c55e', 'TAKE PROFIT');
    });
    if (layers.levels) {
      (selectedMarket?.supportLevels || []).slice(0, 3).forEach((level: number, index: number) => addLine(level, '#38bdf8', `SUPPORT ${index + 1}`, LineStyle.Dotted));
      (selectedMarket?.resistanceLevels || []).slice(0, 3).forEach((level: number, index: number) => addLine(level, '#a78bfa', `RESISTANCE ${index + 1}`, LineStyle.Dotted));
      addLine(selectedMarket?.fairValueGapZone?.low, '#f59e0b', 'FVG LOW', LineStyle.Dotted);
      addLine(selectedMarket?.fairValueGapZone?.high, '#f59e0b', 'FVG HIGH', LineStyle.Dotted);
    }
  }, [formatted, layers, selectedHistory, selectedMarket, selectedOpenTrades, displaySymbol]);

  const latestPrice = formatted.length > 0 ? formatted[formatted.length - 1].close : undefined;

  return (
    <div className="chart-page">
      <section className="page-hero">
        <div><p className="eyebrow">Real OANDA chart</p><h1>Prezzo, struttura e operazioni sul loro timestamp originale.</h1></div>
        <div className={formatted.length > 0 ? 'system-active' : 'system-warning'}>{formatted.length > 0 ? `${formatted.length} OANDA CANDLES` : 'DATA UNAVAILABLE'}</div>
      </section>

      <section className="chart-workspace">
        <div className="symbol-tabs">
          {configuredSymbols.map((item: string) => <button key={item} className={item === displaySymbol ? 'chip active' : 'chip'} onClick={() => setSymbol(item)}>{item}</button>)}
        </div>
        <div className="time-tabs">
          {TIMEFRAMES.map(([value, label]) => <button key={value} className={value === timeframe ? 'time-chip active' : 'time-chip'} onClick={() => setTimeframe(value)}>{label}</button>)}
          <button className="time-chip ghost" onClick={() => void loadCandles()}>REFRESH</button>
        </div>
        <div className="chart-layer-controls">
          {Object.entries(layers).map(([name, enabled]) => (
            <button key={name} className={enabled ? 'time-chip active' : 'time-chip'} onClick={() => setLayers((current) => ({ ...current, [name]: !enabled }))}>
              {name.toUpperCase()} {enabled ? 'ON' : 'OFF'}
            </button>
          ))}
        </div>
        <div className="chart-statbar">
          <strong>{displaySymbol}</strong>
          <span>{timeframe}</span>
          <span>Price {price(latestPrice, displaySymbol)}</span>
          <span>{selectedOpenTrades.length} open</span>
          <span>{selectedClosedTrades.length} closed</span>
          <span>{selectedMarket?.structureSource || (formatted.length ? 'OANDA_CANDLES' : 'N/A')}</span>
        </div>
        <div className="chart-frame">
          <div className="chart-price-tag">{price(latestPrice, displaySymbol)}</div>
          <div className="chart-canvas" ref={chartContainerRef} />
          {chartError && <div className="chart-empty">{chartError}</div>}
        </div>
      </section>

      <section className="panel analytics-card-wide">
        <div className="panel-title"><h2>Multi-timeframe intelligence</h2><span>{intelligence ? `${intelligence.availableFrames}/4 OANDA frames · ${intelligence.consensus}` : 'N/A'}</span></div>
        {intelligence ? (
          <div className="indicator-grid">
            {(intelligence.frames || []).map((frame: any) => (
              <div key={frame.timeframe}>
                <strong>{frame.timeframe} · {frame.available ? frame.direction : 'N/A'}</strong>
                <span>{frame.available ? `${frame.structure || 'N/A'} · BOS ${frame.bos || 'N/A'} · ${frame.alignmentScore ?? 'N/A'}%` : frame.reason || 'DATI NON DISPONIBILI'}</span>
              </div>
            ))}
          </div>
        ) : <div className="empty-state">{intelligenceError || 'DATI NON DISPONIBILI'}</div>}
      </section>

      <section className="panel chart-history-panel">
        <div className="panel-title"><h2>Operazioni {displaySymbol}</h2><span>timestamp non riposizionati</span></div>
        <div className="compact-history">
          {selectedHistory.length > 0 ? selectedHistory.map((trade: any) => (
            <div key={trade.id} className="compact-row">
              <span className={trade.side === 'BUY' ? 'win' : 'loss'}>{trade.side || 'N/A'}</span>
              <span>{dateTime(trade.openedAt)}</span>
              <span>@ {price(trade.entryPrice, displaySymbol)}</span>
              <span>{trade.source || 'N/A'} · {trade.verificationStatus || 'N/A'}</span>
              <strong>{tradePnl(trade)}</strong>
              <small>{trade.oandaTradeId ? `OANDA TRADE ID ${trade.oandaTradeId}` : trade.signalId || trade.id || 'N/A'}</small>
            </div>
          )) : <div className="empty-state">Nessuna operazione verificabile per questo strumento.</div>}
        </div>
      </section>
    </div>
  );
}
