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
