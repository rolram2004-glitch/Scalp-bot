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

function calculateEMASeries(prices, period) {
  if (!Array.isArray(prices) || prices.length < period || period <= 0) return [];
  const multiplier = 2 / (period + 1);
  const seed = prices.slice(0, period).reduce((sum, value) => sum + value, 0) / period;
  const series = Array(period - 1).fill(undefined);
  let ema = seed;
  series.push(ema);

  for (let index = period; index < prices.length; index += 1) {
    ema = (prices[index] - ema) * multiplier + ema;
    series.push(ema);
  }
  return series;
}

function calculateMACD(prices, fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) {
  if (!Array.isArray(prices) || prices.length < slowPeriod + signalPeriod) return null;
  const fast = calculateEMASeries(prices, fastPeriod);
  const slow = calculateEMASeries(prices, slowPeriod);
  const macdSeries = prices.map((_, index) => {
    const fastValue = fast[index];
    const slowValue = slow[index];
    return Number.isFinite(fastValue) && Number.isFinite(slowValue)
      ? fastValue - slowValue
      : undefined;
  });
  const compactMacd = macdSeries.filter(Number.isFinite);
  const signalSeries = calculateEMASeries(compactMacd, signalPeriod);
  const main = compactMacd[compactMacd.length - 1];
  const signal = signalSeries[signalSeries.length - 1];
  if (!Number.isFinite(main) || !Number.isFinite(signal)) return null;
  return { main, signal, histogram: main - signal };
}

function calculateBollinger(prices, period = 20, deviations = 2) {
  if (!Array.isArray(prices) || prices.length < period) return null;
  const sample = prices.slice(-period);
  const middle = sample.reduce((sum, value) => sum + value, 0) / period;
  const variance = sample.reduce((sum, value) => sum + ((value - middle) ** 2), 0) / period;
  const standardDeviation = Math.sqrt(variance);
  return {
    upper: middle + deviations * standardDeviation,
    middle,
    lower: middle - deviations * standardDeviation
  };
}

module.exports = {
  calculateEMA,
  calculateRSI,
  calculateATR,
  calculateMACD,
  calculateBollinger
};
