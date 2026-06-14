module.exports = {
  SYMBOLS: [
    "EUR_USD",
    "GBP_USD",
    "USD_JPY",
    "USD_CAD",
    "AUD_USD",
    "USD_CHF",
    "NZD_USD",
    "GBP_JPY",
    "EUR_JPY",
    "AUD_JPY",
    "NZD_JPY",
    "EUR_GBP",
    "EUR_AUD",
    "EUR_CAD",
    "GBP_AUD"
  ],

  TIMEFRAME: "M5",

  MAX_SPREAD: 2.0,
  MAX_OPEN_TRADES: 15,
  MAX_TRADES_PER_SYMBOL: 1,
  MAX_DAILY_TRADES: 50,

  MIN_CONFIDENCE: 0.65,

  SCAN_INTERVAL: 60000,

  RISK_PERCENT: 1,

  OANDA_API_KEY: process.env.OANDA_API_KEY,
  OANDA_ACCOUNT_ID: process.env.OANDA_ACCOUNT_ID
};
