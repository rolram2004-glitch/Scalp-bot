const test = require("node:test");
const assert = require("node:assert/strict");

require("ts-node/register/transpile-only");

const { autonomousTestUtils } = require("../src/autonomous-bot");

test("only an owned GEMMO trade from the active lane may be auto-closed", () => {
  const base = {
    source: "OANDA",
    managedByBot: true,
    strategyVariant: "MAIN",
    clientTag: "GEMMO-MAIN-SIG-EURUSD-1",
    oandaTradeId: "123"
  };

  assert.equal(autonomousTestUtils.canAutoCloseOandaTrade(base, "MAIN"), true);
  assert.equal(autonomousTestUtils.canAutoCloseOandaTrade({ ...base, managedByBot: false }, "MAIN"), false);
  assert.equal(autonomousTestUtils.canAutoCloseOandaTrade({ ...base, clientTag: undefined }, "MAIN"), false);
  assert.equal(autonomousTestUtils.canAutoCloseOandaTrade(base, "INVERSE"), false);
});

test("verified previous-lane trades do not block MIRROR on unrelated symbols", () => {
  const previousMain = {
    source: "OANDA",
    managedByBot: true,
    strategyVariant: "MAIN",
    signalId: "SIG-EURUSD-1",
    clientTag: "GEMMO-MAIN-SIG-EURUSD-1",
    oandaTradeId: "123"
  };
  const currentMirror = {
    ...previousMain,
    strategyVariant: "INVERSE",
    signalId: "SIG-GBPUSD-2",
    clientTag: "GEMMO-INVERSE-SIG-GBPUSD-2",
    oandaTradeId: "456"
  };

  assert.equal(autonomousTestUtils.isVerifiedRohatoOandaTrade(previousMain), true);
  assert.equal(autonomousTestUtils.isVerifiedRohatoOandaTrade(currentMirror), true);
  assert.equal(autonomousTestUtils.hasUnverifiedOandaExposure([previousMain, currentMirror]), false);
});

test("manual or malformed OANDA exposure still blocks every new order", () => {
  const verified = {
    source: "OANDA",
    managedByBot: true,
    strategyVariant: "MAIN",
    signalId: "SIG-EURUSD-1",
    clientTag: "GEMMO-MAIN-SIG-EURUSD-1",
    oandaTradeId: "123"
  };

  assert.equal(autonomousTestUtils.hasUnverifiedOandaExposure([
    verified,
    { ...verified, managedByBot: false, clientTag: "MANUAL-TRADE", signalId: undefined }
  ]), true);
  assert.equal(autonomousTestUtils.hasUnverifiedOandaExposure([
    { ...verified, clientTag: "GEMMO-INVERSE-SIG-EURUSD-1" }
  ]), true);
});

test("GEMMO ownership parser rejects manual or malformed tags", () => {
  assert.deepEqual(autonomousTestUtils.parseGemmoClientTag("GEMMO-INVERSE-SIG-EURUSD-1"), {
    strategyVariant: "INVERSE",
    signalId: "SIG-EURUSD-1",
    clientTag: "GEMMO-INVERSE-SIG-EURUSD-1"
  });
  assert.equal(autonomousTestUtils.parseGemmoClientTag("MANUAL-TRADE"), null);
  assert.equal(autonomousTestUtils.parseGemmoClientTag("GEMMO-BOTH-SIG-1"), null);
});

test("paper entry and exit use opposite executable sides", () => {
  const market = { bid: 1.1, ask: 1.1002, closePrice: 1.1001 };
  assert.equal(autonomousTestUtils.paperExecutablePrice("BUY", market), 1.1002);
  assert.equal(autonomousTestUtils.paperExitPrice("BUY", market), 1.1);
  assert.equal(autonomousTestUtils.paperExecutablePrice("SELL", market), 1.1);
  assert.equal(autonomousTestUtils.paperExitPrice("SELL", market), 1.1002);
});

test("paper and shadow quote guard rejects stale or non-tradeable prices", () => {
  const fresh = {
    bid: 1.1,
    ask: 1.1002,
    time: new Date().toISOString(),
    tradeable: true
  };
  assert.equal(autonomousTestUtils.isFreshTradeableQuote(fresh), true);
  assert.equal(autonomousTestUtils.isFreshTradeableQuote({ ...fresh, tradeable: false }), false);
  assert.equal(autonomousTestUtils.isFreshTradeableQuote({
    ...fresh,
    time: new Date(Date.now() - 60000).toISOString()
  }), false);
  assert.equal(autonomousTestUtils.isFreshTradeableQuote({ ...fresh, ask: 1.099 }), false);
});

test("FX execution feed is ready without waiting for later-opening XAUUSD", () => {
  const quote = { bid: 1, ask: 1.0001, time: new Date().toISOString(), tradeable: true };
  const coverage = autonomousTestUtils.executionFeedCoverage({
    EURUSD: quote,
    GBPUSD: quote,
    XAUUSD: { ...quote, bid: 2000, ask: 2000.1 }
  }, ["EURUSD", "GBPUSD", "XAUUSD"]);

  assert.deepEqual(coverage, {
    covered: 2,
    expected: 2,
    latestTime: quote.time
  });
  assert.deepEqual(
    autonomousTestUtils.executionFeedCoverage({ XAUUSD: quote }, ["EURUSD", "XAUUSD"]),
    { covered: 0, expected: 1, latestTime: undefined }
  );
});

test("a fresh partial FX feed does not globally block valid symbols", () => {
  const now = Date.parse("2026-08-09T21:45:30.000Z");
  const base = {
    priceExpected: 15,
    lastPriceAt: "2026-08-09T21:45:29.000Z"
  };

  assert.equal(autonomousTestUtils.executionFeedOperational({
    ...base,
    priceFeedStatus: "PARTIAL",
    priceCoverage: 11
  }, now), true);
  assert.equal(autonomousTestUtils.executionFeedOperational({
    ...base,
    priceFeedStatus: "DISCONNECTED",
    priceCoverage: 11
  }, now), false);
  assert.equal(autonomousTestUtils.executionFeedOperational({
    ...base,
    priceFeedStatus: "PARTIAL",
    priceCoverage: 0
  }, now), false);
  assert.equal(autonomousTestUtils.executionFeedOperational({
    ...base,
    priceFeedStatus: "PARTIAL",
    priceCoverage: 11,
    lastPriceAt: "2026-08-09T21:44:00.000Z"
  }, now), false);
});

test("UTC daily cap counts entries only, not positions merely closed today", () => {
  const dateUTC = "2026-07-31";
  const trades = [
    { id: "today-open", openTime: "2026-07-31T08:00:00.000Z" },
    { id: "today-closed", openTime: "2026-07-31T09:00:00.000Z", closeTime: "2026-07-31T09:10:00.000Z" },
    { id: "today-closed", openTime: "2026-07-31T09:00:00.000Z", closeTime: "2026-07-31T09:10:00.000Z" },
    { id: "yesterday-entry", openTime: "2026-07-30T23:55:00.000Z", closeTime: "2026-07-31T00:05:00.000Z" }
  ];

  assert.equal(autonomousTestUtils.countUtcTradeEntries(trades, dateUTC), 2);
});

test("fixed pip plan respects JPY precision and keeps 1:2 risk reward", () => {
  const jpy = autonomousTestUtils.fixedPipPlan("USDJPY", 159.232, "BUY");
  assert.equal(jpy.riskPips, 10);
  assert.equal(jpy.rewardPips, 20);
  assert.ok(Math.abs(jpy.stopLoss - 159.132) < 1e-10);
  assert.ok(Math.abs(jpy.takeProfit - 159.432) < 1e-10);

  const eur = autonomousTestUtils.fixedPipPlan("EURUSD", 1.1, "SELL");
  assert.ok(Math.abs(eur.stopLoss - 1.101) < 1e-10);
  assert.ok(Math.abs(eur.takeProfit - 1.098) < 1e-10);
  assert.equal(autonomousTestUtils.normalizedR(-10, 10), -1);
  assert.equal(autonomousTestUtils.normalizedR(20, 10), 2);
});

test("strict MIRROR swaps MAIN risk and reward and preserves its explicit price levels", () => {
  assert.deepEqual(autonomousTestUtils.variantPipDefaults("MAIN"), { riskPips: 10, rewardPips: 20 });
  assert.deepEqual(autonomousTestUtils.variantPipDefaults("INVERSE"), { riskPips: 20, rewardPips: 10 });

  const mirror = autonomousTestUtils.laneProtectionPlan("EURUSD", 1.1, "SELL", 1.1021, 1.0991);
  assert.ok(mirror);
  assert.equal(mirror.stopLoss, 1.1021);
  assert.equal(mirror.takeProfit, 1.0991);
  assert.ok(Math.abs(mirror.riskPips - 21) < 1e-10);
  assert.ok(Math.abs(mirror.rewardPips - 9) < 1e-10);
  assert.equal(autonomousTestUtils.laneProtectionPlan("EURUSD", 1.1, "SELL", 1.099, 1.101), null);
});

test("symbol cooldown prevents immediate repeat entries", () => {
  const now = Date.parse("2026-07-31T12:00:00.000Z");
  const closed = [{ symbol: "GBPJPY", closedAt: "2026-07-31T11:55:00.000Z" }];
  assert.equal(autonomousTestUtils.symbolCooldownRemainingMs("GBP_JPY", closed, now), 5 * 60 * 1000);
  assert.equal(autonomousTestUtils.symbolCooldownRemainingMs("EURUSD", closed, now), 0);
});
