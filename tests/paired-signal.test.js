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
    executionGateVerified: false,
    ...overrides
  });
}

test("inverse mapping is deterministic and fail-closed", () => {
  assert.equal(invertAction("BUY"), "SELL");
  assert.equal(invertAction("SELL"), "BUY");
  assert.equal(invertAction("HOLD"), "HOLD");
  assert.equal(invertAction("UNKNOWN"), "HOLD");
});

test("MAIN and strict MIRROR share one OANDA quote and swap the protective price levels", () => {
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
  assert.ok(Math.abs(result.main.entryPrice - market.ask) < 1e-10);
  assert.ok(Math.abs(result.main.stopLossPrice - (market.ask - 0.001)) < 1e-10);
  assert.ok(Math.abs(result.main.takeProfitPrice - (market.ask + 0.002)) < 1e-10);
  assert.ok(Math.abs(result.inverse.entryPrice - market.bid) < 1e-10);
  assert.equal(result.inverse.stopLossPrice, result.main.takeProfitPrice);
  assert.equal(result.inverse.takeProfitPrice, result.main.stopLossPrice);
  assert.ok(Math.abs(result.inverse.stopLossPrice - (market.ask + 0.002)) < 1e-10);
  assert.ok(Math.abs(result.inverse.takeProfitPrice - (market.ask - 0.001)) < 1e-10);
  assert.ok(Math.abs(result.inverse.riskRewardRatio - (9.2 / 20.8)) < 1e-10);
  assert.equal(result.inverse.derivedFrom, "MAIN");
  assert.deepEqual(originalDecision, {
    action: "BUY",
    confidence: 72,
    setupType: "EMA_TREND",
    reasoning: "MAIN unchanged"
  });
});

test("strict MIRROR also swaps MAIN protective levels for a SELL signal", () => {
  const result = snapshot({
    mainDecision: {
      action: "SELL",
      confidence: 72,
      setupType: "EMA_TREND",
      reasoning: "MAIN sell"
    }
  });

  assert.equal(result.main.action, "SELL");
  assert.equal(result.inverse.action, "BUY");
  assert.ok(Math.abs(result.main.entryPrice - market.bid) < 1e-10);
  assert.ok(Math.abs(result.main.stopLossPrice - (market.bid + 0.001)) < 1e-10);
  assert.ok(Math.abs(result.main.takeProfitPrice - (market.bid - 0.002)) < 1e-10);
  assert.ok(Math.abs(result.inverse.entryPrice - market.ask) < 1e-10);
  assert.equal(result.inverse.stopLossPrice, result.main.takeProfitPrice);
  assert.equal(result.inverse.takeProfitPrice, result.main.stopLossPrice);
});

test("old MAIN 10/20 plan becomes MIRROR SL about 20 pips and TP about 10 pips in both directions", () => {
  for (const action of ["BUY", "SELL"]) {
    const result = snapshot({
      mainDecision: {
        action,
        confidence: 72,
        setupType: "OLD_MAIN_CONTRACT",
        reasoning: "keep the old strategy and invert only its execution"
      }
    });
    const direction = result.inverse.action === "BUY" ? 1 : -1;
    const mirrorRiskPips = (result.inverse.entryPrice - result.inverse.stopLossPrice) * direction * 10000;
    const mirrorTargetPips = (result.inverse.takeProfitPrice - result.inverse.entryPrice) * direction * 10000;

    assert.equal(result.inverse.action, action === "BUY" ? "SELL" : "BUY");
    assert.equal(result.inverse.stopLossPrice, result.main.takeProfitPrice);
    assert.equal(result.inverse.takeProfitPrice, result.main.stopLossPrice);
    assert.ok(Math.abs(mirrorRiskPips - 20.8) < 1e-10);
    assert.ok(Math.abs(mirrorTargetPips - 9.2) < 1e-10);
  }
});

test("red MAIN stop becomes MIRROR target and green MAIN target becomes MIRROR stop at the exact prices", () => {
  const result = snapshot({
    mainDecision: {
      action: "SELL",
      confidence: 72,
      setupType: "EXPLICIT_LEVEL_MIRROR",
      reasoning: "preserve the actual protective prices",
      stopLossPrice: 1.10101,
      structuralTargets: [1.09801]
    }
  });

  assert.equal(result.main.stopLossPrice, 1.10101);
  assert.equal(result.main.takeProfitPrice, 1.09801);
  assert.equal(result.inverse.action, "BUY");
  assert.equal(result.inverse.takeProfitPrice, 1.10101);
  assert.equal(result.inverse.stopLossPrice, 1.09801);
  assert.equal(result.inverse.takeProfitPrice, result.main.stopLossPrice);
  assert.equal(result.inverse.stopLossPrice, result.main.takeProfitPrice);
});

test("INVERSE OANDA execution fails closed when spread makes strict mirror levels non-directional", () => {
  const wideMarket = {
    ...market,
    time: new Date().toISOString(),
    bid: 1.1,
    ask: 1.1015,
    mid: 1.10075
  };
  const result = snapshot({
    tradingMode: "OANDA_DEMO",
    liveExecutionVariant: "INVERSE",
    executionGateVerified: true,
    market: wideMarket
  });

  assert.equal(result.inverse.selectedForExecution, true);
  assert.equal(result.inverse.executionState, "NOT_ELIGIBLE");
  assert.equal(result.inverse.executionReason, "MIRROR_PROTECTIVE_LEVELS_INVALID_AFTER_SPREAD");
  assert.equal(result.executionBlockedReason, "MIRROR_PROTECTIVE_LEVELS_INVALID_AFTER_SPREAD");
});

test("OANDA_DEMO INVERSE ACCOUNT_CASH reverses direction and defers fixed CHF protection to the fill", () => {
  const wideMarket = {
    ...market,
    time: new Date().toISOString(),
    bid: 1.1,
    ask: 1.1015,
    mid: 1.10075
  };
  const result = snapshot({
    tradingMode: "OANDA_DEMO",
    liveExecutionVariant: "INVERSE",
    executionGateVerified: true,
    market: wideMarket,
    accountCashRisk: 0.2,
    accountCashReward: 0.6,
    accountTargetCurrency: "CHF"
  });

  assert.equal(result.main.action, "BUY");
  assert.equal(result.inverse.action, "SELL");
  assert.equal(result.inverse.selectedForExecution, true);
  assert.equal(result.inverse.executionState, "READY");
  assert.equal(result.inverse.stopLossPrice, undefined);
  assert.equal(result.inverse.takeProfitPrice, undefined);
  assert.deepEqual(result.inverse.structuralTargets, []);
  assert.ok(Math.abs(result.inverse.riskRewardRatio - (0.6 / 0.2)) < 1e-12);
  assert.equal(result.executionBlockedReason, undefined);
  assert.doesNotMatch(result.inverse.reasoning, /MAIN SL|MAIN TP|20P|10P/i);
  assert.match(result.inverse.reasoning, /TP nominale \+0\.60 CHF, SL nominale -0\.20 CHF/);
});

test("OANDA_DEMO MAIN ACCOUNT_CASH keeps the normal direction and defers fixed CHF protection to the fill", () => {
  const result = snapshot({
    tradingMode: "OANDA_DEMO",
    liveExecutionVariant: "MAIN",
    executionGateVerified: true,
    accountCashRisk: 0.2,
    accountCashReward: 0.6,
    accountTargetCurrency: "CHF"
  });

  assert.equal(result.main.action, "BUY");
  assert.equal(result.inverse.action, "SELL");
  assert.equal(result.main.selectedForExecution, true);
  assert.equal(result.main.executionState, "READY");
  assert.equal(result.main.stopLossPrice, undefined);
  assert.equal(result.main.takeProfitPrice, undefined);
  assert.deepEqual(result.main.structuralTargets, []);
  assert.ok(Math.abs(result.main.riskRewardRatio - (0.6 / 0.2)) < 1e-12);
  assert.equal(result.executionBlockedReason, undefined);
  assert.match(result.main.reasoning, /NORMALE sul segnale: BUY resta BUY/);
  assert.match(result.main.reasoning, /TP nominale \+0\.60 CHF, SL nominale -0\.20 CHF/);
});

test("OANDA_DEMO MAIN ACCOUNT_CASH keeps SELL as SELL with TP 0.60 CHF and SL 0.20 CHF", () => {
  const result = snapshot({
    tradingMode: "OANDA_DEMO",
    liveExecutionVariant: "MAIN",
    executionGateVerified: true,
    accountCashRisk: 0.2,
    accountCashReward: 0.6,
    accountTargetCurrency: "CHF",
    mainDecision: {
      action: "SELL",
      confidence: 72,
      setupType: "EMA_TREND",
      reasoning: "MAIN unchanged"
    }
  });

  assert.equal(result.main.action, "SELL");
  assert.equal(result.inverse.action, "BUY");
  assert.equal(result.main.selectedForExecution, true);
  assert.equal(result.main.executionState, "READY");
  assert.ok(Math.abs(result.main.riskRewardRatio - (0.6 / 0.2)) < 1e-12);
  assert.match(result.main.reasoning, /NORMALE sul segnale: SELL resta SELL/);
  assert.match(result.main.reasoning, /TP nominale \+0\.60 CHF, SL nominale -0\.20 CHF/);
});

test("PAPER keeps MAIN local and INVERSE shadow-only", () => {
  const result = snapshot();

  assert.equal(result.main.selectedForExecution, false);
  assert.equal(result.inverse.selectedForExecution, false);
  assert.equal(result.main.mode, "PAPER");
  assert.equal(result.main.executionState, "PAPER");
  assert.equal(result.inverse.mode, "PAPER SHADOW");
});

test("OANDA_DEMO selects exactly MAIN or exactly INVERSE only after every gate", () => {
  const main = snapshot({ tradingMode: "OANDA_DEMO", liveExecutionVariant: "MAIN", executionGateVerified: true });
  assert.equal(main.main.selectedForExecution, true);
  assert.equal(main.main.executionState, "READY");
  assert.equal(main.inverse.selectedForExecution, false);

  const inverse = snapshot({ tradingMode: "OANDA_DEMO", liveExecutionVariant: "INVERSE", executionGateVerified: true });
  assert.equal(inverse.main.selectedForExecution, false);
  assert.equal(inverse.inverse.selectedForExecution, true);
  assert.equal(inverse.inverse.executionState, "READY");
  assert.equal(inverse.inverse.action, "SELL");
});

test("invalid selector, missing safety gate, invalid action, or untradeable quote blocks OANDA", () => {
  const invalidSelector = snapshot({ tradingMode: "OANDA_DEMO", liveExecutionVariant: "BOTH", executionGateVerified: true });
  assert.equal(invalidSelector.main.selectedForExecution, false);
  assert.equal(invalidSelector.inverse.selectedForExecution, false);
  assert.equal(invalidSelector.executionBlockedReason, "INVALID_LIVE_EXECUTION_VARIANT");

  const missingGate = snapshot({ tradingMode: "OANDA_DEMO", executionGateVerified: false });
  assert.equal(missingGate.main.selectedForExecution, false);
  assert.equal(missingGate.executionBlockedReason, "OANDA_SAFETY_GATES_NOT_VERIFIED");

  const invalidAction = snapshot({
    tradingMode: "OANDA_DEMO",
    executionGateVerified: true,
    mainDecision: { action: "UNKNOWN", confidence: 99, reasoning: "bad" }
  });
  assert.equal(invalidAction.main.action, "HOLD");
  assert.equal(invalidAction.inverse.action, "HOLD");
  assert.equal(invalidAction.executionBlockedReason, "INVALID_MAIN_ACTION");

  const stale = snapshot({
    tradingMode: "OANDA_DEMO",
    executionGateVerified: true,
    market: { ...market, time: "", tradeable: false }
  });
  assert.equal(stale.main.selectedForExecution, false);
  assert.equal(stale.marketValid, false);
  assert.equal(stale.executionBlockedReason, "OANDA_SIGNAL_SNAPSHOT_NOT_TRADEABLE_OR_FRESH");

  const wrongInstrument = snapshot({
    tradingMode: "OANDA_DEMO",
    executionGateVerified: true,
    market: { ...market, instrument: "GBPUSD" }
  });
  assert.equal(wrongInstrument.main.selectedForExecution, false);
  assert.equal(wrongInstrument.executionBlockedReason, "OANDA_SIGNAL_SNAPSHOT_NOT_TRADEABLE_OR_FRESH");
});
