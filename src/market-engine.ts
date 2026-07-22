import { MarketData } from "./types";
import { getSession, isKillzone } from "./session-engine";
import { analyzeMarketStructure } from "./market-structure";

require("dotenv").config();

const oanda = require("./oanda");
const {
  calculateEMA,
  calculateRSI,
  calculateATR,
  calculateMACD,
  calculateBollinger
} = require("./indicators");

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
  const validCandles = candles.filter((candle) => {
    const prices = [candle?.mid?.o, candle?.mid?.h, candle?.mid?.l, candle?.mid?.c].map(Number);
    return Boolean(candle?.time) && prices.every((value) => Number.isFinite(value) && value > 0);
  });
  const closes = validCandles
    .map((candle) => parseFloat(candle.mid.c));

  if (closes.length < 200) {
    throw new Error(`OANDA candle history incomplete for ${symbol}: ${closes.length}/200`);
  }

  const lastCandle = validCandles[validCandles.length - 1];
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
  const atr = calculateATR(validCandles, 14);
  const macd = calculateMACD(closes);
  const bollinger = calculateBollinger(closes);
  const structure = analyzeMarketStructure(validCandles);
  const trend = closePrice > ema20 && ema20 > ema50 && ema50 > ema200
    ? "BULLISH"
    : closePrice < ema20 && ema20 < ema50 && ema50 < ema200
      ? "BEARISH"
      : "RANGE";
  const relativeAtr = closePrice > 0 ? atr / closePrice : 0;
  const liquidityLevel = structure.liquiditySweep !== "NONE"
    ? `${structure.liquiditySweep}_SWEEP`
    : structure.equalHigh !== undefined
      ? "EQUAL_HIGH"
      : structure.equalLow !== undefined
        ? "EQUAL_LOW"
        : undefined;

  return {
    symbol,
    timeframe: "M5",

    bid,
    ask,
    spread: Math.max(0, ask - bid) * (/JPY$/i.test(symbol) ? 100 : /XAU/i.test(symbol) ? 10 : 10000),
    priceTime: String(priceData?.time || lastCandle?.time || ""),
    candleTime: String(lastCandle?.time || ""),
    tradeable: priceData?.tradeable === true && String(priceData?.status || "tradeable").toLowerCase() === "tradeable",

    highPrice,
    lowPrice,
    closePrice,

    ema20,
    ema50,
    ema200,

    rsi,

    macdMain: macd?.main,
    macdSignal: macd?.signal,
    macdHistogram: macd?.histogram,

    bollingerUpper: bollinger?.upper,
    bollingerMid: bollinger?.middle,
    bollingerLower: bollinger?.lower,

    volume: Number.isFinite(Number(lastCandle?.volume)) ? Number(lastCandle.volume) : undefined,
    volumeRatio: structure.volumeRatio,

    atr,

    swingHigh: structure.swingHighs[0]?.price,
    swingLow: structure.swingLows[0]?.price,
    swingHighs: structure.swingHighs.map(({ time, price }) => ({ time, price })),
    swingLows: structure.swingLows.map(({ time, price }) => ({ time, price })),
    supportLevels: structure.supportLevels,
    resistanceLevels: structure.resistanceLevels,

    structureBias: structure.structure,
    fairValueGap: structure.fvg?.direction,
    fairValueGapZone: structure.fvg,
    liquidityLevel,
    breakOfStructure: structure.bos,
    changeOfCharacter: structure.choch,
    liquiditySweep: structure.liquiditySweep,
    equalHigh: structure.equalHigh,
    equalLow: structure.equalLow,
    structureSource: structure.source,
    candleCount: structure.candleCount,

    session: getSession(),
    killzone: isKillzone(),

    trend,
    volatility: relativeAtr >= 0.0015 ? "HIGH" : relativeAtr <= 0.0004 ? "LOW" : "NORMAL"
  };
}

export async function generateMarketData(symbol: string): Promise<MarketData> {
  const normalizedSymbol = normalizeInstrumentSymbol(symbol);

  try {
    const [priceData, candles] = await Promise.all([
      oanda.getPrice(normalizedSymbol),
      oanda.getCandles(normalizedSymbol, 250)
    ]);

    if (priceData && candles && candles.length >= 200) {
      return buildMarketDataFromOanda(symbol, priceData, candles);
    }
  } catch (error) {
    console.error(`OANDA feed unavailable for ${symbol}:`, error);
  }

  throw new Error(`OANDA data unavailable for ${symbol}`);
}
