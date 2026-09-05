const test = require("node:test");
const assert = require("node:assert/strict");

require("ts-node/register/transpile-only");

const { executeVerifiedMarketOrder, executionTestUtils } = require("../src/execution-engine");
let requestSequence = 0;

function buildOandaMock(overrides = {}) {
  const calls = {
    getAccount: 0,
    getOpenTrades: 0,
    getOpenPositions: 0,
    getPendingOrders: 0,
    getAccountInstrument: 0,
    getPricingContext: 0,
    createMarketOrder: 0,
    replaceTradeDependentOrders: 0,
    getTrade: 0,
    closeTrade: 0
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
        time: new Date().toISOString(),
        asks: [{ price: "1.10010" }],
        bids: [{ price: "1.10009" }],
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
    assertAccountCashExecutionConfigured() {
      calls.assertAccountCashExecutionConfigured =
        (calls.assertAccountCashExecutionConfigured || 0) + 1;
      if (values.practiceGuardError) throw values.practiceGuardError;
      return true;
    },
    async getAccount() {
      calls.getAccount += 1;
      return values.account;
    },
    async getOpenTrades() {
      calls.getOpenTrades += 1;
      if (calls.createMarketOrder > 0 && Object.hasOwn(values, "postFillTrades")) {
        return typeof values.postFillTrades === "function"
          ? values.postFillTrades(calls)
          : values.postFillTrades;
      }
      return values.openTrades;
    },
    async getOpenPositions() {
      calls.getOpenPositions += 1;
      if (calls.createMarketOrder > 0) {
        if (Object.hasOwn(values, "postFillPositions")) return values.postFillPositions;
        const signedUnits = calls.lastOrder?.side === "SELL"
          ? -Number(calls.lastOrder?.units)
          : Number(calls.lastOrder?.units);
        return [{
          instrument: calls.lastOrder?.instrument,
          long: { units: String(Math.max(0, signedUnits)) },
          short: { units: String(Math.min(0, signedUnits)) }
        }];
      }
      return values.openPositions;
    },
    async getPendingOrders() {
      calls.getPendingOrders += 1;
      return values.pendingOrders || [];
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
    async replaceTradeDependentOrders(replacement) {
      calls.replaceTradeDependentOrders += 1;
      calls.lastReplacement = replacement;
      if (values.replaceError) throw values.replaceError;
      return values.replaceResponse || {
        stopLossOrderTransaction: { id: "302" },
        takeProfitOrderTransaction: { id: "303" },
        lastTransactionID: "303"
      };
    },
    async getTrade(tradeId) {
      calls.getTrade += 1;
      calls.lastTradeId = tradeId;
      if (calls.closed) {
        return {
          ...values.verifiedTrade,
          state: values.closeVerificationState || "CLOSED",
          closeTime: "2026-07-24T12:00:01.000Z"
        };
      }
      const verifiedTrade = calls.replaceTradeDependentOrders > 0 && Object.hasOwn(values, "postReplaceVerifiedTrade")
        ? typeof values.postReplaceVerifiedTrade === "function"
          ? values.postReplaceVerifiedTrade(calls)
          : values.postReplaceVerifiedTrade
        : values.verifiedTrade;
      const replacement = calls.lastReplacement;
      return {
        ...verifiedTrade,
        clientExtensions: Object.hasOwn(verifiedTrade || {}, "clientExtensions")
          ? verifiedTrade.clientExtensions
          : { tag: calls.lastOrder?.clientTag },
        stopLossOrder: Object.hasOwn(verifiedTrade || {}, "stopLossOrder")
          ? verifiedTrade.stopLossOrder
          : {
              id: replacement ? "302" : "300",
              state: "PENDING",
              price: replacement?.stopLoss ?? calls.lastOrder?.stopLoss
            },
        takeProfitOrder: Object.hasOwn(verifiedTrade || {}, "takeProfitOrder")
          ? verifiedTrade.takeProfitOrder
          : {
              id: replacement ? "303" : "301",
              state: "PENDING",
              price: replacement?.takeProfit ?? calls.lastOrder?.takeProfit
            }
      };
    },
    async closeTrade(tradeId, units) {
      calls.closeTrade += 1;
      calls.closedTradeId = tradeId;
      calls.closedUnits = units;
      if (values.closeError) throw values.closeError;
      calls.closed = true;
      return { orderFillTransaction: { tradesClosed: [{ tradeID: tradeId }] } };
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

function accountCashRequest(oanda, overrides = {}) {
  return request(oanda, {
    strategyVariant: "MAIN",
    protectionMode: "ACCOUNT_CASH",
    targetAccountCurrency: "CHF",
    riskAmount: 0.2,
    rewardAmount: 0.6,
    ...overrides
  });
}

function cashAtProtection(entry, stopLoss, takeProfit, units, lossFactor, gainFactor) {
  return {
    risk: Math.abs(entry - Number(stopLoss)) * units * lossFactor,
    reward: Math.abs(Number(takeProfit) - entry) * units * gainFactor
  };
}

function cashRoundingTolerance(displayPrecision, units, factor) {
  return 0.5 * 10 ** (-displayPrecision) * units * factor + 1e-10;
}

test("PAPER mode blocks createMarketOrder before any HTTP request", async () => {
  const axios = require("axios");
  const originalPost = axios.post;
  const oldMode = process.env.TRADING_MODE;
  const oldEnvironment = process.env.OANDA_ENVIRONMENT;
  const oldExecutionEnabled = process.env.OANDA_ORDER_EXECUTION_ENABLED;
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
      /OANDA_ORDER_BLOCKED_IN_PAPER/
    );
    assert.equal(postCalls, 0);
  } finally {
    axios.post = originalPost;
    if (oldMode === undefined) delete process.env.TRADING_MODE;
    else process.env.TRADING_MODE = oldMode;
    if (oldEnvironment === undefined) delete process.env.OANDA_ENVIRONMENT;
    else process.env.OANDA_ENVIRONMENT = oldEnvironment;
    if (oldExecutionEnabled === undefined) delete process.env.OANDA_ORDER_EXECUTION_ENABLED;
    else process.env.OANDA_ORDER_EXECUTION_ENABLED = oldExecutionEnabled;
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

test("missing verified protective orders never returns OPENED", async () => {
  const { oanda, calls } = buildOandaMock({
    verifiedTrade: {
      id: "200",
      state: "OPEN",
      instrument: "EUR_USD",
      currentUnits: "1000",
      price: "1.10012",
      openTime: "2026-07-14T12:00:00.000Z",
      stopLossOrder: null
    }
  });

  const result = await executeVerifiedMarketOrder(request(oanda));

  assert.deepEqual(result, {
    status: "REJECTED",
    reason: "OANDA_PROTECTIVE_ORDERS_NOT_VERIFIED_EXPOSURE_CLOSED"
  });
  assert.equal(calls.createMarketOrder, 1);
  assert.equal(calls.getTrade, 2);
  assert.equal(calls.closeTrade, 1);
  assert.equal(Object.hasOwn(result, "trade"), false);
});

test("OANDA wrapper blocks a strategy variant that differs from configuration", async () => {
  const axios = require("axios");
  const originalPost = axios.post;
  const oldMode = process.env.TRADING_MODE;
  const oldEnvironment = process.env.OANDA_ENVIRONMENT;
  const oldExecutionEnabled = process.env.OANDA_ORDER_EXECUTION_ENABLED;
  const oldLiveEnabled = process.env.LIVE_TRADING_ENABLED;
  const oldVariant = process.env.LIVE_EXECUTION_VARIANT;
  let postCalls = 0;

  try {
    process.env.TRADING_MODE = "OANDA_DEMO";
    process.env.OANDA_ENVIRONMENT = "PRACTICE";
    process.env.OANDA_ORDER_EXECUTION_ENABLED = "true";
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
    if (oldEnvironment === undefined) delete process.env.OANDA_ENVIRONMENT;
    else process.env.OANDA_ENVIRONMENT = oldEnvironment;
    if (oldExecutionEnabled === undefined) delete process.env.OANDA_ORDER_EXECUTION_ENABLED;
    else process.env.OANDA_ORDER_EXECUTION_ENABLED = oldExecutionEnabled;
    if (oldLiveEnabled === undefined) delete process.env.LIVE_TRADING_ENABLED;
    else process.env.LIVE_TRADING_ENABLED = oldLiveEnabled;
    if (oldVariant === undefined) delete process.env.LIVE_EXECUTION_VARIANT;
    else process.env.LIVE_EXECUTION_VARIANT = oldVariant;
    delete require.cache[require.resolve("../src/config")];
    delete require.cache[require.resolve("../src/oanda")];
  }
});

test("OANDA ACCOUNT_CASH Practice guard blocks real-money configuration before HTTP", async () => {
  const axios = require("axios");
  const originalPost = axios.post;
  const originalPut = axios.put;
  const old = {
    mode: process.env.TRADING_MODE,
    environment: process.env.OANDA_ENVIRONMENT,
    executionEnabled: process.env.OANDA_ORDER_EXECUTION_ENABLED,
    liveEnabled: process.env.LIVE_TRADING_ENABLED,
    liveConfirmation: process.env.OANDA_LIVE_CONFIRMATION,
    variant: process.env.LIVE_EXECUTION_VARIANT
  };
  let httpCalls = 0;

  try {
    process.env.TRADING_MODE = "OANDA_LIVE";
    process.env.OANDA_ENVIRONMENT = "LIVE";
    process.env.OANDA_ORDER_EXECUTION_ENABLED = "true";
    process.env.LIVE_TRADING_ENABLED = "true";
    process.env.OANDA_LIVE_CONFIRMATION = "I_CONFIRM_REAL_MONEY";
    process.env.LIVE_EXECUTION_VARIANT = "INVERSE";
    axios.post = axios.put = async () => {
      httpCalls += 1;
      throw new Error("HTTP_MUST_NOT_BE_CALLED_FOR_ACCOUNT_CASH_LIVE");
    };
    delete require.cache[require.resolve("../src/config")];
    delete require.cache[require.resolve("../src/oanda")];
    const liveOanda = require("../src/oanda");

    assert.throws(
      () => liveOanda.assertAccountCashExecutionConfigured(),
      /ACCOUNT_CASH_REQUIRES_OANDA_PRACTICE/
    );
    assert.equal(httpCalls, 0);
  } finally {
    axios.post = originalPost;
    axios.put = originalPut;
    for (const [key, value] of Object.entries({
      TRADING_MODE: old.mode,
      OANDA_ENVIRONMENT: old.environment,
      OANDA_ORDER_EXECUTION_ENABLED: old.executionEnabled,
      LIVE_TRADING_ENABLED: old.liveEnabled,
      OANDA_LIVE_CONFIRMATION: old.liveConfirmation,
      LIVE_EXECUTION_VARIANT: old.variant
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
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

test("strict MIRROR sends the swapped MAIN price levels unchanged to OANDA", async () => {
  const { oanda, calls } = buildOandaMock({
    verifiedTrade: {
      id: "202",
      state: "OPEN",
      instrument: "EUR_USD",
      currentUnits: "-1000",
      price: "1.09998",
      openTime: "2026-08-08T12:00:00.000Z"
    },
    orderResponse: {
      orderCreateTransaction: { id: "120" },
      orderFillTransaction: {
        id: "121",
        time: "2026-08-08T12:00:00.000Z",
        tradeOpened: { tradeID: "202" }
      }
    }
  });

  const result = await executeVerifiedMarketOrder(request(oanda, {
    side: "SELL",
    strategyVariant: "INVERSE",
    signalId: "SIG-MIRROR-LEVEL-SWAP",
    stopLossPrice: 1.1021,
    takeProfitPrice: 1.0991,
    riskAmount: 999,
    rewardAmount: 999
  }));

  assert.equal(result.status, "OPENED");
  assert.equal(calls.lastOrder.stopLoss, "1.10210");
  assert.equal(calls.lastOrder.takeProfit, "1.09910");
  assert.ok(Math.abs(result.trade.riskAmount - 1.809) < 1e-10);
  assert.ok(Math.abs(result.trade.rewardAmount - 0.9009) < 1e-10);
});

test("strict MIRROR rejects non-directional swapped levels before order submission", async () => {
  const { oanda, calls } = buildOandaMock();
  const result = await executeVerifiedMarketOrder(request(oanda, {
    side: "SELL",
    strategyVariant: "INVERSE",
    stopLossPrice: 1.099,
    takeProfitPrice: 1.101
  }));

  assert.deepEqual(result, { status: "REJECTED", reason: "EXPLICIT_PROTECTIVE_LEVELS_NOT_DIRECTIONAL" });
  assert.equal(calls.createMarketOrder, 0);
});

test("ACCOUNT_CASH conversion selects CHF identity, direct quote factors and home-conversion fallback", () => {
  assert.deepEqual(
    executionTestUtils.conversionFactors({}, [], "USD_CHF", "CHF"),
    { loss: 1, gain: 1 }
  );
  assert.deepEqual(
    executionTestUtils.conversionFactors({
      quoteHomeConversionFactors: { negativeUnits: "0.90000", positiveUnits: "0.91000" }
    }, [], "EUR_USD", "CHF"),
    { loss: 0.9, gain: 0.91 }
  );
  assert.deepEqual(
    executionTestUtils.conversionFactors({}, [
      { currency: "JPY", accountLoss: "0.00610", accountGain: "0.00600" }
    ], "USD_JPY", "CHF"),
    { loss: 0.0061, gain: 0.006 }
  );
  assert.equal(
    executionTestUtils.conversionFactors({
      quoteHomeConversionFactors: { negativeUnits: "0", positiveUnits: "0.91" }
    }, [{ currency: "JPY", accountLoss: "0.0061" }], "EUR_USD", "CHF"),
    null
  );
});

const fixedCashCases = [
  {
    label: "CHF quote identity",
    symbol: "USDCHF",
    instrument: "USD_CHF",
    displayPrecision: 5,
    ask: 0.90010,
    bid: 0.90000,
    lossFactor: 1,
    gainFactor: 1,
    expectedUnits: 1000,
    homeConversions: [],
    directFactors: undefined,
    expected: {
      BUY: { stopLoss: "0.89990", takeProfit: "0.90070" },
      SELL: { stopLoss: "0.90020", takeProfit: "0.89940" }
    }
  },
  {
    label: "direct OANDA quote-home conversion",
    symbol: "EURUSD",
    instrument: "EUR_USD",
    displayPrecision: 5,
    ask: 1.10010,
    bid: 1.10000,
    lossFactor: 0.9,
    gainFactor: 0.91,
    expectedUnits: 1000,
    homeConversions: [],
    directFactors: { negativeUnits: "0.90000", positiveUnits: "0.91000" },
    expected: {
      BUY: { stopLoss: "1.09988", takeProfit: "1.10076" },
      SELL: { stopLoss: "1.10022", takeProfit: "1.09934" }
    }
  },
  {
    label: "home-conversion fallback for JPY quote",
    symbol: "USDJPY",
    instrument: "USD_JPY",
    displayPrecision: 3,
    ask: 159.233,
    bid: 159.231,
    lossFactor: 0.0061,
    gainFactor: 0.006,
    expectedUnits: 1000,
    homeConversions: [{ currency: "JPY", accountLoss: "0.00610", accountGain: "0.00600" }],
    directFactors: undefined,
    expected: {
      BUY: { stopLoss: "159.200", takeProfit: "159.333" },
      SELL: { stopLoss: "159.264", takeProfit: "159.131" }
    }
  }
];

for (const cashCase of fixedCashCases) {
  for (const strategyVariant of ["MAIN", "INVERSE"]) {
    for (const side of ["BUY", "SELL"]) {
      test(`${strategyVariant} ACCOUNT_CASH ${side} fixes SL 0.20 CHF and TP 0.60 CHF using ${cashCase.label}`, async () => {
      const entry = side === "BUY" ? cashCase.ask : cashCase.bid;
      const signedUnits = side === "BUY" ? String(cashCase.expectedUnits) : String(-cashCase.expectedUnits);
      const { oanda, calls } = buildOandaMock({
        account: { id: "practice-account", currency: "CHF" },
        instrument: {
          name: cashCase.instrument,
          displayPrecision: cashCase.displayPrecision,
          tradeUnitsPrecision: 0,
          minimumTradeSize: "1"
        },
        pricing: {
          price: {
            instrument: cashCase.instrument,
            status: "tradeable",
            tradeable: true,
            time: new Date().toISOString(),
            asks: [{ price: cashCase.ask.toFixed(cashCase.displayPrecision) }],
            bids: [{ price: cashCase.bid.toFixed(cashCase.displayPrecision) }],
            quoteHomeConversionFactors: cashCase.directFactors
          },
          homeConversions: cashCase.homeConversions
        },
        verifiedTrade: {
          id: "cash-trade",
          state: "OPEN",
          instrument: cashCase.instrument,
          currentUnits: signedUnits,
          price: entry.toFixed(cashCase.displayPrecision),
          openTime: "2026-08-13T12:00:00.000Z"
        },
        orderResponse: {
          orderCreateTransaction: { id: "cash-order" },
          orderFillTransaction: {
            id: "cash-fill",
            time: "2026-08-13T12:00:00.000Z",
            tradeOpened: { tradeID: "cash-trade" }
          }
        }
      });

      const result = await executeVerifiedMarketOrder(accountCashRequest(oanda, {
        symbol: cashCase.symbol,
        side,
        strategyVariant
      }));

      assert.equal(result.status, "OPENED");
      assert.equal(calls.createMarketOrder, 1);
      assert.equal(calls.replaceTradeDependentOrders, 1);
      assert.equal(calls.getTrade, 2);
      assert.equal(calls.lastReplacement.tradeId, "cash-trade");
      assert.equal(calls.lastReplacement.strategyVariant, strategyVariant);
      assert.equal(String(calls.lastReplacement.stopLoss), cashCase.expected[side].stopLoss);
      assert.equal(String(calls.lastReplacement.takeProfit), cashCase.expected[side].takeProfit);

      const actual = cashAtProtection(
        entry,
        calls.lastReplacement.stopLoss,
        calls.lastReplacement.takeProfit,
        cashCase.expectedUnits,
        cashCase.lossFactor,
        cashCase.gainFactor
      );
      assert.ok(
        Math.abs(actual.risk - 0.2) <= cashRoundingTolerance(
          cashCase.displayPrecision,
          cashCase.expectedUnits,
          cashCase.lossFactor
        )
      );
      assert.ok(
        Math.abs(actual.reward - 0.6) <= cashRoundingTolerance(
          cashCase.displayPrecision,
          cashCase.expectedUnits,
          cashCase.gainFactor
        )
      );
      assert.ok(Math.abs(result.trade.riskAmount - actual.risk) < 1e-10);
      assert.ok(Math.abs(result.trade.rewardAmount - actual.reward) < 1e-10);
      assert.equal(result.trade.accountCurrency, "CHF");
      assert.equal(result.trade.strategyVariant, strategyVariant);
      assert.match(calls.lastOrder.clientTag, new RegExp(`^GEMMO-${strategyVariant}-SIG-`));
      assert.equal(calls.lastOrder.side, side);
      });
    }
  }
}

for (const side of ["BUY", "SELL"]) {
  test(`ACCOUNT_CASH ${side} reduces units when needed and preserves TP 0.60 / SL 0.20 CHF`, async () => {
    const expectedUnits = 27;
    const signedUnits = side === "BUY" ? String(expectedUnits) : String(-expectedUnits);
    const fillPrice = side === "BUY" ? "1.10400" : "1.10000";
    const { oanda, calls } = buildOandaMock({
      pricing: {
        price: {
          instrument: "EUR_USD",
          status: "tradeable",
          tradeable: true,
          time: new Date().toISOString(),
          asks: [{ price: "1.10400" }],
          bids: [{ price: "1.10000" }],
          quoteHomeConversionFactors: {
            negativeUnits: "0.90000",
            positiveUnits: "0.91000"
          }
        },
        homeConversions: []
      },
      verifiedTrade: {
        id: "adaptive-cash-trade",
        state: "OPEN",
        instrument: "EUR_USD",
        currentUnits: signedUnits,
        price: fillPrice,
        openTime: "2026-08-30T22:00:00.000Z"
      },
      orderResponse: {
        orderCreateTransaction: { id: "adaptive-cash-order" },
        orderFillTransaction: {
          id: "adaptive-cash-fill",
          time: "2026-08-30T22:00:00.000Z",
          tradeOpened: { tradeID: "adaptive-cash-trade" }
        }
      }
    });

    const result = await executeVerifiedMarketOrder(accountCashRequest(oanda, { side }));

    assert.equal(result.status, "OPENED");
    assert.equal(calls.lastOrder.side, side);
    assert.equal(calls.lastOrder.units, expectedUnits);
    assert.equal(result.trade.units, expectedUnits);
    assert.equal(calls.replaceTradeDependentOrders, 1);
    assert.ok(0.004 * expectedUnits * 0.9 <= 0.2 / 2);
    assert.ok(Math.abs(result.trade.riskAmount - 0.2) <= cashRoundingTolerance(5, expectedUnits, 0.9));
    assert.ok(Math.abs(result.trade.rewardAmount - 0.6) <= cashRoundingTolerance(5, expectedUnits, 0.91));
  });
}

for (const strategyVariant of ["MAIN", "INVERSE"]) {
  for (const side of ["BUY", "SELL"]) {
    test(`${strategyVariant} ${side} reduces size for the smaller restored cash target`, async () => {
      const expectedUnits = 185;
      const entry = side === "BUY" ? "1.10060" : "1.10000";
      const { oanda, calls } = buildOandaMock({
        pricing: {
          price: {
            instrument: "EUR_USD", status: "tradeable", tradeable: true,
            time: new Date().toISOString(),
            asks: [{ price: "1.10060" }], bids: [{ price: "1.10000" }],
            quoteHomeConversionFactors: { negativeUnits: "0.9", positiveUnits: "0.91" }
          },
          homeConversions: []
        },
        verifiedTrade: {
          id: "200", state: "OPEN", instrument: "EUR_USD",
          currentUnits: String(side === "BUY" ? expectedUnits : -expectedUnits),
          price: entry, openTime: new Date().toISOString()
        }
      });
      const result = await executeVerifiedMarketOrder(accountCashRequest(oanda, { side, strategyVariant }));
      assert.equal(result.status, "OPENED");
      assert.equal(calls.lastOrder.side, side);
      assert.equal(result.trade.strategyVariant, strategyVariant);
      assert.equal(result.trade.units, expectedUnits);
      assert.equal(calls.lastOrder.units, expectedUnits);
      assert.ok(0.0006 * 1000 * 0.9 > 0.2); // full size costs more than the restored SL
      assert.ok(0.0006 * expectedUnits * 0.9 <= 0.2 / 2);
      assert.ok(Math.abs(result.trade.riskAmount - 0.2) <= cashRoundingTolerance(5, expectedUnits, 0.9));
      assert.ok(Math.abs(result.trade.rewardAmount - 0.6) <= cashRoundingTolerance(5, expectedUnits, 0.91));
      assert.equal(calls.closeTrade, 0);
    });
  }
}

test("adaptive size respects the loss conversion when it exceeds the gain conversion", () => {
  const units = executionTestUtils.adaptivePracticeCashUnits(1000, 1, 0, 2, 1.1, 0.001, 0.33, 0.9);
  assert.ok(units <= 150);
  assert.ok(0.001 * units * 1.1 <= 0.33 / 2);
  assert.equal(executionTestUtils.adaptivePracticeCashUnits(1000, 200, 0, 2, 1.1, 0.001, 0.33, 0.9), null);
});

test("ACCOUNT_CASH skips when OANDA minimum units cannot protect both cash targets from spread", async () => {
  const { oanda, calls } = buildOandaMock({
    instrument: {
      name: "EUR_USD",
      displayPrecision: 5,
      tradeUnitsPrecision: 0,
      minimumTradeSize: "900"
    },
    pricing: {
      price: {
        instrument: "EUR_USD",
        status: "tradeable",
        tradeable: true,
        time: new Date().toISOString(),
        asks: [{ price: "1.10140" }],
        bids: [{ price: "1.10000" }],
        quoteHomeConversionFactors: {
          negativeUnits: "0.90000",
          positiveUnits: "0.91000"
        }
      },
      homeConversions: []
    }
  });

  const result = await executeVerifiedMarketOrder(accountCashRequest(oanda));

  assert.deepEqual(result, {
    status: "SKIPPED",
    reason: "ACCOUNT_CASH_SPREAD_TOO_WIDE_FOR_MINIMUM_UNITS"
  });
  assert.equal(calls.createMarketOrder, 0);
});

test("MAIN ACCOUNT_CASH recalculates protection from the verified post-fill entry", async () => {
  const { oanda, calls } = buildOandaMock({
    verifiedTrade: {
      id: "post-fill-cash",
      state: "OPEN",
      instrument: "EUR_USD",
      currentUnits: "1000",
      price: "1.10020",
      openTime: "2026-08-13T12:05:00.000Z"
    },
    orderResponse: {
      orderCreateTransaction: { id: "post-fill-order" },
      orderFillTransaction: {
        id: "post-fill-transaction",
        time: "2026-08-13T12:05:00.000Z",
        tradeOpened: { tradeID: "post-fill-cash" },
        homeConversionFactors: {
          lossQuoteHome: { factor: "0.80000" },
          gainQuoteHome: { factor: "0.82000" }
        }
      }
    }
  });

  const result = await executeVerifiedMarketOrder(accountCashRequest(oanda, { side: "BUY" }));

  assert.equal(result.status, "OPENED");
  assert.equal(calls.replaceTradeDependentOrders, 1);
  assert.equal(calls.getTrade, 2);
  assert.deepEqual(calls.lastReplacement, {
    tradeId: "post-fill-cash",
    stopLoss: "1.09995",
    takeProfit: "1.10093",
    strategyVariant: "MAIN"
  });
  assert.notEqual(calls.lastReplacement.stopLoss, calls.lastOrder.stopLoss);

  assert.notEqual(calls.lastReplacement.takeProfit, calls.lastOrder.takeProfit);

  const actual = cashAtProtection(1.10020, "1.09995", "1.10093", 1000, 0.8, 0.82);
  assert.ok(Math.abs(result.trade.riskAmount - actual.risk) < 1e-10);
  assert.ok(Math.abs(result.trade.rewardAmount - actual.reward) < 1e-10);
});

test("MAIN ACCOUNT_CASH rejects any units, cash target, or explicit-price override outside its fixed contract", async () => {
  for (const [overrides, reason] of [
    [{ units: 999 }, "ACCOUNT_CASH_UNITS_MUST_EQUAL_1000"],
    [{ riskAmount: 1.99 }, "ACCOUNT_CASH_TARGETS_INVALID"],
    [{ rewardAmount: 0.19 }, "ACCOUNT_CASH_TARGETS_INVALID"],
    [{ stopLossPrice: 1.099, takeProfitPrice: 1.101 }, "ACCOUNT_CASH_EXPLICIT_LEVELS_NOT_ALLOWED"]
  ]) {
    const { oanda, calls } = buildOandaMock();
    const result = await executeVerifiedMarketOrder(accountCashRequest(oanda, overrides));
    assert.deepEqual(result, { status: "REJECTED", reason });
    assert.equal(calls.getAccount, 0);
    assert.equal(calls.createMarketOrder, 0);
    assert.equal(calls.replaceTradeDependentOrders, 0);
  }
});

test("MAIN ACCOUNT_CASH rejects a non-CHF account before submitting an order", async () => {
  const { oanda, calls } = buildOandaMock({
    account: { id: "practice-account", currency: "USD" }
  });

  const result = await executeVerifiedMarketOrder(accountCashRequest(oanda));

  assert.deepEqual(result, { status: "REJECTED", reason: "ACCOUNT_TARGET_CURRENCY_MISMATCH" });
  assert.equal(calls.createMarketOrder, 0);
  assert.equal(calls.replaceTradeDependentOrders, 0);
});

test("MAIN ACCOUNT_CASH Practice guard blocks before every OANDA read or order", async () => {
  const { oanda, calls } = buildOandaMock({
    practiceGuardError: new Error("ACCOUNT_CASH_REQUIRES_OANDA_PRACTICE")
  });

  const result = await executeVerifiedMarketOrder(accountCashRequest(oanda));

  assert.deepEqual(result, {
    status: "REJECTED",
    reason: "ACCOUNT_CASH_REQUIRES_OANDA_PRACTICE"
  });
  assert.equal(calls.getAccount, 0);
  assert.equal(calls.getPricingContext, 0);
  assert.equal(calls.createMarketOrder, 0);
  assert.equal(calls.replaceTradeDependentOrders, 0);
});

test("MAIN ACCOUNT_CASH fails closed when quote-to-CHF conversion is incomplete", async () => {
  const { oanda, calls } = buildOandaMock({
    pricing: {
      price: {
        instrument: "EUR_USD",
        status: "tradeable",
        tradeable: true,
        time: new Date().toISOString(),
        asks: [{ price: "1.10010" }],
        bids: [{ price: "1.10000" }],
        quoteHomeConversionFactors: { negativeUnits: "0.90000" }
      },
      homeConversions: [{ currency: "USD", accountLoss: "0.90000" }]
    }
  });

  const result = await executeVerifiedMarketOrder(accountCashRequest(oanda));

  assert.deepEqual(result, { status: "REJECTED", reason: "QUOTE_TO_ACCOUNT_CONVERSION_UNAVAILABLE" });
  assert.equal(calls.createMarketOrder, 0);
  assert.equal(calls.replaceTradeDependentOrders, 0);
});

test("MAIN ACCOUNT_CASH fails before submission when fixed CHF protection collapses at price precision", async () => {
  const { oanda, calls } = buildOandaMock({
    account: { id: "practice-account", currency: "CHF" },
    instrument: {
      name: "USD_CHF",
      displayPrecision: 2,
      tradeUnitsPrecision: 0,
      minimumTradeSize: "1"
    },
    pricing: {
      price: {
        instrument: "USD_CHF",
        status: "tradeable",
        tradeable: true,
        time: new Date().toISOString(),
        asks: [{ price: "0.90" }],
        bids: [{ price: "0.90" }]
      },
      homeConversions: []
    }
  });

  const result = await executeVerifiedMarketOrder(accountCashRequest(oanda, {
    symbol: "USDCHF",
    side: "BUY",
    units: 1000
  }));

  assert.deepEqual(result, { status: "REJECTED", reason: "PROTECTIVE_LEVELS_INVALID_AFTER_ROUNDING" });
  assert.equal(calls.createMarketOrder, 0);
  assert.equal(calls.replaceTradeDependentOrders, 0);
});

test("MAIN ACCOUNT_CASH closes exposure when recalculated post-fill protection is not verified", async () => {
  const { oanda, calls } = buildOandaMock({
    verifiedTrade: {
      id: "cash-mismatch",
      state: "OPEN",
      instrument: "EUR_USD",
      currentUnits: "1000",
      price: "1.10020",
      openTime: "2026-08-13T12:10:00.000Z"
    },
    postReplaceVerifiedTrade: {
      id: "cash-mismatch",
      state: "OPEN",
      instrument: "EUR_USD",
      currentUnits: "1000",
      price: "1.10020",
      openTime: "2026-08-13T12:10:00.000Z",
      stopLossOrder: { id: "bad-sl", state: "PENDING", price: "1.09800" },
      takeProfitOrder: { id: "bad-tp", state: "PENDING", price: "1.10200" }
    },
    orderResponse: {
      orderCreateTransaction: { id: "cash-mismatch-order" },
      orderFillTransaction: {
        id: "cash-mismatch-fill",
        time: "2026-08-13T12:10:00.000Z",
        tradeOpened: { tradeID: "cash-mismatch" }
      }
    }
  });

  const result = await executeVerifiedMarketOrder(accountCashRequest(oanda, { side: "BUY" }));

  assert.equal(result.status, "REJECTED");
  assert.match(result.reason, /(CASH|PROTECTIVE).*EXPOSURE_CLOSED/);
  assert.equal(calls.createMarketOrder, 1);
  assert.equal(calls.replaceTradeDependentOrders, 1);
  assert.equal(calls.closeTrade, 1);
  assert.equal(Object.hasOwn(result, "trade"), false);
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

  assert.deepEqual(result, {
    status: "REJECTED",
    reason: "OANDA_TRADE_VERIFICATION_MISMATCH_EXPOSURE_CLOSED"
  });
  assert.equal(calls.createMarketOrder, 1);
  assert.equal(calls.closeTrade, 1);
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

for (const [label, orderResponse, reason, tradeReads, closeCalls] of [
  [
    "order ID",
    { orderFillTransaction: { tradeOpened: { tradeID: "200" } } },
    "OANDA_ORDER_ID_NOT_VERIFIED_EXPOSURE_CLOSED",
    1,
    1
  ],
  [
    "trade ID",
    { orderCreateTransaction: { id: "100" }, orderFillTransaction: {} },
    "OANDA_FILL_NOT_VERIFIED_EMERGENCY_CLOSE_NOT_VERIFIED",
    0,
    0
  ]
]) {
  test(`missing ${label} rejects without creating a local trade`, async () => {
    const { oanda, calls } = buildOandaMock({ orderResponse });

    const result = await executeVerifiedMarketOrder(request(oanda));

    assert.deepEqual(result, { status: "REJECTED", reason });
    assert.equal(Object.hasOwn(result, "trade"), false);
    assert.equal(calls.getTrade, tradeReads);
    assert.equal(calls.closeTrade, closeCalls);
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
      reason: "OANDA_TRADE_VERIFICATION_MISMATCH_EXPOSURE_CLOSED"
    });
    assert.equal(Object.hasOwn(result, "trade"), false);
    assert.equal(calls.getTrade, 2);
    assert.equal(calls.closeTrade, 1);
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

test("same-symbol pending entry order blocks submission but protective orders do not", async () => {
  const blocked = buildOandaMock({
    pendingOrders: [{
      id: "700",
      instrument: "EUR_USD",
      type: "LIMIT",
      state: "PENDING"
    }]
  });
  const blockedResult = await executeVerifiedMarketOrder(request(blocked.oanda));
  assert.deepEqual(blockedResult, {
    status: "SKIPPED",
    reason: "PENDING_ENTRY_ORDER_ALREADY_EXISTS_ON_OANDA"
  });
  assert.equal(blocked.calls.createMarketOrder, 0);

  const protectiveOnly = buildOandaMock({
    pendingOrders: [{
      id: "701",
      type: "STOP_LOSS",
      tradeID: "existing-trade-1",
      state: "PENDING"
    }]
  });
  const opened = await executeVerifiedMarketOrder(request(protectiveOnly.oanda));
  assert.equal(opened.status, "OPENED");
  assert.equal(protectiveOnly.calls.createMarketOrder, 1);
});

test("entry-capable pending orders without an instrument fail closed", async () => {
  const { oanda, calls } = buildOandaMock({
    pendingOrders: [{
      id: "702",
      type: "LIMIT",
      state: "PENDING"
    }]
  });

  const result = await executeVerifiedMarketOrder(request(oanda));

  assert.deepEqual(result, {
    status: "REJECTED",
    reason: "OANDA_PENDING_ORDER_DATA_INCOMPLETE"
  });
  assert.equal(calls.createMarketOrder, 0);
});

test("missing OANDA unit or price precision fails before submission", async () => {
  for (const instrument of [
    { name: "EUR_USD", displayPrecision: 5, minimumTradeSize: "1" },
    { name: "EUR_USD", tradeUnitsPrecision: 0, minimumTradeSize: "1" },
    { name: "EUR_USD", displayPrecision: 5, tradeUnitsPrecision: 0 }
  ]) {
    const { oanda, calls } = buildOandaMock({ instrument });
    const result = await executeVerifiedMarketOrder(request(oanda));
    assert.deepEqual(result, {
      status: "REJECTED",
      reason: "INSTRUMENT_METADATA_INCOMPLETE"
    });
    assert.equal(calls.createMarketOrder, 0);
  }
});

test("stale OANDA pricing context fails before submission", async () => {
  const { oanda, calls } = buildOandaMock({
    pricing: {
      price: {
        instrument: "EUR_USD",
        status: "tradeable",
        tradeable: true,
        time: "2020-01-01T00:00:00.000Z",
        asks: [{ price: "1.10010" }],
        bids: [{ price: "1.10000" }],
        quoteHomeConversionFactors: {
          negativeUnits: "0.90000",
          positiveUnits: "0.91000"
        }
      },
      homeConversions: []
    }
  });

  const result = await executeVerifiedMarketOrder(request(oanda));

  assert.deepEqual(result, {
    status: "REJECTED",
    reason: "OANDA_PRICING_SNAPSHOT_STALE"
  });
  assert.equal(calls.createMarketOrder, 0);
});

test("post-fill position mismatch is closed and never returned as a local trade", async () => {
  const { oanda, calls } = buildOandaMock({
    postFillPositions: [{
      instrument: "EUR_USD",
      long: { units: "999" },
      short: { units: "0" }
    }]
  });

  const result = await executeVerifiedMarketOrder(request(oanda));

  assert.deepEqual(result, {
    status: "REJECTED",
    reason: "OANDA_POSITION_VERIFICATION_MISMATCH_EXPOSURE_CLOSED"
  });
  assert.equal(Object.hasOwn(result, "trade"), false);
  assert.equal(calls.closeTrade, 1);
  assert.equal(calls.closedTradeId, "200");
  assert.equal(calls.closedUnits, "ALL");
});

test("missing fill trade ID is recovered by client tag and closed", async () => {
  const { oanda, calls } = buildOandaMock({
    orderResponse: {
      orderCreateTransaction: { id: "100" },
      orderFillTransaction: { id: "101", time: new Date().toISOString() }
    },
    postFillTrades: (currentCalls) => [{
      id: "205",
      state: "OPEN",
      instrument: "EUR_USD",
      currentUnits: "1000",
      clientExtensions: { tag: currentCalls.lastOrder.clientTag }
    }]
  });

  const result = await executeVerifiedMarketOrder(request(oanda));

  assert.deepEqual(result, {
    status: "REJECTED",
    reason: "OANDA_FILL_TRADE_ID_NOT_VERIFIED_EXPOSURE_CLOSED"
  });
  assert.equal(calls.closeTrade, 1);
  assert.equal(calls.closedTradeId, "205");
});

test("ambiguous order submission is reconciled and a matching exposure is closed", async () => {
  const { oanda, calls } = buildOandaMock({
    orderError: new Error("socket timeout"),
    postFillTrades: (currentCalls) => [{
      id: "206",
      state: "OPEN",
      instrument: "EUR_USD",
      currentUnits: "1000",
      clientExtensions: { tag: currentCalls.lastOrder.clientTag }
    }]
  });

  const result = await executeVerifiedMarketOrder(request(oanda));

  assert.deepEqual(result, {
    status: "REJECTED",
    reason: "OANDA_ORDER_SUBMISSION_OUTCOME_NOT_VERIFIED_EXPOSURE_CLOSED"
  });
  assert.equal(calls.closeTrade, 1);
  assert.equal(calls.closedTradeId, "206");
});

test("failed submission with verified zero exposure returns only the sanitized failure", async () => {
  const { oanda, calls } = buildOandaMock({
    orderError: new Error("socket timeout"),
    postFillTrades: [],
    postFillPositions: []
  });

  const result = await executeVerifiedMarketOrder(request(oanda));

  assert.deepEqual(result, { status: "REJECTED", reason: "socket timeout" });
  assert.equal(calls.closeTrade, 0);
});

test("failed emergency close is reported as unverified exposure and never as OPENED", async () => {
  const { oanda, calls } = buildOandaMock({
    verifiedTrade: {
      id: "200",
      state: "OPEN",
      instrument: "EUR_USD",
      currentUnits: "999",
      price: "1.10012",
      openTime: "2026-07-24T12:00:00.000Z"
    },
    closeError: new Error("close unavailable"),
    closeVerificationState: "OPEN"
  });

  const result = await executeVerifiedMarketOrder(request(oanda));

  assert.deepEqual(result, {
    status: "REJECTED",
    reason: "OANDA_TRADE_VERIFICATION_MISMATCH_EMERGENCY_CLOSE_NOT_VERIFIED"
  });
  assert.equal(Object.hasOwn(result, "trade"), false);
  assert.equal(calls.closeTrade, 1);
  assert.equal(calls.getTrade, 2);
});
