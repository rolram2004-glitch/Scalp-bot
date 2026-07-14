const test = require("node:test");
const assert = require("node:assert/strict");

require("ts-node/register/transpile-only");

const { getScalpingSignal } = require("../src/trading-ai");

function marketData(overrides) {
  return {
    symbol: "EURUSD",
    spread: 1.5,
    bid: 1.2,
    ema20: 1.19,
    ema50: 1.18,
    ema200: 1.17,
    rsi: 56,
    macdHistogram: -0.001,
    structureBias: "BULLISH",
    killzone: false,
    highPrice: 1.201,
    lowPrice: 1.199,
    ...overrides
  };
}

test("valid BUY keeps the original EMA and RSI behavior when MACD lags", async () => {
  const decision = await getScalpingSignal(marketData({}));

  assert.equal(decision.action, "BUY");
  assert.equal(decision.confidence, 72);
});

test("valid SELL keeps the original EMA and RSI behavior when MACD lags", async () => {
  const decision = await getScalpingSignal(marketData({
    bid: 1.1,
    ema20: 1.11,
    ema50: 1.12,
    ema200: 1.13,
    rsi: 44,
    macdHistogram: 0.001,
    structureBias: "BEARISH"
  }));

  assert.equal(decision.action, "SELL");
  assert.equal(decision.confidence, 72);
});

test("spread guard still rejects unsafe entries", async () => {
  const decision = await getScalpingSignal(marketData({ spread: 30 }));

  assert.equal(decision.action, "HOLD");
  assert.equal(decision.confidence, 0);
});
