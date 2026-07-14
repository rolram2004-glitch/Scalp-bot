import {
  MarketData,
  TradingDecision
} from "./types";

export async function getScalpingSignal(
  data: MarketData
): Promise<TradingDecision> {
  const isGold = /XAU/i.test(data.symbol);
  const maxSpread = isGold ? 80 : 25;
  const bullishStructure = data.structureBias === "BULLISH";
  const bearishStructure = data.structureBias === "BEARISH";
  const bullishMomentum = data.bid > data.ema20 && data.ema20 > data.ema50 && data.ema50 > data.ema200 && data.rsi > 55 && data.macdHistogram >= 0;
  const bearishMomentum = data.bid < data.ema20 && data.ema20 < data.ema50 && data.ema50 < data.ema200 && data.rsi < 45 && data.macdHistogram <= 0;

  if (data.spread > maxSpread) {
    return {
      action: "HOLD",
      confidence: 0,
      reasoning: `Spread too high (${data.spread.toFixed(1)})`
    };
  }

  // BUY SETUP

  if (
    bullishMomentum &&
    (bullishStructure || data.killzone)
  ) {
    return {
      action: "BUY",
      confidence: data.killzone ? 78 : 72,
      lotSize: 0.01,
      riskRewardRatio: 2,
      setupType: bullishStructure ? "EMA_TREND" : "KILLZONE_MOMENTUM",
      reasoning: `BUY accepted: real OANDA price above EMA20/50/200, RSI ${data.rsi.toFixed(1)}, MACD histogram positive, structure ${data.structureBias || "UNKNOWN"}, high ${data.highPrice.toFixed(5)} / low ${data.lowPrice.toFixed(5)}`
    };
  }

  // SELL SETUP

  if (
    bearishMomentum &&
    (bearishStructure || data.killzone)
  ) {
    return {
      action: "SELL",
      confidence: data.killzone ? 78 : 72,
      lotSize: 0.01,
      riskRewardRatio: 2,
      setupType: bearishStructure ? "EMA_TREND" : "KILLZONE_MOMENTUM",
      reasoning: `SELL accepted: real OANDA price below EMA20/50/200, RSI ${data.rsi.toFixed(1)}, MACD histogram negative, structure ${data.structureBias || "UNKNOWN"}, high ${data.highPrice.toFixed(5)} / low ${data.lowPrice.toFixed(5)}`
    };
  }

  return {
    action: "HOLD",
    confidence: 40,
    reasoning: `Rejected: no complete setup on real OANDA data. EMA stack buy=${bullishMomentum}, sell=${bearishMomentum}, structure=${data.structureBias || "UNKNOWN"}, RSI=${data.rsi.toFixed(1)}`
  };
}
