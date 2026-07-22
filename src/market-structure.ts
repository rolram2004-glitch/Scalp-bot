export type StructureDirection = "BULLISH" | "BEARISH" | "RANGE";
export type BreakDirection = "BULLISH" | "BEARISH" | "NONE";

export interface PriceBar {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
  complete: boolean;
}

export interface SwingPoint {
  time: string;
  price: number;
  index: number;
}

export interface FairValueGap {
  direction: "BULLISH" | "BEARISH";
  low: number;
  high: number;
  time: string;
}

export interface MarketStructureAnalysis {
  source: "OANDA_CANDLES";
  candleCount: number;
  latestCandleTime?: string;
  structure: StructureDirection;
  bos: BreakDirection;
  choch: BreakDirection;
  liquiditySweep: BreakDirection;
  fvg?: FairValueGap;
  equalHigh?: number;
  equalLow?: number;
  swingHighs: SwingPoint[];
  swingLows: SwingPoint[];
  supportLevels: number[];
  resistanceLevels: number[];
  atr?: number;
  volumeRatio?: number;
}

function finite(value: unknown): number | undefined {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function parseOandaBars(candles: any[]): PriceBar[] {
  if (!Array.isArray(candles)) return [];

  return candles.flatMap((candle) => {
    const open = finite(candle?.mid?.o);
    const high = finite(candle?.mid?.h);
    const low = finite(candle?.mid?.l);
    const close = finite(candle?.mid?.c);
    const time = typeof candle?.time === "string" ? candle.time : "";

    if (!time || open === undefined || high === undefined || low === undefined || close === undefined) {
      return [];
    }
    if (high < low || open <= 0 || high <= 0 || low <= 0 || close <= 0) {
      return [];
    }

    const volume = finite(candle?.volume);
    return [{
      time,
      open,
      high,
      low,
      close,
      volume,
      complete: candle?.complete !== false
    }];
  });
}

function averageTrueRange(bars: PriceBar[], period = 14): number | undefined {
  if (bars.length < period + 1) return undefined;
  const values: number[] = [];

  for (let index = 1; index < bars.length; index += 1) {
    const current = bars[index];
    const previous = bars[index - 1];
    values.push(Math.max(
      current.high - current.low,
      Math.abs(current.high - previous.close),
      Math.abs(current.low - previous.close)
    ));
  }

  const sample = values.slice(-period);
  return sample.length === period
    ? sample.reduce((sum, value) => sum + value, 0) / period
    : undefined;
}

function pivotPoints(bars: PriceBar[], span = 2) {
  const highs: SwingPoint[] = [];
  const lows: SwingPoint[] = [];

  for (let index = span; index < bars.length - span; index += 1) {
    const current = bars[index];
    const neighborhood = bars.slice(index - span, index + span + 1);
    const otherBars = neighborhood.filter((_, itemIndex) => itemIndex !== span);

    if (otherBars.every((bar) => current.high > bar.high)) {
      highs.push({ time: current.time, price: current.high, index });
    }
    if (otherBars.every((bar) => current.low < bar.low)) {
      lows.push({ time: current.time, price: current.low, index });
    }
  }

  return { highs, lows };
}

function uniqueNearest(values: number[], current: number, direction: "ABOVE" | "BELOW", tolerance: number) {
  const ordered = values
    .filter((value) => direction === "ABOVE" ? value > current : value < current)
    .sort((a, b) => direction === "ABOVE" ? a - b : b - a);
  const result: number[] = [];

  for (const value of ordered) {
    if (result.every((existing) => Math.abs(existing - value) > tolerance)) {
      result.push(value);
    }
    if (result.length === 3) break;
  }
  return result;
}

function latestFvg(bars: PriceBar[]): FairValueGap | undefined {
  for (let index = bars.length - 1; index >= 2; index -= 1) {
    const first = bars[index - 2];
    const third = bars[index];

    if (third.low > first.high) {
      return { direction: "BULLISH", low: first.high, high: third.low, time: third.time };
    }
    if (third.high < first.low) {
      return { direction: "BEARISH", low: third.high, high: first.low, time: third.time };
    }
  }
  return undefined;
}

function volumeRatio(bars: PriceBar[], period = 20): number | undefined {
  const withVolume = bars.filter((bar) => Number.isFinite(bar.volume));
  if (withVolume.length < period + 1) return undefined;
  const latest = withVolume[withVolume.length - 1].volume as number;
  const baseline = withVolume
    .slice(-(period + 1), -1)
    .reduce((sum, bar) => sum + (bar.volume as number), 0) / period;
  return baseline > 0 ? latest / baseline : undefined;
}

export function analyzeMarketStructure(candles: any[]): MarketStructureAnalysis {
  const parsed = parseOandaBars(candles);
  // Confirmed swings must never be based on an unfinished candle.
  const bars = parsed.filter((bar) => bar.complete);
  const latest = bars[bars.length - 1];
  const atr = averageTrueRange(bars);
  const tolerance = Math.max((atr || 0) * 0.1, (latest?.close || 0) * 0.00002);
  const pivots = pivotPoints(bars);
  const recentHighs = pivots.highs.slice(-6);
  const recentLows = pivots.lows.slice(-6);
  const lastHigh = recentHighs[recentHighs.length - 1];
  const previousHigh = recentHighs[recentHighs.length - 2];
  const lastLow = recentLows[recentLows.length - 1];
  const previousLow = recentLows[recentLows.length - 2];

  let structure: StructureDirection = "RANGE";
  if (lastHigh && previousHigh && lastLow && previousLow) {
    if (lastHigh.price > previousHigh.price && lastLow.price > previousLow.price) structure = "BULLISH";
    if (lastHigh.price < previousHigh.price && lastLow.price < previousLow.price) structure = "BEARISH";
  }

  let bos: BreakDirection = "NONE";
  if (latest && lastHigh && latest.close > lastHigh.price) bos = "BULLISH";
  else if (latest && lastLow && latest.close < lastLow.price) bos = "BEARISH";

  let choch: BreakDirection = "NONE";
  if (structure === "BEARISH" && bos === "BULLISH") choch = "BULLISH";
  else if (structure === "BULLISH" && bos === "BEARISH") choch = "BEARISH";

  let liquiditySweep: BreakDirection = "NONE";
  if (latest && lastHigh && latest.high > lastHigh.price && latest.close < lastHigh.price) {
    liquiditySweep = "BEARISH";
  } else if (latest && lastLow && latest.low < lastLow.price && latest.close > lastLow.price) {
    liquiditySweep = "BULLISH";
  }

  const equalHigh = lastHigh && previousHigh && Math.abs(lastHigh.price - previousHigh.price) <= tolerance
    ? (lastHigh.price + previousHigh.price) / 2
    : undefined;
  const equalLow = lastLow && previousLow && Math.abs(lastLow.price - previousLow.price) <= tolerance
    ? (lastLow.price + previousLow.price) / 2
    : undefined;
  const current = latest?.close || 0;

  return {
    source: "OANDA_CANDLES",
    candleCount: bars.length,
    latestCandleTime: latest?.time,
    structure,
    bos,
    choch,
    liquiditySweep,
    fvg: latestFvg(bars.slice(-60)),
    equalHigh,
    equalLow,
    swingHighs: recentHighs.slice(-3).reverse(),
    swingLows: recentLows.slice(-3).reverse(),
    supportLevels: uniqueNearest(recentLows.map((point) => point.price), current, "BELOW", tolerance),
    resistanceLevels: uniqueNearest(recentHighs.map((point) => point.price), current, "ABOVE", tolerance),
    atr,
    volumeRatio: volumeRatio(bars)
  };
}
