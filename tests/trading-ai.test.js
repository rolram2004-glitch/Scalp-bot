const test = require("node:test");
const assert = require("node:assert/strict");

require("ts-node/register/transpile-only");

const { getScalpingSignal } = require("../src/trading-ai");

function marketData(overrides) {
  return {
    symbol: "EURUSD",
    timeframe: "M5",
    spread: 1.5,
    bid: 1.2,
    ask: 1.2001,
    tradeable: true,
    ema20: 1.19,
    ema50: 1.18,
    ema200: 1.17,
    rsi: 56,
    macdHistogram: -0.001,
    structureBias: "BULLISH",
    killzone: false,
    volatility: "NORMAL",
    session: "LONDON",
    highPrice: 1.201,
    lowPrice: 1.199,
    ...overrides
  };
}

test("valid BUY keeps the original EMA and RSI behavior when MACD lags", async () => {
  const decision = await getScalpingSignal(marketData({}));

  assert.equal(decision.action, "BUY");
  assert.equal(decision.confidence, 83);
  assert.equal(decision.setupScore, 83);
  assert.equal(decision.scoreLabel, "STRONG");
  assert.deepEqual(decision.scoreBreakdown, {
    trend: 20,
    momentum: 10,
    structure: 20,
    liquidity: 0,
    volatility: 10,
    spread: 10,
    session: 3,
    risk: 10
  });
  assert.match(decision.reasoning, /Setup score 83\/100/);
});

test("valid SELL keeps the original EMA and RSI behavior when MACD lags", async () => {
  const decision = await getScalpingSignal(marketData({
    bid: 1.1,
    ask: 1.1001,
    ema20: 1.11,
    ema50: 1.12,
    ema200: 1.13,
    rsi: 44,
    macdHistogram: 0.001,
    structureBias: "BEARISH"
  }));

  assert.equal(decision.action, "SELL");
  assert.equal(decision.confidence, 83);
  assert.equal(decision.setupScore, 83);
  assert.equal(decision.scoreLabel, "STRONG");
});

test("spread guard still rejects unsafe entries", async () => {
  const decision = await getScalpingSignal(marketData({ spread: 30 }));

  assert.equal(decision.action, "HOLD");
  assert.ok(decision.confidence < 65);
  assert.equal(decision.scoreBreakdown.spread, 0);
  assert.equal(decision.scoreBreakdown.risk, 0);
  assert.match(decision.reasoning, /spread non executable/);
});

test("setup score changes only when verified market evidence changes", async () => {
  const base = await getScalpingSignal(marketData({}));
  const repeated = await getScalpingSignal(marketData({}));
  const alignedMacdAndLiquidity = await getScalpingSignal(marketData({
    macdHistogram: 0.001,
    liquiditySweep: "BULLISH",
    fairValueGap: "BULLISH"
  }));

  assert.equal(base.setupScore, repeated.setupScore);
  assert.equal(base.reasoning, repeated.reasoning);
  assert.equal(alignedMacdAndLiquidity.setupScore, 96);
  assert.ok(alignedMacdAndLiquidity.setupScore > base.setupScore);
});
