import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CandlestickData, createChart, HistogramData, ISeriesApi, LineStyle, UTCTimestamp } from 'lightweight-charts';
import { fetchCandles } from '../services/api';

export interface ChartPriceLine {
  price: number;
  label: string;
  color: string;
  style?: 'solid' | 'dashed' | 'dotted';
}

export interface ChartSignalMarker {
  time: string;
  side: 'BUY' | 'SELL';
  label: string;
}

function compactSymbol(value: unknown) {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function formatPrice(value: number | undefined, symbol: string) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return 'N/A';
  return value.toFixed(symbol.includes('JPY') || symbol.includes('XAU') ? 3 : 5);
}

function timeframeSeconds(value: string) {
  const normalized = String(value || '').toUpperCase();
  const amount = Number(normalized.slice(1)) || 1;
  if (normalized.startsWith('S')) return amount;
  if (normalized.startsWith('M')) return amount * 60;
  if (normalized.startsWith('H')) return amount * 60 * 60;
  if (normalized.startsWith('D')) return amount * 24 * 60 * 60;
  return 5 * 60;
}

function emaData(candles: CandlestickData<UTCTimestamp>[], period: number) {
  if (!candles.length) return [];
  const multiplier = 2 / (period + 1);
  let value = candles[0].close;
  return candles.map((candle) => {
    value = candle.close * multiplier + value * (1 - multiplier);
    return { time: candle.time, value };
  });
}

export function RealMiniChart({
  symbol,
  timeframe = 'M5',
  showEma = false,
  priceLines = [],
  markers = []
}: {
  symbol?: string;
  timeframe?: string;
  showEma?: boolean;
  priceLines?: ChartPriceLine[];
  markers?: ChartSignalMarker[];
}) {
  const normalized = compactSymbol(symbol);
  const requestKey = `${normalized}:${timeframe}`;
  const [candles, setCandles] = useState<any[]>([]);
  const [datasetKey, setDatasetKey] = useState('');
  const [error, setError] = useState('');
  const [cursorBar, setCursorBar] = useState<CandlestickData<UTCTimestamp> | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<ReturnType<typeof createChart> | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const ema20Ref = useRef<ISeriesApi<'Line'> | null>(null);
  const ema50Ref = useRef<ISeriesApi<'Line'> | null>(null);
  const ema200Ref = useRef<ISeriesApi<'Line'> | null>(null);
  const volumeRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const priceLineRefs = useRef<any[]>([]);
  const requestRef = useRef(0);

  const load = useCallback(async (clear = false) => {
    const requestId = ++requestRef.current;
    if (clear) {
      setCandles([]);
      setDatasetKey(requestKey);
      setError('');
    }
    if (!normalized) {
      setCandles([]);
      setDatasetKey(requestKey);
      setError('STRUMENTO NON DISPONIBILE');
      return;
    }
    try {
      const data = await fetchCandles(normalized, timeframe, 180);
      if (requestId !== requestRef.current) return;
      setCandles(Array.isArray(data) ? data : []);
      setDatasetKey(requestKey);
      setError(Array.isArray(data) && data.length > 0 ? '' : 'CANDELE OANDA NON DISPONIBILI');
    } catch (_error) {
      if (requestId !== requestRef.current) return;
      setCandles([]);
      setDatasetKey(requestKey);
      setError('CANDELE OANDA NON DISPONIBILI');
    }
  }, [normalized, requestKey, timeframe]);

  useEffect(() => {
    void load(true);
    const timer = window.setInterval(() => void load(false), 30000);
    return () => {
      requestRef.current += 1;
      window.clearInterval(timer);
    };
  }, [load]);

  const formatted = useMemo<CandlestickData<UTCTimestamp>[]>(() => {
    if (datasetKey !== requestKey) return [];
    return candles.flatMap((candle) => {
      const timestamp = Math.floor(Date.parse(String(candle?.time || '')) / 1000);
      const open = Number(candle?.mid?.o);
      const high = Number(candle?.mid?.h);
      const low = Number(candle?.mid?.l);
      const close = Number(candle?.mid?.c);
      if (![timestamp, open, high, low, close].every(Number.isFinite) || low <= 0 || high < low) return [];
      return [{ time: timestamp as UTCTimestamp, open, high, low, close }];
    });
  }, [candles, datasetKey, requestKey]);

  const volumeData = useMemo<HistogramData<UTCTimestamp>[]>(() => {
    if (datasetKey !== requestKey) return [];
    return candles.flatMap((candle) => {
      const time = Math.floor(Date.parse(String(candle?.time || '')) / 1000);
      const open = Number(candle?.mid?.o);
      const close = Number(candle?.mid?.c);
      const value = Number(candle?.volume);
      if (![time, open, close, value].every(Number.isFinite) || value < 0) return [];
      return [{
        time: time as UTCTimestamp,
        value,
        color: close >= open ? 'rgba(72, 223, 152, 0.26)' : 'rgba(255, 113, 133, 0.25)'
      }];
    });
  }, [candles, datasetKey, requestKey]);

  useEffect(() => {
    if (!containerRef.current) return;
    const container = containerRef.current;
    const chart = createChart(container, {
      width: container.clientWidth,
      height: container.clientHeight || 320,
      layout: { background: { color: '#07101d' }, textColor: '#77879f' },
      grid: { vertLines: { color: '#101c2d' }, horzLines: { color: '#101c2d' } },
      rightPriceScale: { borderColor: '#1b2a40' },
      timeScale: { borderColor: '#1b2a40', timeVisible: true, secondsVisible: false },
      crosshair: {
        vertLine: { color: '#53647d', labelBackgroundColor: '#17243a' },
        horzLine: { color: '#53647d', labelBackgroundColor: '#17243a' }
      }
    });
    const series = chart.addCandlestickSeries({
      upColor: '#15d68f',
      downColor: '#ff4f78',
      borderVisible: false,
      wickUpColor: '#15d68f',
      wickDownColor: '#ff4f78'
    });
    const ema20 = chart.addLineSeries({
      color: '#4dd6ff',
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false
    });
    const ema50 = chart.addLineSeries({
      color: '#a855f7',
      lineWidth: 1,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false
    });
    const ema200 = chart.addLineSeries({
      color: '#f59e0b',
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false
    });
    const volume = chart.addHistogramSeries({
      color: 'rgba(99, 168, 255, 0.24)',
      priceFormat: { type: 'volume' },
      priceLineVisible: false,
      lastValueVisible: false,
      priceScaleId: ''
    });
    volume.priceScale().applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    const handleCrosshair = (param: any) => {
      const value = param?.seriesData?.get(series);
      if (value && Number.isFinite(value.open) && Number.isFinite(value.high) && Number.isFinite(value.low) && Number.isFinite(value.close)) {
        setCursorBar(value as CandlestickData<UTCTimestamp>);
      } else {
        setCursorBar(null);
      }
    };
    chart.subscribeCrosshairMove(handleCrosshair);
    chartRef.current = chart;
    seriesRef.current = series;
    ema20Ref.current = ema20;
    ema50Ref.current = ema50;
    ema200Ref.current = ema200;
    volumeRef.current = volume;
    const observer = new ResizeObserver(() => {
      const width = container.clientWidth;
      const height = container.clientHeight;
      if (width > 0 && height > 0) chart.applyOptions({ width, height });
    });
    observer.observe(container);
    return () => {
      chart.unsubscribeCrosshairMove(handleCrosshair);
      observer.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      ema20Ref.current = null;
      ema50Ref.current = null;
      ema200Ref.current = null;
      volumeRef.current = null;
      priceLineRefs.current = [];
    };
  }, []);

  useEffect(() => {
    if (!seriesRef.current) return;
    seriesRef.current.setData(formatted);
    ema20Ref.current?.setData(showEma ? emaData(formatted, 20) : []);
    ema50Ref.current?.setData(showEma ? emaData(formatted, 50) : []);
    ema200Ref.current?.setData(showEma ? emaData(formatted, 200) : []);
    volumeRef.current?.setData(volumeData);
    if (formatted.length > 0) chartRef.current?.timeScale().fitContent();
  }, [formatted, requestKey, showEma, volumeData]);

  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    priceLineRefs.current.forEach((line) => {
      try { series.removePriceLine(line); } catch (_error) { /* chart already refreshed */ }
    });
    priceLineRefs.current = priceLines
      .filter((line) => Number.isFinite(line.price) && line.price > 0)
      .map((line) => series.createPriceLine({
        price: line.price,
        color: line.color,
        lineWidth: line.label.includes('ENTRY') ? 2 : 1,
        lineStyle: line.style === 'solid'
          ? LineStyle.Solid
          : line.style === 'dotted'
            ? LineStyle.Dotted
            : LineStyle.Dashed,
        axisLabelVisible: true,
        title: line.label
      }));
  }, [priceLines, formatted]);

  useEffect(() => {
    const series = seriesRef.current;
    if (!series || formatted.length === 0) return;
    const candleTimes = formatted.map((item) => Number(item.time));
    const chartMarkers = markers.flatMap((marker) => {
      const markerTime = Math.floor(Date.parse(marker.time) / 1000);
      if (!Number.isFinite(markerTime)) return [];
      let index = -1;
      for (let candleIndex = 0; candleIndex < candleTimes.length; candleIndex += 1) {
        if (candleTimes[candleIndex] <= markerTime) index = candleIndex;
        else break;
      }
      if (index < 0 || Math.abs(markerTime - candleTimes[index]) > timeframeSeconds(timeframe) * 2) return [];
      return [{
        time: formatted[index].time,
        position: marker.side === 'BUY' ? 'belowBar' as const : 'aboveBar' as const,
        color: marker.side === 'BUY' ? '#15d68f' : '#ff4f78',
        shape: marker.side === 'BUY' ? 'arrowUp' as const : 'arrowDown' as const,
        text: marker.label
      }];
    });
    series.setMarkers(chartMarkers);
  }, [formatted, markers, timeframe]);

  const latestBar = cursorBar || (formatted.length > 0 ? formatted[formatted.length - 1] : undefined);
  const latest = latestBar?.close;
  const visibleError = datasetKey === requestKey ? error : '';

  return (
    <div className="real-mini-chart">
      <div className="real-mini-chart__meta">
        <div className="real-mini-chart__identity">
          <strong>{normalized || 'N/A'}</strong>
          <span>{timeframe}</span>
          {showEma && <span className="real-mini-chart__algo">EMA 20 · 50 · 200 · VOLUME</span>}
        </div>
        <div className="real-mini-chart__ohlc">
          <span>O <b>{formatPrice(latestBar?.open, normalized)}</b></span>
          <span>H <b>{formatPrice(latestBar?.high, normalized)}</b></span>
          <span>L <b>{formatPrice(latestBar?.low, normalized)}</b></span>
          <span>C <b>{formatPrice(latestBar?.close, normalized)}</b></span>
        </div>
        <strong className="real-mini-chart__last">{formatPrice(latest, normalized)}</strong>
      </div>
      <div className="real-mini-chart__canvas" ref={containerRef} />
      {visibleError && <div className="real-mini-chart__empty">{visibleError}</div>}
    </div>
  );
}

export function RealSparkline({ values, tone = 'green' }: { values: number[]; tone?: 'green' | 'red' | 'blue' | 'amber' | 'purple' }) {
  const clean = values.filter((value) => Number.isFinite(value));
  if (clean.length < 2) return <span className="sparkline-empty">N/A</span>;
  const minimum = Math.min(...clean);
  const maximum = Math.max(...clean);
  const range = maximum - minimum || 1;
  const points = clean.map((value, index) => {
    const x = (index / Math.max(clean.length - 1, 1)) * 100;
    const y = 30 - ((value - minimum) / range) * 24;
    return `${x},${y}`;
  }).join(' ');
  return (
    <svg className={`real-sparkline ${tone}`} viewBox="0 0 100 34" preserveAspectRatio="none" aria-label="Andamento da dati reali">
      <polyline points={points} fill="none" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}
