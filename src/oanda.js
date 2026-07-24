const axios = require("axios");
const config = require("./config");

const PRACTICE_BASE_URL = "https://api-fxpractice.oanda.com/v3";
const LIVE_BASE_URL = "https://api-fxtrade.oanda.com/v3";
const REQUEST_TIMEOUT_MS = 8000;

function configuredBaseUrl() {
  return config.OANDA_ENVIRONMENT === "LIVE" ? LIVE_BASE_URL : PRACTICE_BASE_URL;
}

function assertOrderExecutionConfigured() {
  if (config.TRADING_MODE !== "OANDA_DEMO" && config.TRADING_MODE !== "OANDA_LIVE") {
    throw new Error("OANDA_ORDER_BLOCKED_IN_PAPER");
  }
  if (!config.OANDA_ORDER_EXECUTION_ENABLED || !config.LIVE_TRADING_ENABLED) {
    throw new Error("OANDA_ORDER_EXECUTION_NOT_ENABLED");
  }
  if (!config.OANDA_ENVIRONMENT_VALID) {
    throw new Error("OANDA_ENVIRONMENT_MODE_MISMATCH");
  }
  if (config.TRADING_MODE === "OANDA_DEMO" && config.OANDA_ENVIRONMENT !== "PRACTICE") {
    throw new Error("OANDA_DEMO_REQUIRES_PRACTICE_ENDPOINT");
  }
  if (config.TRADING_MODE === "OANDA_LIVE" &&
      (config.OANDA_ENVIRONMENT !== "LIVE" || !config.OANDA_LIVE_CONFIRMED)) {
    throw new Error("OANDA_LIVE_REQUIRES_EXPLICIT_REAL_MONEY_CONFIRMATION");
  }
}

function normalizeOandaSymbol(symbol) {
  let normalized = String(symbol).toUpperCase().replace(/[^A-Z0-9]/g, '_').replace(/__+/g, '_').trim();
  if (!normalized.includes('_') && normalized.length === 6) {
    normalized = `${normalized.slice(0, 3)}_${normalized.slice(3)}`;
  }
  return normalized;
}

function sanitizeText(value) {
  if (value === undefined || value === null) return null;

  let text = String(value);
  const apiKey = String(config.OANDA_API_KEY || "");

  if (apiKey) {
    text = text.split(apiKey).join("[REDACTED]");
  }

  return text
    .replace(/Bearer\s+[^\s,;]+/gi, "Bearer [REDACTED]")
    .slice(0, 500);
}

function normalizeOptionalPrice(value, fieldName) {
  if (value === undefined || value === null) return undefined;

  const price = typeof value === "string" ? value.trim() : String(value);
  if (!price) return undefined;

  const numericPrice = Number(price);
  if (!Number.isFinite(numericPrice) || numericPrice <= 0) {
    throw new TypeError(`${fieldName}_MUST_BE_A_POSITIVE_PRICE`);
  }

  // Keep caller-provided decimal precision (for example "1.08000").
  return price;
}

function normalizeOrderSide(side) {
  const normalized = String(side || "").toUpperCase();
  if (normalized !== "BUY" && normalized !== "SELL") {
    throw new TypeError("ORDER_SIDE_MUST_BE_BUY_OR_SELL");
  }
  return normalized;
}

function normalizeOrderUnits(units, side) {
  const numericUnits = Number(units);
  if (!Number.isFinite(numericUnits) || numericUnits <= 0) {
    throw new TypeError("ORDER_UNITS_MUST_BE_POSITIVE");
  }

  const absoluteUnits = Math.abs(numericUnits);
  return String(side === "SELL" ? -absoluteUnits : absoluteUnits);
}

class OandaAPI {
  constructor() {
    this.baseURL = configuredBaseUrl();

    this.headers = {
      Authorization: `Bearer ${config.OANDA_API_KEY}`,
      "Content-Type": "application/json"
    };

    this.lastError = null;
    this.lastSuccessAt = null;
  }

  requestOptions(options = {}) {
    return {
      ...options,
      headers: this.headers,
      timeout: REQUEST_TIMEOUT_MS,
      // OANDA is contacted directly; ambient proxy variables must not silently reroute credentials.
      proxy: false
    };
  }

  rememberSuccess() {
    this.lastError = null;
    this.lastSuccessAt = new Date().toISOString();
  }

  parseError(scope, error) {
    const data = error?.response?.data && typeof error.response.data === "object"
      ? error.response.data
      : {};
    const rejectTransaction = data.orderRejectTransaction || null;
    const cancelTransaction = data.orderCancelTransaction || null;
    const transaction = rejectTransaction || cancelTransaction;
    const rejectReason = sanitizeText(
      rejectTransaction?.rejectReason ||
      cancelTransaction?.reason ||
      data.errorCode ||
      null
    );
    const message = sanitizeText(
      data.errorMessage ||
      data.message ||
      rejectReason ||
      error?.message ||
      "unknown_error"
    );

    return {
      scope,
      status: error?.response?.status || null,
      code: sanitizeText(data.errorCode || error?.code || null),
      message,
      rejectReason,
      transactionId: sanitizeText(transaction?.id || null)
    };
  }

  rememberError(scope, error) {
    this.lastError = this.parseError(scope, error);
    return this.lastError;
  }

  safeError(scope, error) {
    const details = this.rememberError(scope, error);
    const safeError = new Error(details.message || "OANDA_REQUEST_FAILED");
    safeError.name = "OandaAPIError";
    safeError.scope = details.scope;
    safeError.status = details.status;
    safeError.code = details.code;
    safeError.rejectReason = details.rejectReason;
    safeError.transactionId = details.transactionId;
    return safeError;
  }

  parseOrderResponse(data) {
    const payload = data && typeof data === "object" ? data : {};
    const createTransaction = payload.orderCreateTransaction || null;
    const fillTransaction = payload.orderFillTransaction || null;
    const rejectTransaction = payload.orderRejectTransaction || null;
    const cancelTransaction = payload.orderCancelTransaction || null;
    const openedTrade = fillTransaction?.tradeOpened || null;
    const orderId = sanitizeText(createTransaction?.id || fillTransaction?.orderID || null);
    const tradeId = sanitizeText(openedTrade?.tradeID || null);

    let status = "UNVERIFIED";
    if (rejectTransaction) {
      status = "REJECTED";
    } else if (cancelTransaction) {
      status = "CANCELLED";
    } else if (orderId && tradeId) {
      status = "FILLED";
    } else if (fillTransaction) {
      status = "FILLED_WITHOUT_NEW_TRADE";
    } else if (createTransaction) {
      status = "CREATED_NOT_FILLED";
    }

    return {
      accepted: status === "FILLED",
      status,
      orderId,
      tradeId,
      fillTransactionId: sanitizeText(fillTransaction?.id || null),
      fillPrice: sanitizeText(openedTrade?.price || fillTransaction?.price || null),
      units: sanitizeText(openedTrade?.units || fillTransaction?.units || null),
      rejectReason: sanitizeText(
        rejectTransaction?.rejectReason ||
        payload.errorCode ||
        payload.errorMessage ||
        null
      ),
      rejectTransactionId: sanitizeText(rejectTransaction?.id || null),
      cancelReason: sanitizeText(cancelTransaction?.reason || null),
      lastTransactionId: sanitizeText(payload.lastTransactionID || null),
      relatedTransactionIds: Array.isArray(payload.relatedTransactionIDs)
        ? payload.relatedTransactionIDs.map((id) => sanitizeText(id)).filter(Boolean)
        : []
    };
  }

  async getPrice(symbol) {
    try {
      const response = await axios.get(
        `${this.baseURL}/accounts/${config.OANDA_ACCOUNT_ID}/pricing`,
        this.requestOptions({
          params: {
            instruments: normalizeOandaSymbol(symbol)
          }
        })
      );
      const price = response.data?.prices?.[0] || null;
      if (!price) throw new Error("OANDA_PRICE_RESPONSE_EMPTY");
      this.rememberSuccess();
      return price;
    } catch (error) {
      this.rememberError("price", error);
      console.error("OANDA Price Error:", this.lastError.message);
      return null;
    }
  }

  async getPrices(symbols) {
    const requested = Array.isArray(symbols) ? symbols : [symbols];
    const instruments = [...new Set(requested.map(normalizeOandaSymbol).filter(Boolean))];
    if (instruments.length === 0) return [];

    try {
      const response = await axios.get(
        `${this.baseURL}/accounts/${config.OANDA_ACCOUNT_ID}/pricing`,
        this.requestOptions({ params: { instruments: instruments.join(",") } })
      );
      if (!Array.isArray(response.data?.prices)) throw new Error("OANDA_PRICES_RESPONSE_INVALID");
      this.rememberSuccess();
      return response.data.prices;
    } catch (error) {
      this.rememberError("prices", error);
      return [];
    }
  }

  async getPricingContext(symbol) {
    try {
      const response = await axios.get(
        `${this.baseURL}/accounts/${config.OANDA_ACCOUNT_ID}/pricing`,
        this.requestOptions({
          params: {
            instruments: normalizeOandaSymbol(symbol),
            includeHomeConversions: true
          }
        })
      );
      if (!Array.isArray(response.data?.prices) || !response.data.prices[0]) {
        throw new Error("OANDA_PRICING_CONTEXT_EMPTY");
      }
      this.rememberSuccess();
      return {
        price: response.data.prices[0],
        homeConversions: Array.isArray(response.data?.homeConversions)
          ? response.data.homeConversions
          : []
      };
    } catch (error) {
      this.rememberError("pricing_context", error);
      console.error("OANDA Pricing Context Error:", this.lastError.message);
      return { price: null, homeConversions: [] };
    }
  }

  async getCandles(symbol, count = 200, granularity = config.TIMEFRAME) {
    try {
      const response = await axios.get(
        `${this.baseURL}/instruments/${normalizeOandaSymbol(symbol)}/candles`,
        this.requestOptions({
          params: {
            granularity,
            count
          }
        })
      );
      if (!Array.isArray(response.data?.candles)) throw new Error("OANDA_CANDLES_RESPONSE_INVALID");
      this.rememberSuccess();
      return response.data.candles;
    } catch (error) {
      this.rememberError("candles", error);
      console.error("OANDA Candle Error:", this.lastError.message);
      return [];
    }
  }

  async getAccount() {
    try {
      const response = await axios.get(
        `${this.baseURL}/accounts/${config.OANDA_ACCOUNT_ID}`,
        this.requestOptions()
      );
      if (!response.data?.account) throw new Error("OANDA_ACCOUNT_RESPONSE_EMPTY");
      this.rememberSuccess();
      return response.data.account;
    } catch (error) {
      this.rememberError("account", error);
      console.error("OANDA Account Error:", this.lastError.message);
      return null;
    }
  }

  async getAccountInstrument(symbol) {
    try {
      const normalizedSymbol = normalizeOandaSymbol(symbol);
      const response = await axios.get(
        `${this.baseURL}/accounts/${config.OANDA_ACCOUNT_ID}/instruments`,
        this.requestOptions({ params: { instruments: normalizedSymbol } })
      );
      const instruments = Array.isArray(response.data?.instruments)
        ? response.data.instruments
        : [];

      const instrument = instruments.find((item) => item?.name === normalizedSymbol) || null;
      if (!instrument) throw new Error("OANDA_ACCOUNT_INSTRUMENT_UNAVAILABLE");
      this.rememberSuccess();
      return instrument;
    } catch (error) {
      this.rememberError("account_instrument", error);
      console.error("OANDA Account Instrument Error:", this.lastError.message);
      return null;
    }
  }

  async getOpenTrades() {
    try {
      const response = await axios.get(`${this.baseURL}/accounts/${config.OANDA_ACCOUNT_ID}/openTrades`, this.requestOptions());
      if (!Array.isArray(response.data?.trades)) throw new Error("OANDA_OPEN_TRADES_RESPONSE_INVALID");
      this.rememberSuccess();
      return response.data.trades;
    } catch (error) {
      throw this.safeError("open_trades", error);
    }
  }

  async getClosedTrades(count = 50) {
    try {
      const response = await axios.get(`${this.baseURL}/accounts/${config.OANDA_ACCOUNT_ID}/trades`, {
        ...this.requestOptions(),
        params: { state: "CLOSED", count: Math.min(100, Math.max(1, Number(count) || 50)) }
      });
      if (!Array.isArray(response.data?.trades)) throw new Error("OANDA_CLOSED_TRADES_RESPONSE_INVALID");
      this.rememberSuccess();
      return response.data.trades;
    } catch (error) {
      throw this.safeError("closed_trades", error);
    }
  }

  async getOpenPositions() {
    try {
      const response = await axios.get(`${this.baseURL}/accounts/${config.OANDA_ACCOUNT_ID}/openPositions`, this.requestOptions());
      if (!Array.isArray(response.data?.positions)) throw new Error("OANDA_OPEN_POSITIONS_RESPONSE_INVALID");
      this.rememberSuccess();
      return response.data.positions;
    } catch (error) {
      throw this.safeError("open_positions", error);
    }
  }

  async getPendingOrders() {
    try {
      const response = await axios.get(`${this.baseURL}/accounts/${config.OANDA_ACCOUNT_ID}/pendingOrders`, this.requestOptions());
      if (!Array.isArray(response.data?.orders)) throw new Error("OANDA_PENDING_ORDERS_RESPONSE_INVALID");
      this.rememberSuccess();
      return response.data.orders;
    } catch (error) {
      throw this.safeError("pending_orders", error);
    }
  }

  async getTrade(tradeId) {
    try {
      const response = await axios.get(`${this.baseURL}/accounts/${config.OANDA_ACCOUNT_ID}/trades/${tradeId}`, this.requestOptions());
      if (!response.data?.trade) throw new Error("OANDA_TRADE_RESPONSE_EMPTY");
      this.rememberSuccess();
      return response.data.trade;
    } catch (error) {
      throw this.safeError("trade", error);
    }
  }

  async createMarketOrder({ instrument, side, units, stopLoss, takeProfit, clientTag, strategyVariant }) {
    assertOrderExecutionConfigured();
    if (!config.LIVE_EXECUTION_VARIANT_VALID || strategyVariant !== config.LIVE_EXECUTION_VARIANT) {
      throw new Error("LIVE_EXECUTION_VARIANT_BLOCKED_BY_CONFIGURATION");
    }
    if (!clientTag || !String(clientTag).startsWith(`GEMMO-${strategyVariant}-SIG-`)) {
      throw new Error("ORDER_CLIENT_TAG_REQUIRED");
    }

    const normalizedInstrument = normalizeOandaSymbol(instrument);
    if (!normalizedInstrument) throw new TypeError("ORDER_INSTRUMENT_REQUIRED");

    const normalizedSide = normalizeOrderSide(side);
    const signedUnits = normalizeOrderUnits(units, normalizedSide);
    const normalizedStopLoss = normalizeOptionalPrice(stopLoss, "STOP_LOSS");
    const normalizedTakeProfit = normalizeOptionalPrice(takeProfit, "TAKE_PROFIT");
    if (!normalizedStopLoss || !normalizedTakeProfit) {
      throw new TypeError("PROTECTIVE_ORDERS_REQUIRED");
    }
    const order = {
      type: "MARKET", instrument: normalizedInstrument, units: signedUnits,
      timeInForce: "FOK", positionFill: "DEFAULT",
      clientExtensions: clientTag ? { tag: String(clientTag).slice(0, 128) } : undefined,
      tradeClientExtensions: clientTag ? { tag: String(clientTag).slice(0, 128) } : undefined,
      stopLossOnFill: normalizedStopLoss ? { price: normalizedStopLoss, timeInForce: "GTC" } : undefined,
      takeProfitOnFill: normalizedTakeProfit ? { price: normalizedTakeProfit, timeInForce: "GTC" } : undefined
    };
    try {
      const response = await axios.post(`${this.baseURL}/accounts/${config.OANDA_ACCOUNT_ID}/orders`, { order }, this.requestOptions());
      const result = this.parseOrderResponse(response.data);
      this.lastSuccessAt = new Date().toISOString();

      if (!result.accepted) {
        this.lastError = {
          scope: "create_order",
          status: response.status || null,
          code: result.status,
          message: result.rejectReason || result.cancelReason || result.status,
          rejectReason: result.rejectReason || result.cancelReason || null,
          transactionId: result.rejectTransactionId || result.fillTransactionId || null
        };
      }

      // Preserve the existing raw OANDA transaction fields for callers while
      // also exposing the normalized, fail-closed execution summary.
      return { ...response.data, ...result };
    } catch (error) {
      if (error?.name === "OandaAPIError") throw error;
      throw this.safeError("create_order", error);
    }
  }

  async closeTrade(tradeId, units = "ALL") {
    assertOrderExecutionConfigured();
    try {
      const response = await axios.put(`${this.baseURL}/accounts/${config.OANDA_ACCOUNT_ID}/trades/${tradeId}/close`, { units: String(units) }, this.requestOptions());
      this.rememberSuccess();
      return response.data;
    } catch (error) {
      throw this.safeError("close_trade", error);
    }
  }

  async getConnectionStatus() {
    const hasCredentials = Boolean(config.OANDA_API_KEY && config.OANDA_ACCOUNT_ID);
    const mode = config.OANDA_ENVIRONMENT === "LIVE" ? "live" : "practice";
    const endpoint = this.baseURL;

    if (!hasCredentials) {
      return {
        connected: false,
        reason: "missing_credentials",
        mode,
        tradingMode: config.TRADING_MODE,
        endpoint
      };
    }

    const account = await this.getAccount();

    const returnedAccountId = account?.id || account?.accountID || account?.accountId;
    if (!account || !returnedAccountId) {
      return {
        connected: false,
        reason: "account_unavailable",
        errorStatus: this.lastError?.status || null,
        errorCode: this.lastError?.code || null,
        errorMessage: this.lastError?.message || null,
        mode,
        tradingMode: config.TRADING_MODE,
        endpoint
      };
    }
    if (String(returnedAccountId) !== String(config.OANDA_ACCOUNT_ID)) {
      return {
        connected: false,
        reason: "account_id_mismatch",
        mode,
        tradingMode: config.TRADING_MODE,
        endpoint
      };
    }
    if (!account.currency) {
      return {
        connected: false,
        reason: "account_currency_unavailable",
        mode,
        tradingMode: config.TRADING_MODE,
        endpoint
      };
    }

    return {
      connected: true,
      accountId: returnedAccountId,
      currency: account.currency,
      balance: account.balance,
      nav: account.NAV,
      unrealizedPL: account.unrealizedPL,
      openTradeCount: account.openTradeCount,
      openPositionCount: account.openPositionCount,
      marginAvailable: account.marginAvailable,
      state: account.state,
      mode,
      tradingMode: config.TRADING_MODE,
      endpoint,
      checkedAt: this.lastSuccessAt
    };
  }
}

module.exports = new OandaAPI();
