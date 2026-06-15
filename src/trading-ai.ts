export interface MarketData {
  symbol: string;
  bid: number;
  ask: number;
  spread: number;

  ema20: number;
  ema50: number;
  ema200: number;

  rsi: number;

  session: string;
  trend: string;

  openPositions: number;
  todayTradeCount: number;
}

export interface TradingDecision {
  action: "BUY" | "SELL" | "HOLD";
  confidence: number;
  reasoning: string;

  stopLossPips?: number;
  takeProfitPips?: number;
  lotSize?: number;

  setupType?: string;
}

export async function getScalpingSignal(
  data: MarketData
): Promise<TradingDecision> {

  // spread filter
  if (data.spread > 2) {
    return {
      action: "HOLD",
      confidence: 0,
      reasoning: "Spread too high"
    };
  }

  // bullish trend
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

  // bearish trend
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
