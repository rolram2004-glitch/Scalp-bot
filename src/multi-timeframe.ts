import { analyzeMarketStructure, parseOandaBars } from "./market-structure";

const { calculateEMA, calculateRSI, calculateATR, calculateMACD } = require("./indicators");

export const INTELLIGENCE_TIMEFRAMES = ["M1", "M5", "M15", "H1"] as const;
export type IntelligenceTimeframe = typeof INTELLIGENCE_TIMEFRAMES[number];
export type IntelligenceDirection = "BUY" | "SELL" | "HOLD";

export interface TimeframeIntelligence {
  timeframe: IntelligenceTimeframe;
  available: boolean;
  source?: "OANDA_CANDLES";
  reason?: string;
  candleTime?: string;
  candleCount?: number;
  direction?: IntelligenceDirection;
  alignmentScore?: number;
  ema20?: number;
  ema50?: number;
  ema200?: number;
  rsi?: number;
  macdHistogram?: number;
  atr?: number;
  structure?: string;
  bos?: string;
  choch?: string;
  fvg?: string;
  liquiditySweep?: string;
}

export interface MultiTimeframeIntelligence {
  symbol: string;
  evaluatedAt: string;
  source: "OANDA";
  frames: TimeframeIntelligence[];
  availableFrames: number;
  consensus: IntelligenceDirection;
  alignmentScore?: number;
  reasoning: string;
}

function normalizeSymbol(symbol: string) {
  const compact = String(symbol || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return compact.length === 6 ? `${compact.slice(0, 3)}_${compact.slice(3)}` : compact;
}

export function analyzeTimeframe(timeframe: IntelligenceTimeframe, candles: any[]): TimeframeIntelligence {
  const bars = parseOandaBars(candles).filter((bar) => bar.complete);
  if (bars.length < 200) {
    return {
      timeframe,
      available: false,
      reason: `OANDA_CANDLES_INSUFFICIENT_${bars.length}_OF_200`
    };
  }

  const closes = bars.map((bar) => bar.close);
  const ema20 = calculateEMA(closes, 20);
  const ema50 = calculateEMA(closes, 50);
  const ema200 = calculateEMA(closes, 200);
  const rsi = calculateRSI(closes, 14);
  const atr = calculateATR(candles.filter((candle) => candle?.complete !== false), 14);
  const macd = calculateMACD(closes);
  const structure = analyzeMarketStructure(candles);
  const price = closes[closes.length - 1];
  const buyVotes = [
    price > ema20 && ema20 > ema50 && ema50 > ema200,
    structure.structure === "BULLISH",
    structure.bos === "BULLISH",
    Number(macd?.histogram) > 0,
    rsi >= 52 && rsi <= 70
  ];
  const sellVotes = [
    price < ema20 && ema20 < ema50 && ema50 < ema200,
    structure.structure === "BEARISH",
    structure.bos === "BEARISH",
    Number(macd?.histogram) < 0,
    rsi <= 48 && rsi >= 30
  ];
  const buyScore = buyVotes.filter(Boolean).length;
  const sellScore = sellVotes.filter(Boolean).length;
  const direction: IntelligenceDirection = buyScore >= 3 && buyScore > sellScore
    ? "BUY"
    : sellScore >= 3 && sellScore > buyScore
      ? "SELL"
      : "HOLD";

  return {
    timeframe,
    available: true,
    source: "OANDA_CANDLES",
    candleTime: bars[bars.length - 1].time,
    candleCount: bars.length,
    direction,
    alignmentScore: Math.round((Math.max(buyScore, sellScore) / buyVotes.length) * 100),
    ema20,
    ema50,
    ema200,
    rsi,
    macdHistogram: macd?.histogram,
    atr,
    structure: structure.structure,
    bos: structure.bos,
    choch: structure.choch,
    fvg: structure.fvg?.direction,
    liquiditySweep: structure.liquiditySweep
  };
}

export async function loadMultiTimeframeIntelligence(oanda: any, symbol: string): Promise<MultiTimeframeIntelligence> {
  const instrument = normalizeSymbol(symbol);
  const frames = await Promise.all(INTELLIGENCE_TIMEFRAMES.map(async (timeframe) => {
    try {
      const candles = await oanda.getCandles(instrument, 250, timeframe);
      return analyzeTimeframe(timeframe, candles);
    } catch (_error) {
      return { timeframe, available: false, reason: "OANDA_CANDLES_UNAVAILABLE" } as TimeframeIntelligence;
    }
  }));
  const available = frames.filter((frame) => frame.available);
  const buys = available.filter((frame) => frame.direction === "BUY").length;
  const sells = available.filter((frame) => frame.direction === "SELL").length;
  const consensus: IntelligenceDirection = available.length >= 3 && buys >= 3
    ? "BUY"
    : available.length >= 3 && sells >= 3
      ? "SELL"
      : "HOLD";
  const alignmentScore = available.length > 0
    ? Math.round((Math.max(buys, sells) / available.length) * 100)
    : undefined;
  const reasoning = available.length === 0
    ? "Dati multi-timeframe OANDA non disponibili."
    : consensus === "HOLD"
      ? `${available.length}/4 timeframe reali disponibili; nessun allineamento di almeno 3 timeframe.`
      : `${Math.max(buys, sells)}/${available.length} timeframe OANDA allineati ${consensus}.`;

  return {
    symbol: instrument.replace("_", ""),
    evaluatedAt: new Date().toISOString(),
    source: "OANDA",
    frames,
    availableFrames: available.length,
    consensus,
    alignmentScore,
    reasoning
  };
}
