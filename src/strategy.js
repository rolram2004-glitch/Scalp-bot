const {
  calculateEMA,
  calculateRSI,
  calculateATR
} = require("./indicators");

function getTrend(price, ema20, ema50, ema200) {
  if (
    price > ema20 &&
    ema20 > ema50 &&
    ema50 > ema200
  ) {
    return "STRONG_UPTREND";
  }

  if (
    price < ema20 &&
    ema20 < ema50 &&
    ema50 < ema200
  ) {
    return "STRONG_DOWNTREND";
  }

  return "NEUTRAL";
}

function analyzeMarket(candles, spread) {

  const closes = candles.map(c =>
    parseFloat(c.mid.c)
  );

  const currentPrice =
    closes[closes.length - 1];

  const ema20 = calculateEMA(closes,20);
  const ema50 = calculateEMA(closes,50);
  const ema200 = calculateEMA(closes,200);

  const rsi = calculateRSI(closes,14);
  const atr = calculateATR(candles,14);

  const trend = getTrend(
    currentPrice,
    ema20,
    ema50,
    ema200
  );

  let action = "HOLD";
  let confidence = 0;
  let setup = "NONE";
  let reason = "No setup";

  // EMA STACK BUY

  if (
    trend === "STRONG_UPTREND" &&
    rsi > 55 &&
    rsi < 70
  ) {
    action = "BUY";
    confidence = 72;
    setup = "EMA_STACK";
    reason =
      "Perfect bullish EMA stack (20>50>200), RSI bullish";
  }

  // EMA STACK SELL

  if (
    trend === "STRONG_DOWNTREND" &&
    rsi < 45 &&
    rsi > 30
  ) {
    action = "SELL";
    confidence = 72;
    setup = "EMA_STACK";
    reason =
      "Perfect bearish EMA stack (20<50<200), RSI bearish";
  }

  if (spread > 2.0) {
    action = "HOLD";
    confidence = 0;
    setup = "SPREAD_FILTER";
    reason = "Spread too high";
  }

  const stopLoss =
    action === "BUY"
      ? currentPrice - (atr * 1.5)
      : currentPrice + (atr * 1.5);

  const takeProfit =
    action === "BUY"
      ? currentPrice + (atr * 3)
      : currentPrice - (atr * 3);

  return {
    action,
    confidence,
    setup,
    reason,
    trend,
    ema20,
    ema50,
    ema200,
    rsi,
    atr,
    stopLoss,
    takeProfit
  };
}

module.exports = {
  analyzeMarket
};
