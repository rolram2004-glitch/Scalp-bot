const axios = require("axios");
const config = require("./config");

function normalizeOandaSymbol(symbol) {
  let normalized = String(symbol).toUpperCase().replace(/[^A-Z0-9]/g, '_').replace(/__+/g, '_').trim();
  if (!normalized.includes('_') && normalized.length === 6) {
    normalized = `${normalized.slice(0, 3)}_${normalized.slice(3)}`;
  }
  return normalized;
}

class OandaAPI {
  constructor() {
    this.baseURL = "https://api-fxpractice.oanda.com/v3";

    this.headers = {
      Authorization: `Bearer ${config.OANDA_API_KEY}`,
      "Content-Type": "application/json"
    };

    this.lastError = null;
  }

  rememberError(scope, error) {
    this.lastError = {
      scope,
      status: error?.response?.status || null,
      code: error?.code || null,
      message: error?.response?.data?.errorMessage || error?.response?.data?.message || error?.message || "unknown_error"
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
      console.error("OANDA Price Error:", error.message);
      return null;
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
      console.error("OANDA Candle Error:", error.message);
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
      console.error("OANDA Account Error:", error.message);
      return null;
    }
  }

  async getOpenTrades() {
    const response = await axios.get(`${this.baseURL}/accounts/${config.OANDA_ACCOUNT_ID}/openTrades`, { headers: this.headers });
    return response.data.trades || [];
  }

  async getOpenPositions() {
    const response = await axios.get(`${this.baseURL}/accounts/${config.OANDA_ACCOUNT_ID}/openPositions`, { headers: this.headers });
    return response.data.positions || [];
  }

  async getTrade(tradeId) {
    const response = await axios.get(`${this.baseURL}/accounts/${config.OANDA_ACCOUNT_ID}/trades/${tradeId}`, { headers: this.headers });
    return response.data.trade || null;
  }

  async createMarketOrder({ instrument, side, units, stopLoss, takeProfit, clientTag }) {
    if (config.TRADING_MODE !== "LIVE" || !config.LIVE_TRADING_ENABLED) {
      throw new Error("LIVE_ORDER_BLOCKED_BY_CONFIGURATION");
    }
    const signedUnits = Math.abs(Number(units)) * (side === "SELL" ? -1 : 1);
    const order = {
      type: "MARKET", instrument: normalizeOandaSymbol(instrument), units: String(signedUnits),
      timeInForce: "FOK", positionFill: "DEFAULT",
      clientExtensions: clientTag ? { tag: String(clientTag).slice(0, 128) } : undefined,
      stopLossOnFill: Number.isFinite(Number(stopLoss)) ? { price: String(stopLoss), timeInForce: "GTC" } : undefined,
      takeProfitOnFill: Number.isFinite(Number(takeProfit)) ? { price: String(takeProfit), timeInForce: "GTC" } : undefined
    };
    try {
      const response = await axios.post(`${this.baseURL}/accounts/${config.OANDA_ACCOUNT_ID}/orders`, { order }, { headers: this.headers });
      return response.data;
    } catch (error) {
      this.rememberError("create_order", error);
      throw error;
    }
  }

  async closeTrade(tradeId, units = "ALL") {
    if (config.TRADING_MODE !== "LIVE" || !config.LIVE_TRADING_ENABLED) throw new Error("LIVE_ORDER_BLOCKED_BY_CONFIGURATION");
    const response = await axios.put(`${this.baseURL}/accounts/${config.OANDA_ACCOUNT_ID}/trades/${tradeId}/close`, { units: String(units) }, { headers: this.headers });
    return response.data;
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
