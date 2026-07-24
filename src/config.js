const tradingMode = String(process.env.TRADING_MODE || "PAPER").toUpperCase() === "LIVE" ? "LIVE" : "PAPER";
const liveExecutionVariantRaw = String(process.env.LIVE_EXECUTION_VARIANT || "MAIN").trim().toUpperCase();
const liveExecutionVariantValid = liveExecutionVariantRaw === "MAIN" || liveExecutionVariantRaw === "INVERSE";

module.exports = {
  SYMBOLS: [
    "XAU_USD",
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

  MAX_SPREAD: 35.0,
  MAX_OPEN_TRADES: 15,
  MAX_NEW_TRADES_PER_CYCLE: Math.min(6, Math.max(1, Number(process.env.MAX_NEW_TRADES_PER_CYCLE || 6))),
  MAX_TRADES_PER_SYMBOL: 1,
  MAX_DAILY_TRADES: Math.max(1, Number(process.env.MAX_DAILY_TRADES || 50)),

  MIN_CONFIDENCE: Math.min(100, Math.max(0, Number(process.env.MIN_SIGNAL_CONFIDENCE || 65))),

  SCAN_INTERVAL: 2 * 60 * 1000,

  RISK_PERCENT: Number(process.env.MAX_RISK_PERCENT || 0.25),
  MAX_DAILY_LOSS: Number(process.env.MAX_DAILY_LOSS || 50),
  TRADING_MODE: tradingMode,
  LIVE_TRADING_ENABLED: tradingMode === "LIVE" && process.env.LIVE_TRADING_ENABLED === "true",
  LIVE_EXECUTION_VARIANT: liveExecutionVariantValid ? liveExecutionVariantRaw : "INVALID",
  LIVE_EXECUTION_VARIANT_VALID: liveExecutionVariantValid,
  DEFAULT_UNITS: Number(process.env.DEFAULT_UNITS || 1000),
  XAUUSD_UNITS: Number(process.env.XAUUSD_UNITS || 1),
  NORMAL_STOP_LOSS_ACCOUNT: Number(process.env.NORMAL_STOP_LOSS_ACCOUNT || process.env.NORMAL_STOP_LOSS_USD || 1.2),
  NORMAL_TAKE_PROFIT_ACCOUNT: Number(process.env.NORMAL_TAKE_PROFIT_ACCOUNT || process.env.NORMAL_TAKE_PROFIT_USD || 2.4),
  NORMAL_STOP_LOSS_USD: Number(process.env.NORMAL_STOP_LOSS_USD || 1.2),
  NORMAL_TAKE_PROFIT_USD: Number(process.env.NORMAL_TAKE_PROFIT_USD || 2.4),
  XAUUSD_STOP_LOSS_AMOUNT: Number(process.env.XAUUSD_STOP_LOSS_AMOUNT || 7.5),
  XAUUSD_TAKE_PROFIT_USD: Number(process.env.XAUUSD_TAKE_PROFIT_USD || 15),

  OANDA_API_KEY: process.env.OANDA_API_KEY,
  OANDA_ACCOUNT_ID: process.env.OANDA_ACCOUNT_ID
};
