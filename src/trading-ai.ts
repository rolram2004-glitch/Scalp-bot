import {
  MarketData,
  TradingDecision
} from "./types";

export async function getScalpingSignal(
  data: MarketData
): Promise<TradingDecision> {

  if (data.spread > 2) {
    return {
      action: "HOLD",
      confidence: 0,
      reasoning: "Spread too high"
    };
  }

  // BUY SETUP

  if (
    data.bid > data.ema20 &&
    data.ema20 > data.ema50 &&
    data.ema50 > data.ema200 &&
    data.rsi > 55
  ) {
    return {
      action: "BUY",
      confidence: 72,
      stopLossPips: 10,
      takeProfitPips: 20,
      lotSize: 0.01,
      setupType: "EMA_PULLBACK",
      reasoning: "Bullish EMA stack and RSI confirmation"
    };
  }

  // SELL SETUP

  if (
    data.bid < data.ema20 &&
    data.ema20 < data.ema50 &&
    data.ema50 < data.ema200 &&
    data.rsi < 45
  ) {
    return {
      action: "SELL",
      confidence: 72,
      stopLossPips: 10,
      takeProfitPips: 20,
      lotSize: 0.01,
      setupType: "EMA_PULLBACK",
      reasoning: "Bearish EMA stack and RSI confirmation"
    };
  }

  return {
    action: "HOLD",
    confidence: 40,
    reasoning: "No valid setup"
  };
}
