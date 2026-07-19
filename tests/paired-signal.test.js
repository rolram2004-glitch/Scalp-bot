const test = require("node:test");
const assert = require("node:assert/strict");

require("ts-node/register/transpile-only");

const { createPairedSignalSnapshot, invertAction } = require("../src/signal-pair");

const market = {
  source: "OANDA",
  instrument: "EURUSD",
  time: new Date().toISOString(),
  bid: 1.10001,
  ask: 1.10009,
  mid: 1.10005,
  tradeable: true
};

const analysis = {
  candleTime: new Date().toISOString(),
  timeframe: "M5",
  ema20: 1.0999,
  ema50: 1.0995,
  ema200: 1.098,
  rsi: 61,
  spread: 0.8,
  structureBias: "BULLISH",
  trend: "BULLISH"
};

function snapshot(overrides = {}) {
  return createPairedSignalSnapshot({
    signalId: "SIG-EURUSD-20260719101112123",
    symbol: "EURUSD",
    evaluatedAt: "2026-07-19T10:11:12.500Z",
    market,
    analysis,
    mainDecision: {
      action: "BUY",
      confidence: 72,
      setupType: "EMA_TREND",
      reasoning: "MAIN unchanged"
    },
    tradingMode: "PAPER",
    liveExecutionVariant: "MAIN",
    ...overrides
  });
}

test("inverse mapping is deterministic and fail-closed", () => {
  assert.equal(invertAction("BUY"), "SELL");
  assert.equal(invertAction("SELL"), "BUY");
  assert.equal(invertAction("HOLD"), "HOLD");
  assert.equal(invertAction("UNKNOWN"), "HOLD");
});

test("MAIN and INVERSE share one OANDA quote and one evaluation timestamp", () => {
  const originalDecision = {
    action: "BUY",
    confidence: 72,
    setupType: "EMA_TREND",
    reasoning: "MAIN unchanged"
  };
  const result = snapshot({ mainDecision: originalDecision });

  assert.equal(result.pairId, "SIG-EURUSD-20260719101112123");
  assert.equal(result.evaluatedAt, "2026-07-19T10:11:12.500Z");
  assert.deepEqual(result.market, market);
  assert.deepEqual(result.analysis, analysis);
  assert.equal(result.marketValid, true);
  assert.equal(result.main.action, "BUY");
  assert.equal(result.inverse.action, "SELL");
  assert.equal(result.inverse.derivedFrom, "MAIN");
  assert.deepEqual(originalDecision, {
    action: "BUY",
    confidence: 72,
    setupType: "EMA_TREND",
    reasoning: "MAIN unchanged"
  });
});

test("PAPER keeps MAIN local and INVERSE shadow-only", () => {
  const result = snapshot();

  assert.equal(result.main.selectedForExecution, false);
  assert.equal(result.inverse.selectedForExecution, false);
  assert.equal(result.main.mode, "PAPER");
  assert.equal(result.main.executionState, "PAPER");
  assert.equal(result.inverse.mode, "PAPER SHADOW");
});

test("LIVE selects exactly MAIN or exactly INVERSE", () => {
  const main = snapshot({ tradingMode: "LIVE", liveExecutionVariant: "MAIN" });
  assert.equal(main.main.selectedForExecution, true);
  assert.equal(main.main.executionState, "READY");
  assert.equal(main.inverse.selectedForExecution, false);

  const inverse = snapshot({ tradingMode: "LIVE", liveExecutionVariant: "INVERSE" });
  assert.equal(inverse.main.selectedForExecution, false);
  assert.equal(inverse.inverse.selectedForExecution, true);
  assert.equal(inverse.inverse.executionState, "READY");
  assert.equal(inverse.inverse.action, "SELL");
});

test("invalid selector, invalid action, or untradeable quote blocks LIVE", () => {
  const invalidSelector = snapshot({ tradingMode: "LIVE", liveExecutionVariant: "BOTH" });
  assert.equal(invalidSelector.main.selectedForExecution, false);
  assert.equal(invalidSelector.inverse.selectedForExecution, false);
  assert.equal(invalidSelector.executionBlockedReason, "INVALID_LIVE_EXECUTION_VARIANT");

  const invalidAction = snapshot({
    tradingMode: "LIVE",
    mainDecision: { action: "UNKNOWN", confidence: 99, reasoning: "bad" }
  });
  assert.equal(invalidAction.main.action, "HOLD");
  assert.equal(invalidAction.inverse.action, "HOLD");
  assert.equal(invalidAction.executionBlockedReason, "INVALID_MAIN_ACTION");

  const stale = snapshot({
    tradingMode: "LIVE",
    market: { ...market, time: "", tradeable: false }
  });
  assert.equal(stale.main.selectedForExecution, false);
  assert.equal(stale.marketValid, false);
  assert.equal(stale.executionBlockedReason, "OANDA_SIGNAL_SNAPSHOT_NOT_TRADEABLE_OR_FRESH");

  const wrongInstrument = snapshot({
    tradingMode: "LIVE",
    market: { ...market, instrument: "GBPUSD" }
  });
  assert.equal(wrongInstrument.main.selectedForExecution, false);
  assert.equal(wrongInstrument.executionBlockedReason, "OANDA_SIGNAL_SNAPSHOT_NOT_TRADEABLE_OR_FRESH");
});
