function calculateEMA(prices, period) {
  if (prices.length < period) return 0;

  const multiplier = 2 / (period + 1);

  let ema =
    prices.slice(0, period).reduce((a, b) => a + b, 0) / period;

  for (let i = period; i < prices.length; i++) {
    ema = (prices[i] - ema) * multiplier + ema;
  }

  return ema;
}

function calculateRSI(prices, period = 14) {
  if (prices.length < period + 1) return 50;

  let gains = 0;
  let losses = 0;

  for (let i = prices.length - period; i < prices.length; i++) {
    const diff = prices[i] - prices[i - 1];

    if (diff > 0) gains += diff;
    else losses += Math.abs(diff);
  }

  const avgGain = gains / period;
  const avgLoss = losses / period;

  if (avgLoss === 0) return 100;

  const rs = avgGain / avgLoss;

  return 100 - 100 / (1 + rs);
}

function calculateATR(candles, period = 14) {
  if (candles.length < period) return 0;

  const trs = [];

  for (let i = 1; i < candles.length; i++) {
    const high = parseFloat(candles[i].mid.h);
    const low = parseFloat(candles[i].mid.l);
    const prevClose = parseFloat(candles[i - 1].mid.c);

    trs.push(
      Math.max(
        high - low,
        Math.abs(high - prevClose),
        Math.abs(low - prevClose)
      )
    );
  }

  return (
    trs.slice(-period).reduce((a, b) => a + b, 0) / period
  );
}

module.exports = {
  calculateEMA,
  calculateRSI,
  calculateATR
};
