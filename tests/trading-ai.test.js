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

test("ROHATO_AGGRESSIVE_100 accepts a confirmed fast-trend continuation before the slow EMA stack", async () => {
  const decision = await getScalpingSignal(marketData({
    ema20: 1.19,
    ema50: 1.18,
    ema200: 1.185,
    rsi: 52.5,
    macdHistogram: 0.0002,
    structureBias: "BULLISH"
  }));

  assert.equal(decision.action, "BUY");
  assert.equal(decision.setupType, "AGGRESSIVE_CONTINUATION");
  assert.ok(decision.confidence >= 55);
  assert.match(decision.reasoning, /ROHATO_AGGRESSIVE_100/);
});

test("ROHATO_AGGRESSIVE_100 remains HOLD when fast trend has no directional confirmation", async () => {
  const decision = await getScalpingSignal(marketData({
    ema20: 1.19,
    ema50: 1.18,
    ema200: 1.185,
    rsi: 52.5,
    macdHistogram: 0.0002,
    structureBias: "RANGE",
    killzone: false,
    breakOfStructure: "NONE",
    changeOfCharacter: "NONE",
    liquiditySweep: "NONE",
    fairValueGap: undefined
  }));

  assert.equal(decision.action, "HOLD");
});

test("old FVG or killzone alone cannot trigger an opposing or range trade", async () => {
  const decision = await getScalpingSignal(marketData({
    ema20: 1.19,
    ema50: 1.18,
    ema200: 1.185,
    rsi: 53,
    macdHistogram: 0.0002,
    structureBias: "RANGE",
    killzone: true,
    fairValueGap: "BULLISH",
    breakOfStructure: "NONE",
    changeOfCharacter: "NONE",
    liquiditySweep: "NONE",
    volumeRatio: 1.2
  }));

  assert.equal(decision.action, "HOLD");
});

test("overextended RSI blocks trend chasing even with a full EMA stack", async () => {
  const decision = await getScalpingSignal(marketData({ rsi: 80, macdHistogram: 0.001 }));
  assert.equal(decision.action, "HOLD");
});

test("a current structure break needs aligned MACD and verified volume", async () => {
  const accepted = await getScalpingSignal(marketData({
    ema20: 1.19,
    ema50: 1.18,
    ema200: 1.185,
    rsi: 53,
    macdHistogram: 0.0002,
    structureBias: "RANGE",
    breakOfStructure: "BULLISH",
    volumeRatio: 1.05
  }));
  const rejected = await getScalpingSignal(marketData({
    ema20: 1.19,
    ema50: 1.18,
    ema200: 1.185,
    rsi: 53,
    macdHistogram: 0.0002,
    structureBias: "RANGE",
    breakOfStructure: "BULLISH",
    volumeRatio: 0.7
  }));

  assert.equal(accepted.action, "BUY");
  assert.equal(accepted.setupType, "AGGRESSIVE_STRUCTURE_BREAK");
  assert.equal(rejected.action, "HOLD");
});
