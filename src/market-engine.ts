import { MarketData } from "./types";
import {
  detectFVG,
  detectLiquidity,
  detectOrderBlock,
  detectStructure
} from "./smart-money";

export function generateMarketData(
  symbol: string
): MarketData {

  const price = 1 + Math.random();

  return {
    symbol,
    timeframe: "M5",

    bid: price,
    ask: price + 0.0002,
    spread: 1.2,

    highPrice: price + 0.001,
    lowPrice: price - 0.001,
    closePrice: price,

    ema20: price,
    ema50: price,
    ema200: price,

    rsi: 50,

    macdMain: 0.1,
    macdSignal: 0.05,
    macdHistogram: 0.05,

    adx: 25,
    plusDI: 30,
    minusDI: 15,

    bollingerUpper: price + 0.002,
    bollingerMid: price,
    bollingerLower: price - 0.002,

    volume: 1000,
    volumeRatio: 1.3,

    atr: 0.001,

    swingHigh: price + 0.003,
    swingLow: price - 0.003,

    structureBias: detectStructure(),
    nearOrderBlock: detectOrderBlock(),
    fairValueGap: detectFVG(),
    liquidityLevel: detectLiquidity(),

    session: "LONDON",
    killzone: false,

    trend: "BULLISH",
    volatility: "NORMAL",

    accountBalance: 10000,
    accountEquity: 10000,

    openPositions: 0,
    todayTradeCount: 0
  };
}
