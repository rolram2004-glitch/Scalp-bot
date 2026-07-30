const requestedTradingMode = String(process.env.TRADING_MODE || "PAPER").trim().toUpperCase();
const tradingMode = ["PAPER", "OANDA_DEMO", "OANDA_LIVE"].includes(requestedTradingMode)
  ? requestedTradingMode
  : "PAPER";
const requestedOandaEnvironment = String(process.env.OANDA_ENVIRONMENT || "PRACTICE").trim().toUpperCase();
const oandaEnvironment = requestedOandaEnvironment === "LIVE" ? "LIVE" : "PRACTICE";
const oandaEnvironmentValid = tradingMode === "OANDA_LIVE"
  ? oandaEnvironment === "LIVE"
  : oandaEnvironment === "PRACTICE";
const orderExecutionEnabled = process.env.OANDA_ORDER_EXECUTION_ENABLED === "true";
const oandaLiveConfirmed = process.env.OANDA_LIVE_CONFIRMATION === "I_CONFIRM_REAL_MONEY";
const liveExecutionVariantRaw = String(process.env.LIVE_EXECUTION_VARIANT || "MAIN").trim().toUpperCase();
const liveExecutionVariantValid = liveExecutionVariantRaw === "MAIN" || liveExecutionVariantRaw === "INVERSE";
const aiProvider = String(process.env.AI_PROVIDER || "DISABLED").trim().toUpperCase() === "GEMINI"
  ? "GEMINI"
  : "DISABLED";
const geminiModelRaw = String(process.env.GEMINI_MODEL || "gemini-3.5-flash-lite").trim();
const geminiModel = /^gemini-[a-z0-9.-]+$/i.test(geminiModelRaw)
  ? geminiModelRaw
  : "gemini-3.5-flash-lite";

function boundedNumber(value, fallback, minimum, maximum, integer = false) {
  const parsed = Number(value);
  const finite = Number.isFinite(parsed) ? parsed : fallback;
  const normalized = integer ? Math.floor(finite) : finite;
  return Math.min(maximum, Math.max(minimum, normalized));
}

const liveModeRequested = tradingMode === "OANDA_DEMO" || tradingMode === "OANDA_LIVE";
const liveModeSafetyConfirmed = tradingMode === "OANDA_DEMO" || oandaLiveConfirmed;
const executionReady = Boolean(
  liveModeRequested &&
  oandaEnvironmentValid &&
  orderExecutionEnabled &&
  liveModeSafetyConfirmed
);

module.exports = {
  // 15 forex pairs plus XAUUSD as a separate analysis-only instrument.
  SYMBOLS: [
    "XAU_USD",
    "EUR_USD",
    "GBP_USD",
    "USD_JPY",
    "USD_CAD",
    "USD_CHF",
    "AUD_USD",
    "NZD_USD",
    "EUR_JPY",
    "GBP_JPY",
    "AUD_JPY",
    "EUR_GBP",
    "EUR_AUD",
    "EUR_CAD",
    "GBP_AUD",
    "GBP_CAD"
  ],

  TIMEFRAME: "M5",

  MAX_SPREAD: 35.0,
  MAX_OPEN_TRADES: boundedNumber(process.env.MAX_OPEN_POSITIONS, 15, 1, 15, true),
  MAX_NEW_TRADES_PER_CYCLE: boundedNumber(process.env.MAX_NEW_TRADES_PER_CYCLE, 7, 1, 7, true),
  MAX_TRADES_PER_SYMBOL: 1,
  MAX_DAILY_TRADES: boundedNumber(process.env.MAX_DAILY_TRADES, 1000, 1, 1000, true),
  NORMAL_STOP_LOSS_PIPS: boundedNumber(process.env.NORMAL_STOP_LOSS_PIPS, 10, 1, 100),
  NORMAL_TAKE_PROFIT_PIPS: boundedNumber(process.env.NORMAL_TAKE_PROFIT_PIPS, 20, 1, 200),

  // Aggressive demo threshold; trades are still opened only on qualifying signals.
  MIN_CONFIDENCE: boundedNumber(process.env.MIN_SIGNAL_CONFIDENCE, 60, 60, 100),

  SCAN_INTERVAL: boundedNumber(process.env.SCAN_INTERVAL_MS, 60_000, 60_000, 300_000, true),
  POSITION_MANAGEMENT_INTERVAL: boundedNumber(process.env.POSITION_MANAGEMENT_INTERVAL_MS, 10_000, 5_000, 20_000, true),

  RISK_PERCENT: boundedNumber(process.env.MAX_RISK_PERCENT, 0.25, 0.01, 5),
  MAX_DAILY_LOSS: boundedNumber(process.env.MAX_DAILY_LOSS, 50, 0.01, 100000),
  TRADING_MODE: tradingMode,
  OANDA_ENVIRONMENT: oandaEnvironment,
  OANDA_ENVIRONMENT_VALID: oandaEnvironmentValid,
  OANDA_ORDER_EXECUTION_ENABLED: orderExecutionEnabled,
  OANDA_LIVE_CONFIRMED: oandaLiveConfirmed,
  LIVE_TRADING_ENABLED: executionReady,
  LIVE_EXECUTION_VARIANT: liveExecutionVariantValid ? liveExecutionVariantRaw : "MAIN",
  LIVE_EXECUTION_VARIANT_VALID: liveExecutionVariantValid,
  DEFAULT_UNITS: boundedNumber(process.env.DEFAULT_UNITS, 1000, 0.000001, 100000000),
  XAUUSD_UNITS: boundedNumber(process.env.XAUUSD_UNITS, 1, 0.000001, 1000000),
  NORMAL_STOP_LOSS_ACCOUNT: boundedNumber(
    process.env.NORMAL_STOP_LOSS_ACCOUNT ?? process.env.NORMAL_STOP_LOSS_USD,
    1.2,
    0.01,
    100000
  ),
  NORMAL_TAKE_PROFIT_ACCOUNT: boundedNumber(
    process.env.NORMAL_TAKE_PROFIT_ACCOUNT ?? process.env.NORMAL_TAKE_PROFIT_USD,
    2.4,
    0.01,
    100000
  ),
  NORMAL_STOP_LOSS_USD: boundedNumber(process.env.NORMAL_STOP_LOSS_USD, 1.2, 0.01, 100000),
  NORMAL_TAKE_PROFIT_USD: boundedNumber(process.env.NORMAL_TAKE_PROFIT_USD, 2.4, 0.01, 100000),
  XAUUSD_STOP_LOSS_AMOUNT: boundedNumber(process.env.XAUUSD_STOP_LOSS_AMOUNT, 7.5, 0.01, 100000),
  XAUUSD_TAKE_PROFIT_USD: boundedNumber(process.env.XAUUSD_TAKE_PROFIT_USD, 15, 0.01, 100000),

  OANDA_API_KEY: process.env.OANDA_API_KEY,
  OANDA_ACCOUNT_ID: process.env.OANDA_ACCOUNT_ID,

  AI_PROVIDER: aiProvider,
  AI_CONFIRMATION_REQUIRED: process.env.AI_CONFIRMATION_REQUIRED === "true",
  AI_MIN_CONFIDENCE: boundedNumber(process.env.AI_MIN_CONFIDENCE, 65, 0, 100),
  GEMINI_MODEL: geminiModel,
  GEMINI_API_KEY: process.env.GEMINI_API_KEY
};
