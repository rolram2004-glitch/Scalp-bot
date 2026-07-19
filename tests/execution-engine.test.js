const test = require("node:test");
const assert = require("node:assert/strict");

require("ts-node/register/transpile-only");

const { executeVerifiedMarketOrder } = require("../src/execution-engine");
let requestSequence = 0;

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
      return {
        ...values.verifiedTrade,
        clientExtensions: Object.hasOwn(values.verifiedTrade || {}, "clientExtensions")
          ? values.verifiedTrade.clientExtensions
          : { tag: calls.lastOrder?.clientTag }
      };
    }
  };

  return { oanda, calls };
}

function request(oanda, overrides = {}) {
  requestSequence += 1;
  return {
    oanda,
    symbol: "EURUSD",
    side: "BUY",
    units: 1000,
    riskAmount: 1.2,
    rewardAmount: 2.4,
    strategyVariant: "MAIN",
    signalId: `SIG-TEST-${requestSequence}`,
    signalAt: new Date().toISOString(),
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

test("OANDA wrapper blocks a strategy variant that differs from configuration", async () => {
  const axios = require("axios");
  const originalPost = axios.post;
  const oldMode = process.env.TRADING_MODE;
  const oldLiveEnabled = process.env.LIVE_TRADING_ENABLED;
  const oldVariant = process.env.LIVE_EXECUTION_VARIANT;
  let postCalls = 0;

  try {
    process.env.TRADING_MODE = "LIVE";
    process.env.LIVE_TRADING_ENABLED = "true";
    process.env.LIVE_EXECUTION_VARIANT = "MAIN";
    axios.post = async () => {
      postCalls += 1;
      throw new Error("HTTP_MUST_NOT_BE_CALLED_FOR_WRONG_VARIANT");
    };

    delete require.cache[require.resolve("../src/config")];
    delete require.cache[require.resolve("../src/oanda")];
    const guardedOanda = require("../src/oanda");

    await assert.rejects(
      () => guardedOanda.createMarketOrder({
        instrument: "EUR_USD",
        side: "SELL",
        units: 1,
        strategyVariant: "INVERSE",
        clientTag: "GEMMO-INVERSE-SIG-TEST-WRONG-LANE"
      }),
      /LIVE_EXECUTION_VARIANT_BLOCKED_BY_CONFIGURATION/
    );
    assert.equal(postCalls, 0);
  } finally {
    axios.post = originalPost;
    if (oldMode === undefined) delete process.env.TRADING_MODE;
    else process.env.TRADING_MODE = oldMode;
    if (oldLiveEnabled === undefined) delete process.env.LIVE_TRADING_ENABLED;
    else process.env.LIVE_TRADING_ENABLED = oldLiveEnabled;
    if (oldVariant === undefined) delete process.env.LIVE_EXECUTION_VARIANT;
    else process.env.LIVE_EXECUTION_VARIANT = oldVariant;
    delete require.cache[require.resolve("../src/config")];
    delete require.cache[require.resolve("../src/oanda")];
  }
});

test("INVERSE SELL is tagged, verified and keeps its signal metadata", async () => {
  const { oanda, calls } = buildOandaMock({
    verifiedTrade: {
      id: "201",
      state: "OPEN",
      instrument: "EUR_USD",
      currentUnits: "-1000",
      price: "1.09998",
      openTime: "2026-07-19T10:11:12.000Z"
    },
    orderResponse: {
      orderCreateTransaction: { id: "110" },
      orderFillTransaction: {
        id: "111",
        time: "2026-07-19T10:11:12.000Z",
        tradeOpened: { tradeID: "201" }
      }
    }
  });

  const result = await executeVerifiedMarketOrder(request(oanda, {
    side: "SELL",
    strategyVariant: "INVERSE",
    signalId: "SIG-EURUSD-INVERSE-1",
    signalAt: "2026-07-19T10:11:12.000Z"
  }));

  assert.equal(result.status, "OPENED");
  assert.equal(result.trade.side, "SELL");
  assert.equal(result.trade.strategyVariant, "INVERSE");
  assert.equal(result.trade.signalId, "SIG-EURUSD-INVERSE-1");
  assert.equal(calls.lastOrder.clientTag, "GEMMO-INVERSE-SIG-EURUSD-INVERSE-1");
  assert.equal(calls.createMarketOrder, 1);
});

test("invalid variant fails before OANDA calls", async () => {
  const { oanda, calls } = buildOandaMock();
  const result = await executeVerifiedMarketOrder(request(oanda, {
    strategyVariant: "BOTH"
  }));

  assert.deepEqual(result, { status: "REJECTED", reason: "INVALID_STRATEGY_VARIANT" });
  assert.equal(calls.getAccount, 0);
  assert.equal(calls.createMarketOrder, 0);
});

test("missing variant or signal metadata fails before OANDA calls", async () => {
  const first = buildOandaMock();
  const missingVariant = await executeVerifiedMarketOrder(request(first.oanda, {
    strategyVariant: undefined
  }));
  assert.deepEqual(missingVariant, { status: "REJECTED", reason: "INVALID_STRATEGY_VARIANT" });
  assert.equal(first.calls.createMarketOrder, 0);

  const second = buildOandaMock();
  const missingSignal = await executeVerifiedMarketOrder(request(second.oanda, {
    signalId: ""
  }));
  assert.deepEqual(missingSignal, { status: "REJECTED", reason: "SIGNAL_ID_REQUIRED" });
  assert.equal(second.calls.createMarketOrder, 0);
});

test("trade tag mismatch rejects ownership verification", async () => {
  const { oanda, calls } = buildOandaMock({
    verifiedTrade: {
      id: "200",
      state: "OPEN",
      instrument: "EUR_USD",
      currentUnits: "1000",
      price: "1.10012",
      clientExtensions: { tag: "MANUAL-TRADE" }
    }
  });
  const result = await executeVerifiedMarketOrder(request(oanda));

  assert.deepEqual(result, { status: "REJECTED", reason: "OANDA_TRADE_VERIFICATION_MISMATCH" });
  assert.equal(calls.createMarketOrder, 1);
});

test("concurrent opposite requests on one symbol submit at most one OANDA order", async () => {
  const { oanda, calls } = buildOandaMock();
  const first = executeVerifiedMarketOrder(request(oanda, {
    strategyVariant: "MAIN",
    signalId: "SIG-CONCURRENT-MAIN"
  }));
  const second = executeVerifiedMarketOrder(request(oanda, {
    side: "SELL",
    strategyVariant: "INVERSE",
    signalId: "SIG-CONCURRENT-INVERSE"
  }));
  const results = await Promise.all([first, second]);

  assert.equal(results.filter((item) => item.status === "OPENED").length, 1);
  assert.equal(results.filter((item) => item.reason === "ORDER_SUBMISSION_ALREADY_IN_PROGRESS").length, 1);
  assert.equal(calls.createMarketOrder, 1);
});

test("a verified signal ID cannot submit twice", async () => {
  const { oanda, calls } = buildOandaMock();
  const order = request(oanda, {
    strategyVariant: "MAIN",
    signalId: "SIG-IDEMPOTENT-1"
  });

  const first = await executeVerifiedMarketOrder(order);
  const second = await executeVerifiedMarketOrder(order);

  assert.equal(first.status, "OPENED");
  assert.deepEqual(second, { status: "SKIPPED", reason: "SIGNAL_ALREADY_EXECUTED" });
  assert.equal(calls.createMarketOrder, 1);
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
