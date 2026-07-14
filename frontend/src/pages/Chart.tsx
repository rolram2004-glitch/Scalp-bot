import { useEffect, useMemo, useRef, useState } from 'react';
import { createChart, CrosshairMode, LineStyle, ISeriesApi, CandlestickData, LineData, UTCTimestamp } from 'lightweight-charts';
import { fetchCandles } from '../services/api';

const SYMBOLS = ['XAUUSD', 'EURUSD', 'GBPUSD', 'USDJPY', 'GBPJPY', 'AUDUSD', 'EURJPY', 'USDCAD'];
const TIMEFRAMES = [
  ['M1', '1m'],
  ['M5', '5m'],
  ['M15', '15m'],
  ['H1', '1h']
];

function normalizeDisplaySymbol(symbol: string) {
  const cleaned = symbol.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return cleaned.length === 6 ? `${cleaned.slice(0, 3)}_${cleaned.slice(3)}` : symbol;
}

function price(value?: number) {
  return typeof value === 'number' ? value.toFixed(5) : '-';
}

function tradingViewSymbol(symbol: string) {
  if (symbol === 'XAUUSD') return 'OANDA%3AXAUUSD';
  return `OANDA%3A${symbol}`;
}

export function ChartPage({ status, marketData }: { status: any; marketData: Record<string, any>; }) {
  const [symbol, setSymbol] = useState('XAUUSD');
  const [timeframe, setTimeframe] = useState('M5');
  const [candles, setCandles] = useState<any[]>([]);
  const [chartError, setChartError] = useState('');
  const chartContainerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<ReturnType<typeof createChart> | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const smaSeriesRef = useRef<ISeriesApi<'Line'> | null>(null);

  const displaySymbol = useMemo(() => symbol.toUpperCase(), [symbol]);
  const oandaSymbol = useMemo(() => normalizeDisplaySymbol(symbol), [symbol]);
  const selectedOpenTrades = (status?.openTrades || []).filter((trade: any) => String(trade.symbol).replace(/[^A-Z0-9]/gi, '').toUpperCase() === displaySymbol);
  const selectedClosedTrades = (status?.closedTrades || []).filter((trade: any) => String(trade.symbol).replace(/[^A-Z0-9]/gi, '').toUpperCase() === displaySymbol);
  const selectedHistory = [...selectedOpenTrades, ...selectedClosedTrades].slice(0, 8);

  useEffect(() => {
    fetchCandles(symbol, timeframe)
      .then((data) => {
        setCandles(Array.isArray(data) ? data : []);
        setChartError('');
      })
      .catch(() => {
        setCandles([]);
        setChartError('Dati candele non disponibili');
      });
  }, [symbol, timeframe]);

  useEffect(() => {
    if (!chartContainerRef.current) return;

    if (chartRef.current) {
      chartRef.current.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      smaSeriesRef.current = null;
    }

    const chart = createChart(chartContainerRef.current, {
      width: chartContainerRef.current.clientWidth,
      height: 430,
      layout: {
        background: { color: '#070b13' },
        textColor: '#9aa7bd'
      },
      grid: {
        vertLines: { color: '#141b2a' },
        horzLines: { color: '#141b2a' }
      },
      crosshair: { mode: CrosshairMode.Magnet },
      rightPriceScale: { borderColor: '#1e293b' },
      timeScale: { borderColor: '#1e293b', timeVisible: true }
    });

    const candleSeries = chart.addCandlestickSeries({
      upColor: '#22c55e',
      downColor: '#ef476f',
      borderVisible: false,
      wickUpColor: '#22c55e',
      wickDownColor: '#ef476f'
    });
    const smaSeries = chart.addLineSeries({
      color: '#f7c948',
      lineWidth: 2,
      lineStyle: LineStyle.Solid
    });

    candleSeriesRef.current = candleSeries;
    smaSeriesRef.current = smaSeries;
    chartRef.current = chart;

    const handleResize = () => chart.applyOptions({ width: chartContainerRef.current?.clientWidth ?? 0 });
    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
    };
  }, []);

  useEffect(() => {
    if (!candleSeriesRef.current || !smaSeriesRef.current) return;

    const formatted: CandlestickData<UTCTimestamp>[] = candles.map((c) => ({
      time: Math.floor(new Date(c.time).getTime() / 1000) as UTCTimestamp,
      open: Number(c.mid.o),
      high: Number(c.mid.h),
      low: Number(c.mid.l),
      close: Number(c.mid.c)
    }));

    candleSeriesRef.current.setData(formatted);
    if (formatted.length > 0) chartRef.current?.timeScale().fitContent();

    const smaLength = 9;
    const smaData: LineData[] = formatted
      .map((point, idx, arr) => {
        if (idx < smaLength - 1) return null;
        const sum = arr.slice(idx - smaLength + 1, idx + 1).reduce((acc, value) => acc + value.close, 0);
        return { time: point.time, value: sum / smaLength };
      })
      .filter(Boolean) as LineData[];

    smaSeriesRef.current.setData(smaData);

    const recentSignals = selectedHistory.slice(0, 10);
    const markers = recentSignals.map((trade: any, index: number) => {
      const fallbackPoint = formatted[Math.max(0, formatted.length - 1 - index * 8)];
      const signalTime = Math.floor(new Date(trade.openedAt || Date.now()).getTime() / 1000) as UTCTimestamp;
      const minTime = formatted[0]?.time as number | undefined;
      const maxTime = formatted[formatted.length - 1]?.time as number | undefined;
      const time = minTime && maxTime && signalTime >= minTime && signalTime <= maxTime ? signalTime : fallbackPoint?.time;

      return {
        time,
        position: trade.side === 'BUY' ? 'belowBar' as const : 'aboveBar' as const,
        color: trade.side === 'BUY' ? '#22c55e' : '#ef476f',
        shape: trade.side === 'BUY' ? 'arrowUp' as const : 'arrowDown' as const,
        text: `${trade.side} ${trade.confidence || 72}%`
      };
    }).filter((marker: any) => marker.time);

    candleSeriesRef.current.setMarkers(markers);
  }, [candles, selectedHistory, displaySymbol]);

  const latestPrice = useMemo(() => {
    const market = marketData?.[displaySymbol] || marketData?.[oandaSymbol];
    if (market?.closePrice) return Number(market.closePrice).toFixed(5);
    if (candles.length) return Number(candles[candles.length - 1]?.mid?.c).toFixed(5);
    return '-';
  }, [marketData, displaySymbol, oandaSymbol, candles]);

  const pairPnl = selectedHistory.reduce((sum: number, trade: any) => sum + (trade.pnl || 0), 0);
  const pairWins = selectedClosedTrades.filter((trade: any) => (trade.pnl || 0) > 0).length;
  const pairWinRate = selectedClosedTrades.length ? Math.round((pairWins / selectedClosedTrades.length) * 100) : 0;

  return (
    <div className="chart-page">
      <section className="chart-workspace">
        <div className="symbol-tabs">
          {SYMBOLS.map((item) => (
            <button key={item} className={item === symbol ? 'chip active' : 'chip'} onClick={() => setSymbol(item)}>{item}</button>
          ))}
        </div>

        <div className="time-tabs">
          {TIMEFRAMES.map(([value, label]) => (
            <button key={value} className={value === timeframe ? 'time-chip active' : 'time-chip'} onClick={() => setTimeframe(value)}>{label}</button>
          ))}
          <button className="time-chip ghost" onClick={() => void fetchCandles(symbol, timeframe).then(setCandles)}>REFRESH</button>
        </div>

        <div className="chart-statbar">
          <strong>{displaySymbol}</strong>
          <span>{selectedOpenTrades.length} aperte</span>
          <span className={pairPnl >= 0 ? 'win' : 'loss'}>{pairPnl >= 0 ? '+' : '-'}${Math.abs(pairPnl).toFixed(2)}</span>
          <span>{pairWinRate}% win</span>
          <span>{selectedClosedTrades.length} chiuse</span>
          <span>{candles.length ? 'OANDA' : 'DATI NON DISP.'}</span>
        </div>

        <div className="chart-frame">
          <div className="chart-price-tag">{latestPrice}</div>
          <iframe
            className="tradingview-frame"
            title={`TradingView ${displaySymbol}`}
            src={`https://s.tradingview.com/widgetembed/?symbol=${tradingViewSymbol(displaySymbol)}&interval=${timeframe === 'H1' ? '60' : timeframe.replace('M', '')}&theme=dark&style=1&timezone=Europe%2FZurich&withdateranges=1&hide_side_toolbar=0&allow_symbol_change=0&save_image=0&studies=%5B%5D`}
          />
          <div className="chart-canvas" ref={chartContainerRef} />
          {chartError && <div className="chart-empty">{chartError}</div>}
        </div>

        <div className="chart-legend">
          <span><b className="dot open-dot" />APERTO</span>
          <span><b className="dot win-dot" />WIN</span>
          <span><b className="dot loss-dot" />LOSS</span>
          <span><b className="line buy-line" />BUY</span>
          <span><b className="line sell-line" />SELL</span>
        </div>
      </section>

      <section className="panel chart-history-panel">
        <div className="panel-title"><h2>Storico {displaySymbol}</h2><span>{selectedHistory.length} trade</span></div>
        <div className="compact-history">
          {selectedHistory.length > 0 ? selectedHistory.map((trade: any) => (
            <div key={trade.id} className="compact-row">
              <span className={trade.side === 'BUY' ? 'win' : 'loss'}>{trade.side}</span>
              <span>@ {price(trade.entryPrice)}</span>
              <strong className={(trade.pnl || 0) >= 0 ? 'win' : 'loss'}>{(trade.pnl || 0) >= 0 ? '+' : '-'}${Math.abs(trade.pnl || 0).toFixed(2)}</strong>
            </div>
          )) : <div className="empty-state">Nessun trade per questa coppia.</div>}
        </div>
      </section>
    </div>
  );
}
