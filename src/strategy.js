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

  const ema20 = calculateEMA(closes, 20);
  const ema50 = calculateEMA(closes, 50);
  const ema200 = calculateEMA(closes, 200);

  const rsi = calculateRSI(closes, 14);
  const atr = calculateATR(candles, 14);

  const trend = getTrend(
    currentPrice,
    ema20,
    ema50,
    ema200
  );

  let action = "HOLD";
  let confidence = 0;

  if (
    trend === "STRONG_UPTREND" &&
    rsi > 50 &&
    rsi < 70
  ) {
    action = "BUY";
    confidence = 0.75;
  }

  if (
    trend === "STRONG_DOWNTREND" &&
    rsi < 50 &&
    rsi > 30
  ) {
    action = "SELL";
    confidence = 0.75;
  }

  if (spread > 2.0) {
    action = "HOLD";
    confidence = 0;
  }

  return {
    action,
    confidence,
    trend,
    ema20,
    ema50,
    ema200,
    rsi,
    atr
  };
}

module.exports = {
  analyzeMarket
};
