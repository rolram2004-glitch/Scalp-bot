import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  CandlestickData,
  createChart,
  CrosshairMode,
  ISeriesApi,
  LineStyle,
  UTCTimestamp
} from 'lightweight-charts';
import { fetchCandles } from '../services/api';
import { ChartPriceLine, ChartSignalMarker } from './RealMiniChart';

interface ParsedBar {
  candle: CandlestickData<UTCTimestamp>;
  volume: number;
}

interface HoverBar {
  time: UTCTimestamp;
  open: number;
  high: number;
  low: number;
  close: number;
}

function compactSymbol(value: unknown) {
  return String(value || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function price(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed.toFixed(3) : 'N/A';
}

function utcTime(value: unknown) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds)) return 'N/A';
  return new Date(seconds * 1000).toLocaleString(undefined, {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
    timeZoneName: 'short'
  });
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

export function ProfessionalXauChart({
  symbol = 'XAUUSD',
  timeframe = 'M5',
  showEma = true,
  showVolume = true,
  priceLines = [],
  markers = [],
  visibleBars = 110
}: {
  symbol?: string;
  timeframe?: string;
  showEma?: boolean;
  showVolume?: boolean;
  priceLines?: ChartPriceLine[];
  markers?: ChartSignalMarker[];
  visibleBars?: number;
}) {
  const normalized = compactSymbol(symbol);
  const requestKey = `${normalized}:${timeframe}`;
  const [candles, setCandles] = useState<any[]>([]);
  const [datasetKey, setDatasetKey] = useState('');
  const [error, setError] = useState('');
  const [hover, setHover] = useState<HoverBar | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<ReturnType<typeof createChart> | null>(null);
  const seriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const ema20Ref = useRef<ISeriesApi<'Line'> | null>(null);
  const ema50Ref = useRef<ISeriesApi<'Line'> | null>(null);
  const ema200Ref = useRef<ISeriesApi<'Line'> | null>(null);
  const priceLineRefs = useRef<any[]>([]);
  const visibleDatasetRef = useRef('');
  const requestRef = useRef(0);

  const load = useCallback(async (clear = false) => {
    const requestId = ++requestRef.current;
    if (clear) {
      setCandles([]);
      setDatasetKey(requestKey);
      setError('');
      setHover(null);
    }
    if (!normalized) {
      setCandles([]);
      setDatasetKey(requestKey);
      setError('STRUMENTO NON DISPONIBILE');
      return;
    }
    try {
      const data = await fetchCandles(normalized, timeframe, 320);
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

  const parsed = useMemo<ParsedBar[]>(() => {
    if (datasetKey !== requestKey) return [];
    return candles.flatMap((candle) => {
      const timestamp = Math.floor(Date.parse(String(candle?.time || '')) / 1000);
      const open = Number(candle?.mid?.o);
      const high = Number(candle?.mid?.h);
      const low = Number(candle?.mid?.l);
      const close = Number(candle?.mid?.c);
      const volume = Number(candle?.volume);
      if (![timestamp, open, high, low, close].every(Number.isFinite) || low <= 0 || high < low) return [];
      return [{
        candle: {
          time: timestamp as UTCTimestamp,
          open,
          high,
          low,
          close
        },
        volume: Number.isFinite(volume) && volume >= 0 ? volume : 0
      }];
    });
  }, [candles, datasetKey, requestKey]);

  const formatted = useMemo(() => parsed.map((item) => item.candle), [parsed]);
  const volumeData = useMemo(() => parsed.map(({ candle, volume }) => ({
    time: candle.time,
    value: volume,
    color: candle.close >= candle.open ? 'rgba(30, 211, 145, .24)' : 'rgba(255, 76, 112, .24)'
  })), [parsed]);

  useEffect(() => {
    if (!containerRef.current) return;
    const container = containerRef.current;
    const chart = createChart(container, {
      width: container.clientWidth,
      height: container.clientHeight || 520,
      layout: {
        background: { color: '#050b14' },
        textColor: '#718198',
        fontFamily: 'Inter, ui-sans-serif, system-ui, -apple-system, sans-serif',
        fontSize: 11
      },
      watermark: {
        visible: true,
        text: 'XAUUSD · OANDA',
        color: 'rgba(219, 164, 64, .055)',
        fontSize: 44,
        horzAlign: 'center',
        vertAlign: 'center'
      },
      grid: {
        vertLines: { color: 'rgba(67, 85, 112, .13)', style: LineStyle.Dotted },
        horzLines: { color: 'rgba(67, 85, 112, .15)', style: LineStyle.Dotted }
      },
      rightPriceScale: {
        borderColor: '#1a2a40',
        scaleMargins: { top: 0.08, bottom: 0.2 },
        entireTextOnly: true
      },
      timeScale: {
        borderColor: '#1a2a40',
        timeVisible: true,
        secondsVisible: false,
        rightOffset: 6,
        barSpacing: 7,
        minBarSpacing: 2,
        fixLeftEdge: true
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: {
          color: 'rgba(138, 160, 190, .55)',
          width: 1,
          style: LineStyle.Dashed,
          labelBackgroundColor: '#1a2940'
        },
        horzLine: {
          color: 'rgba(138, 160, 190, .55)',
          width: 1,
          style: LineStyle.Dashed,
          labelBackgroundColor: '#1a2940'
        }
      },
      handleScroll: true,
      handleScale: true,
      kineticScroll: { mouse: true, touch: true }
    });
    const series = chart.addCandlestickSeries({
      upColor: '#1ed391',
      downColor: '#ff4c70',
      borderUpColor: '#1ed391',
      borderDownColor: '#ff4c70',
      wickUpColor: '#60e6b3',
      wickDownColor: '#ff8399',
      priceLineVisible: true,
      priceLineColor: '#d6a13e',
      priceLineStyle: LineStyle.Dotted,
      lastValueVisible: true,
      priceFormat: { type: 'price', precision: 3, minMove: 0.001 }
    });
    const volume = chart.addHistogramSeries({
      priceScaleId: 'volume',
      priceFormat: { type: 'volume' },
      lastValueVisible: false,
      priceLineVisible: false
    });
    chart.priceScale('volume').applyOptions({
      scaleMargins: { top: 0.82, bottom: 0 }
    });
    const ema20 = chart.addLineSeries({
      color: '#42c8ff',
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false
    });
    const ema50 = chart.addLineSeries({
      color: '#9a76ff',
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false
    });
    const ema200 = chart.addLineSeries({
      color: '#e2a93f',
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false
    });
    const crosshairHandler = (param: any) => {
      const bar = param?.seriesData?.get(series);
      if (bar && Number.isFinite(bar.open) && Number.isFinite(bar.close)) {
        setHover({
          time: bar.time,
          open: bar.open,
          high: bar.high,
          low: bar.low,
          close: bar.close
        });
      } else {
        setHover(null);
      }
    };
    chart.subscribeCrosshairMove(crosshairHandler);
    chartRef.current = chart;
    seriesRef.current = series;
    volumeRef.current = volume;
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
      chart.unsubscribeCrosshairMove(crosshairHandler);
      chart.remove();
      chartRef.current = null;
      seriesRef.current = null;
      volumeRef.current = null;
      ema20Ref.current = null;
      ema50Ref.current = null;
      ema200Ref.current = null;
      priceLineRefs.current = [];
      visibleDatasetRef.current = '';
    };
  }, []);

  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    series.setData(formatted);
    volumeRef.current?.setData(showVolume ? volumeData : []);
    ema20Ref.current?.setData(showEma ? emaData(formatted, 20) : []);
    ema50Ref.current?.setData(showEma ? emaData(formatted, 50) : []);
    ema200Ref.current?.setData(showEma ? emaData(formatted, 200) : []);
    if (formatted.length > 0 && visibleDatasetRef.current !== requestKey) {
      chartRef.current?.timeScale().setVisibleLogicalRange({
        from: Math.max(0, formatted.length - visibleBars),
        to: formatted.length + 5
      });
      visibleDatasetRef.current = requestKey;
    }
  }, [formatted, requestKey, showEma, showVolume, visibleBars, volumeData]);

  useEffect(() => {
    const series = seriesRef.current;
    if (!series) return;
    priceLineRefs.current.forEach((line) => {
      try { series.removePriceLine(line); } catch (_error) { /* chart refreshed */ }
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
  }, [formatted, priceLines]);

  useEffect(() => {
    const series = seriesRef.current;
    if (!series || formatted.length === 0) return;
    const candleTimes = new Set(formatted.map((item) => Number(item.time)));
    const chartMarkers = markers.flatMap((marker) => {
      const markerTime = Math.floor(Date.parse(marker.time) / 1000);
      if (!Number.isFinite(markerTime) || !candleTimes.has(markerTime)) return [];
      return [{
        time: markerTime as UTCTimestamp,
        position: marker.side === 'BUY' ? 'belowBar' as const : 'aboveBar' as const,
        color: marker.side === 'BUY' ? '#1ed391' : '#ff4c70',
        shape: marker.side === 'BUY' ? 'arrowUp' as const : 'arrowDown' as const,
        text: marker.label
      }];
    });
    series.setMarkers(chartMarkers);
  }, [formatted, markers]);

  const latest = formatted.length > 0 ? formatted[formatted.length - 1] : undefined;
  const displayed = hover || latest;
  const change = displayed && displayed.open > 0
    ? ((displayed.close - displayed.open) / displayed.open) * 100
    : undefined;
  const loading = datasetKey !== requestKey && !error;

  return (
    <div className="professional-xau-chart">
      <div className="professional-xau-chart__quote">
        <div className="professional-xau-chart__instrument">
          <i />
          <span><strong>{normalized || 'N/A'}</strong><small>{timeframe} · OANDA</small></span>
        </div>
        <div className="professional-xau-chart__ohlc">
          <span>O <b>{price(displayed?.open)}</b></span>
          <span>H <b>{price(displayed?.high)}</b></span>
          <span>L <b>{price(displayed?.low)}</b></span>
          <span>C <b>{price(displayed?.close)}</b></span>
          <strong className={change === undefined ? 'neutral' : change >= 0 ? 'positive' : 'negative'}>
            {change === undefined ? 'N/A' : `${change >= 0 ? '+' : ''}${change.toFixed(3)}%`}
          </strong>
        </div>
        <div className="professional-xau-chart__legend">
          {showEma && <><span className="ema20">EMA 20</span><span className="ema50">EMA 50</span><span className="ema200">EMA 200</span></>}
          {showVolume && <span className="volume">VOLUME</span>}
        </div>
      </div>

      <div className="professional-xau-chart__canvas" ref={containerRef} />

      <div className="professional-xau-chart__tape">
        <span><i className="live" /> REAL OANDA CANDLES</span>
        <span>{formatted.length || 0} BARS</span>
        <span>{utcTime(displayed?.time)}</span>
        <span>SCROLL · ZOOM · CROSSHAIR</span>
      </div>

      {(error || loading) && (
        <div className="professional-xau-chart__empty">
          {error || 'CARICAMENTO CANDELE OANDA…'}
        </div>
      )}
    </div>
  );
}
