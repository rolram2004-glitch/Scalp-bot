import { MarketData } from "./types";
import {
  detectFVG,
  detectLiquidity,
  detectOrderBlock,
  detectStructure
} from "./smart-money";
import { getSession, isKillzone } from "./session-engine";

require("dotenv").config();

const oanda = require("./oanda");
const { calculateEMA, calculateRSI, calculateATR } = require("./indicators");

function normalizeInstrumentSymbol(symbol: string): string {
  const cleaned = symbol.toUpperCase().replace(/[^A-Z]/g, "");

  if (cleaned.length === 6) {
    return `${cleaned.slice(0, 3)}_${cleaned.slice(3)}`;
  }

  return cleaned;
}

function buildMarketDataFromOanda(
  symbol: string,
  priceData: any,
  candles: any[]
): MarketData {
  const closes = candles
    .filter((candle) => candle && candle.mid)
    .map((candle) => parseFloat(candle.mid.c));

  const lastCandle = candles[candles.length - 1];
  const bid = parseFloat(
    priceData?.closeoutBid ?? priceData?.bids?.[0]?.price ?? lastCandle?.mid?.c ?? 0
  );
  const ask = parseFloat(
    priceData?.closeoutAsk ?? priceData?.asks?.[0]?.price ?? lastCandle?.mid?.c ?? 0
  );
  const closePrice = parseFloat(lastCandle?.mid?.c ?? priceData?.closeoutAsk ?? 0);
  const highPrice = parseFloat(lastCandle?.mid?.h ?? closePrice);
  const lowPrice = parseFloat(lastCandle?.mid?.l ?? closePrice);
  const ema20 = calculateEMA(closes, 20);
  const ema50 = calculateEMA(closes, 50);
  const ema200 = calculateEMA(closes, 200);
  const rsi = calculateRSI(closes, 14);
  const atr = calculateATR(candles, 14);

  return {
    symbol,
    timeframe: "M5",

    bid,
    ask,
    spread: Math.max(0, ask - bid) * (/JPY$/i.test(symbol) ? 100 : /XAU/i.test(symbol) ? 10 : 10000),

    highPrice,
    lowPrice,
    closePrice,

    ema20,
    ema50,
    ema200,

    rsi,

    macdMain: ema20 - ema50,
    macdSignal: ema50 - ema200,
    macdHistogram: (ema20 - ema50) - (ema50 - ema200),

    bollingerUpper: closePrice + atr * 2,
    bollingerMid: closePrice,
    bollingerLower: closePrice - atr * 2,

    volume: lastCandle?.volume ?? 0,
    volumeRatio: 0,

    atr,

    swingHigh: highPrice,
    swingLow: lowPrice,

    structureBias: closePrice > ema50 ? "BULLISH" : closePrice < ema50 ? "BEARISH" : "RANGE",
    nearOrderBlock: false,
    fairValueGap: "NOT_DETECTED",
    liquidityLevel: "UNKNOWN",

    session: getSession(),
    killzone: isKillzone(),

    trend: closePrice >= ema20 ? "BULLISH" : "BEARISH",
    volatility: atr > 0.001 ? "HIGH" : "NORMAL",

    accountBalance: undefined,
    accountEquity: undefined,

    openPositions: 0,
    todayTradeCount: 0
  };
}

export async function generateMarketData(symbol: string): Promise<MarketData> {
  const normalizedSymbol = normalizeInstrumentSymbol(symbol);

  try {
    const [priceData, candles] = await Promise.all([
      oanda.getPrice(normalizedSymbol),
      oanda.getCandles(normalizedSymbol, 200)
    ]);

    if (priceData && candles && candles.length >= 20) {
      return buildMarketDataFromOanda(symbol, priceData, candles);
    }
  } catch (error) {
    console.error(`OANDA feed unavailable for ${symbol}:`, error);
  }

  throw new Error(`OANDA data unavailable for ${symbol}`);
}
