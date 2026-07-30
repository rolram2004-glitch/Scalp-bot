import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CandlestickData, createChart, ISeriesApi, LineStyle, UTCTimestamp } from 'lightweight-charts';
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
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<ReturnType<typeof createChart> | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const ema20Ref = useRef<ISeriesApi<'Line'> | null>(null);
  const ema50Ref = useRef<ISeriesApi<'Line'> | null>(null);
  const ema200Ref = useRef<ISeriesApi<'Line'> | null>(null);
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
    chartRef.current = chart;
    seriesRef.current = series;
    ema20Ref.current = ema20;
    ema50Ref.current = ema50;
    ema200Ref.current = ema200;
    const observer = new ResizeObserver(() => {
      const width = container.clientWidth;
      const height = container.clientHeight;
      if (width > 0 && height > 0) chart.applyOptions({ width, height });
    });
    observer.observe(container);
    return () => {
      observer.disconnect();
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      ema20Ref.current = null;
      ema50Ref.current = null;
      ema200Ref.current = null;
      priceLineRefs.current = [];
    };
  }, []);

  useEffect(() => {
    if (!seriesRef.current) return;
    seriesRef.current.setData(formatted);
    ema20Ref.current?.setData(showEma ? emaData(formatted, 20) : []);
    ema50Ref.current?.setData(showEma ? emaData(formatted, 50) : []);
    ema200Ref.current?.setData(showEma ? emaData(formatted, 200) : []);
    if (formatted.length > 0) chartRef.current?.timeScale().fitContent();
  }, [formatted, requestKey, showEma]);

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
        lineWidth: line.label.endsWith('ENTRY') ? 2 : 1,
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
      const index = candleTimes.indexOf(markerTime);
      if (index < 0) return [];
      return [{
        time: formatted[index].time,
        position: marker.side === 'BUY' ? 'belowBar' as const : 'aboveBar' as const,
        color: marker.side === 'BUY' ? '#15d68f' : '#ff4f78',
        shape: marker.side === 'BUY' ? 'arrowUp' as const : 'arrowDown' as const,
        text: marker.label
      }];
    });
    series.setMarkers(chartMarkers);
  }, [formatted, markers]);

  const latest = formatted.length > 0 ? formatted[formatted.length - 1].close : undefined;
  const visibleError = datasetKey === requestKey ? error : '';

  return (
    <div className="real-mini-chart">
      <div className="real-mini-chart__meta">
        <strong>{normalized || 'N/A'}</strong>
        <span>{timeframe}</span>
        {showEma && <span className="real-mini-chart__algo">EMA 20 · 50 · 200</span>}
        <b>{formatPrice(latest, normalized)}</b>
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
