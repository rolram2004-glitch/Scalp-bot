const test = require("node:test");
const assert = require("node:assert/strict");

require("ts-node/register/transpile-only");

const { executeVerifiedMarketOrder } = require("../src/execution-engine");

function buildOandaMock(overrides = {}) {
  const calls = {
    getAccount: 0,
    getOpenTrades: 0,
    getOpenPositions: 0,
    getAccountInstrument: 0,
    getPricingContext: 0,
    createMarketOrder: 0,
    getTrade: 0
  };

  const values = {
    account: { id: "practice-account", currency: "CHF" },
    openTrades: [],
    openPositions: [],
    instrument: {
      name: "EUR_USD",
      displayPrecision: 5,
      tradeUnitsPrecision: 0,
      minimumTradeSize: "1"
    },
    pricing: {
      price: {
        instrument: "EUR_USD",
        status: "tradeable",
        tradeable: true,
        asks: [{ price: "1.10010" }],
        bids: [{ price: "1.10000" }],
        quoteHomeConversionFactors: {
          negativeUnits: "0.90000",
          positiveUnits: "0.91000"
        }
      },
      homeConversions: []
    },
    orderResponse: {
      orderCreateTransaction: { id: "100" },
      orderFillTransaction: {
        id: "101",
        time: "2026-07-14T12:00:00.000Z",
        tradeOpened: { tradeID: "200" }
      }
    },
    verifiedTrade: {
      id: "200",
      state: "OPEN",
      instrument: "EUR_USD",
      currentUnits: "1000",
      price: "1.10012",
      openTime: "2026-07-14T12:00:00.000Z"
    },
    ...overrides
  };

  const oanda = {
    async getAccount() {
      calls.getAccount += 1;
      return values.account;
    },
    async getOpenTrades() {
      calls.getOpenTrades += 1;
      return values.openTrades;
    },
    async getOpenPositions() {
      calls.getOpenPositions += 1;
      return values.openPositions;
    },
    async getAccountInstrument() {
      calls.getAccountInstrument += 1;
      return values.instrument;
    },
    async getPricingContext() {
      calls.getPricingContext += 1;
      return values.pricing;
    },
    async createMarketOrder(order) {
      calls.createMarketOrder += 1;
      calls.lastOrder = order;
      if (values.orderError) throw values.orderError;
      return values.orderResponse;
    },
    async getTrade(tradeId) {
      calls.getTrade += 1;
      calls.lastTradeId = tradeId;
      return values.verifiedTrade;
    }
  };

  return { oanda, calls };
}

function request(oanda, overrides = {}) {
  return {
    oanda,
    symbol: "EURUSD",
    side: "BUY",
    units: 1000,
    riskAmount: 1.2,
    rewardAmount: 2.4,
    ...overrides
  };
}

test("PAPER mode blocks createMarketOrder before any HTTP request", async () => {
  const axios = require("axios");
  const originalPost = axios.post;
  const oldMode = process.env.TRADING_MODE;
  const oldLiveEnabled = process.env.LIVE_TRADING_ENABLED;
  let postCalls = 0;

  try {
    process.env.TRADING_MODE = "PAPER";
    process.env.LIVE_TRADING_ENABLED = "false";
    axios.post = async () => {
      postCalls += 1;
      throw new Error("HTTP_MUST_NOT_BE_CALLED_IN_PAPER");
    };

    delete require.cache[require.resolve("../src/config")];
    delete require.cache[require.resolve("../src/oanda")];
    const paperOanda = require("../src/oanda");

    await assert.rejects(
      () => paperOanda.createMarketOrder({ instrument: "EUR_USD", side: "BUY", units: 1 }),
      /LIVE_ORDER_BLOCKED_BY_CONFIGURATION/
    );
    assert.equal(postCalls, 0);
  } finally {
    axios.post = originalPost;
    if (oldMode === undefined) delete process.env.TRADING_MODE;
    else process.env.TRADING_MODE = oldMode;
    if (oldLiveEnabled === undefined) delete process.env.LIVE_TRADING_ENABLED;
    else process.env.LIVE_TRADING_ENABLED = oldLiveEnabled;
    delete require.cache[require.resolve("../src/config")];
    delete require.cache[require.resolve("../src/oanda")];
  }
});

test("LIVE result is OPENED only after order ID, trade ID and OPEN trade re-read match", async () => {
  const { oanda, calls } = buildOandaMock();

  const result = await executeVerifiedMarketOrder(request(oanda));

  assert.equal(result.status, "OPENED");
  assert.equal(result.trade.oandaOrderId, "100");
  assert.equal(result.trade.oandaTradeId, "200");
  assert.equal(result.trade.source, "OANDA");
  assert.equal(result.trade.accountCurrency, "CHF");
  assert.equal(result.trade.entryPrice, 1.10012);
  assert.equal(calls.createMarketOrder, 1);
  assert.equal(calls.getTrade, 1);
  assert.equal(calls.lastTradeId, "200");
  assert.equal(calls.lastOrder.instrument, "EUR_USD");
  assert.equal(calls.lastOrder.stopLoss, "1.09877");
  assert.equal(calls.lastOrder.takeProfit, "1.10274");
});

test("an OANDA reject never returns a local trade", async () => {
  const { oanda, calls } = buildOandaMock({
    orderResponse: {
      orderRejectTransaction: { id: "300", rejectReason: "INSUFFICIENT_MARGIN" }
    }
  });

  const result = await executeVerifiedMarketOrder(request(oanda));

  assert.deepEqual(result, { status: "REJECTED", reason: "INSUFFICIENT_MARGIN" });
  assert.equal(Object.hasOwn(result, "trade"), false);
  assert.equal(calls.createMarketOrder, 1);
  assert.equal(calls.getTrade, 0);
});

for (const [label, orderResponse] of [
  ["order ID", { orderFillTransaction: { tradeOpened: { tradeID: "200" } } }],
  ["trade ID", { orderCreateTransaction: { id: "100" }, orderFillTransaction: {} }]
]) {
  test(`missing ${label} rejects without creating a local trade`, async () => {
    const { oanda, calls } = buildOandaMock({ orderResponse });

    const result = await executeVerifiedMarketOrder(request(oanda));

    assert.deepEqual(result, { status: "REJECTED", reason: "OANDA_FILL_NOT_VERIFIED" });
    assert.equal(Object.hasOwn(result, "trade"), false);
    assert.equal(calls.getTrade, 0);
  });
}

for (const [label, verifiedTrade] of [
  ["not OPEN", { state: "CLOSED", instrument: "EUR_USD", currentUnits: "1000" }],
  ["wrong instrument", { state: "OPEN", instrument: "GBP_USD", currentUnits: "1000" }],
  ["wrong units", { state: "OPEN", instrument: "EUR_USD", currentUnits: "999" }]
]) {
  test(`verified trade ${label} rejects without creating a local trade`, async () => {
    const { oanda, calls } = buildOandaMock({ verifiedTrade });

    const result = await executeVerifiedMarketOrder(request(oanda));

    assert.deepEqual(result, {
      status: "REJECTED",
      reason: "OANDA_TRADE_VERIFICATION_MISMATCH"
    });
    assert.equal(Object.hasOwn(result, "trade"), false);
    assert.equal(calls.getTrade, 1);
  });
}

for (const [label, exposure] of [
  ["open trade", { openTrades: [{ instrument: "EUR_USD", state: "OPEN" }] }],
  [
    "open position",
    {
      openPositions: [
        { instrument: "EUR_USD", long: { units: "1000" }, short: { units: "0" } }
      ]
    }
  ]
]) {
  test(`existing OANDA ${label} skips before order submission`, async () => {
    const { oanda, calls } = buildOandaMock(exposure);

    const result = await executeVerifiedMarketOrder(request(oanda));

    assert.deepEqual(result, {
      status: "SKIPPED",
      reason: "POSITION_ALREADY_OPEN_ON_OANDA"
    });
    assert.equal(calls.createMarketOrder, 0);
    assert.equal(calls.getTrade, 0);
  });
}
