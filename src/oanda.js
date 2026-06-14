const axios = require("axios");
const config = require("./config");

class OandaAPI {
  constructor() {
    this.baseURL = "https://api-fxpractice.oanda.com/v3";

    this.headers = {
      Authorization: `Bearer ${config.OANDA_API_KEY}`,
      "Content-Type": "application/json"
    };
  }

  async getPrice(symbol) {
    try {
      const response = await axios.get(
        `${this.baseURL}/accounts/${config.OANDA_ACCOUNT_ID}/pricing`,
        {
          headers: this.headers,
          params: {
            instruments: symbol
          }
        }
      );

      return response.data.prices[0];
    } catch (error) {
      console.error("OANDA Price Error:", error.message);
      return null;
    }
  }

  async getCandles(symbol, count = 200) {
    try {
      const response = await axios.get(
        `${this.baseURL}/instruments/${symbol}/candles`,
        {
          headers: this.headers,
          params: {
            granularity: config.TIMEFRAME,
            count
          }
        }
      );

      return response.data.candles;
    } catch (error) {
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
      console.error("OANDA Account Error:", error.message);
      return null;
    }
  }
}

module.exports = new OandaAPI();
