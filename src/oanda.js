const axios = require("axios");
const config = require("./config");

const PRACTICE_BASE_URL = "https://api-fxpractice.oanda.com/v3";

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
    this.baseURL = PRACTICE_BASE_URL;

    this.headers = {
      Authorization: `Bearer ${config.OANDA_API_KEY}`,
      "Content-Type": "application/json"
    };

    this.lastError = null;
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
        {
          headers: this.headers,
          params: {
            instruments: normalizeOandaSymbol(symbol)
          }
        }
      );

      return response.data.prices[0];
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
        {
          headers: this.headers,
          params: { instruments: instruments.join(",") },
          timeout: 8000
        }
      );
      return Array.isArray(response.data?.prices) ? response.data.prices : [];
    } catch (error) {
      this.rememberError("prices", error);
      return [];
    }
  }

  async getPricingContext(symbol) {
    try {
      const response = await axios.get(
        `${this.baseURL}/accounts/${config.OANDA_ACCOUNT_ID}/pricing`,
        {
          headers: this.headers,
          params: {
            instruments: normalizeOandaSymbol(symbol),
            includeHomeConversions: true
          }
        }
      );

      return {
        price: response.data?.prices?.[0] || null,
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
        {
          headers: this.headers,
          params: {
            granularity,
            count
          }
        }
      );

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
        {
          headers: this.headers
        }
      );

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
        {
          headers: this.headers,
          params: { instruments: normalizedSymbol }
        }
      );
      const instruments = Array.isArray(response.data?.instruments)
        ? response.data.instruments
        : [];

      return instruments.find((instrument) => instrument?.name === normalizedSymbol) || null;
    } catch (error) {
      this.rememberError("account_instrument", error);
      console.error("OANDA Account Instrument Error:", this.lastError.message);
      return null;
    }
  }

  async getOpenTrades() {
    try {
      const response = await axios.get(`${this.baseURL}/accounts/${config.OANDA_ACCOUNT_ID}/openTrades`, { headers: this.headers });
      return response.data.trades || [];
    } catch (error) {
      throw this.safeError("open_trades", error);
    }
  }

  async getClosedTrades(count = 50) {
    try {
      const response = await axios.get(`${this.baseURL}/accounts/${config.OANDA_ACCOUNT_ID}/trades`, {
        headers: this.headers,
        params: { state: "CLOSED", count: Math.min(100, Math.max(1, Number(count) || 50)) }
      });
      return response.data.trades || [];
    } catch (error) {
      throw this.safeError("closed_trades", error);
    }
  }

  async getOpenPositions() {
    try {
      const response = await axios.get(`${this.baseURL}/accounts/${config.OANDA_ACCOUNT_ID}/openPositions`, { headers: this.headers });
      return response.data.positions || [];
    } catch (error) {
      throw this.safeError("open_positions", error);
    }
  }

  async getTrade(tradeId) {
    try {
      const response = await axios.get(`${this.baseURL}/accounts/${config.OANDA_ACCOUNT_ID}/trades/${tradeId}`, { headers: this.headers });
      return response.data.trade || null;
    } catch (error) {
      throw this.safeError("trade", error);
    }
  }

  async createMarketOrder({ instrument, side, units, stopLoss, takeProfit, clientTag }) {
    if (config.TRADING_MODE !== "LIVE" || !config.LIVE_TRADING_ENABLED) {
      throw new Error("LIVE_ORDER_BLOCKED_BY_CONFIGURATION");
    }

    const normalizedInstrument = normalizeOandaSymbol(instrument);
    if (!normalizedInstrument) throw new TypeError("ORDER_INSTRUMENT_REQUIRED");

    const normalizedSide = normalizeOrderSide(side);
    const signedUnits = normalizeOrderUnits(units, normalizedSide);
    const normalizedStopLoss = normalizeOptionalPrice(stopLoss, "STOP_LOSS");
    const normalizedTakeProfit = normalizeOptionalPrice(takeProfit, "TAKE_PROFIT");
    const order = {
      type: "MARKET", instrument: normalizedInstrument, units: signedUnits,
      timeInForce: "FOK", positionFill: "DEFAULT",
      clientExtensions: clientTag ? { tag: String(clientTag).slice(0, 128) } : undefined,
      stopLossOnFill: normalizedStopLoss ? { price: normalizedStopLoss, timeInForce: "GTC" } : undefined,
      takeProfitOnFill: normalizedTakeProfit ? { price: normalizedTakeProfit, timeInForce: "GTC" } : undefined
    };
    try {
      const response = await axios.post(`${this.baseURL}/accounts/${config.OANDA_ACCOUNT_ID}/orders`, { order }, { headers: this.headers });
      const result = this.parseOrderResponse(response.data);

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
    if (config.TRADING_MODE !== "LIVE" || !config.LIVE_TRADING_ENABLED) throw new Error("LIVE_ORDER_BLOCKED_BY_CONFIGURATION");
    try {
      const response = await axios.put(`${this.baseURL}/accounts/${config.OANDA_ACCOUNT_ID}/trades/${tradeId}/close`, { units: String(units) }, { headers: this.headers });
      return response.data;
    } catch (error) {
      throw this.safeError("close_trade", error);
    }
  }

  async getConnectionStatus() {
    const hasCredentials = Boolean(config.OANDA_API_KEY && config.OANDA_ACCOUNT_ID);

    if (!hasCredentials) {
      return {
        connected: false,
        reason: "missing_credentials",
        mode: "practice"
      };
    }

    const account = await this.getAccount();

    if (!account || !(account.id || account.accountID || account.accountId)) {
      return {
        connected: false,
        reason: "account_unavailable",
        errorStatus: this.lastError?.status || null,
        errorCode: this.lastError?.code || null,
        errorMessage: this.lastError?.message || null,
        mode: "practice"
      };
    }

    return {
      connected: true,
      accountId: account.id || account.accountID || account.accountId,
      currency: account.currency,
      balance: account.balance,
      mode: "practice"
    };
  }
}

module.exports = new OandaAPI();
