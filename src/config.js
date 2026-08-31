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
const liveExecutionVariantRaw = String(process.env.LIVE_EXECUTION_VARIANT || "").trim().toUpperCase();
const liveExecutionVariantValid = liveExecutionVariantRaw === "MAIN" || liveExecutionVariantRaw === "INVERSE";
// Direction and cash protection are independent. Both lanes use the requested
// Practice contract; runtime-bootstrap still pins live execution to MAIN so a
// BUY signal remains BUY and a SELL signal remains SELL.
const defaultAccountCashRisk = 0.1;
const defaultAccountCashReward = 0.6;
const requestedAiProvider = String(process.env.AI_PROVIDER || "DISABLED").trim().toUpperCase();
const aiProvider = ["GEMINI", "OPENAI"].includes(requestedAiProvider)
  ? requestedAiProvider
  : "DISABLED";
const requestedForexSignalProfile = String(
  process.env.FOREX_SIGNAL_PROFILE || (tradingMode === "OANDA_DEMO"
    ? "ROHATO_ULTRA_100_PER_MINUTE"
    : "ROHATO_AGGRESSIVE_100")
).trim().toUpperCase();
const forexSignalProfile = ["ROHATO_ULTRA_100_PER_MINUTE", "ROHATO_HYPER_100_PER_SYMBOL", "ROHATO_AGGRESSIVE_100", "AGGRESSIVE_25", "BALANCED"].includes(requestedForexSignalProfile)
  ? requestedForexSignalProfile
  : tradingMode === "OANDA_DEMO" ? "ROHATO_ULTRA_100_PER_MINUTE" : "ROHATO_AGGRESSIVE_100";
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
  liveExecutionVariantValid &&
  liveModeSafetyConfirmed
);
const maximumDailyTrades = tradingMode === "OANDA_LIVE"
  ? 25
  : tradingMode === "OANDA_DEMO"
    ? 15000
    : 100;
const maximumDailyTradesPerSymbol = tradingMode === "OANDA_LIVE" ? 25 : tradingMode === "OANDA_DEMO" ? 1000 : 100;
const hyperPracticeProfile = tradingMode === "OANDA_DEMO" &&
  ["ROHATO_ULTRA_100_PER_MINUTE", "ROHATO_HYPER_100_PER_SYMBOL"].includes(forexSignalProfile);
const ultraPracticeProfile = tradingMode === "OANDA_DEMO" &&
  forexSignalProfile === "ROHATO_ULTRA_100_PER_MINUTE";
// This deployment intentionally has no account-level daily loss stop on the
// OANDA Practice account. PAPER and, especially, OANDA_LIVE always keep it.
// The mode check is hard-coded so a stale environment variable can never
// disable the real-money protection.
const dailyLossLimitEnabled = tradingMode !== "OANDA_DEMO";

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
  MAX_NEW_TRADES_PER_CYCLE: boundedNumber(
    process.env.MAX_NEW_TRADES_PER_CYCLE,
    hyperPracticeProfile ? 15 : 7,
    1,
    hyperPracticeProfile ? 15 : 7,
    true
  ),
  MAX_TRADES_PER_SYMBOL: 1,
  // Practice can run up to 1,000 entries per each of the 15 executable FX
  // symbols. PAPER remains at 100 total and real money remains hard-capped at 25.
  MAX_DAILY_TRADES: boundedNumber(
    process.env.MAX_DAILY_TRADES,
    tradingMode === "OANDA_DEMO" ? 15000 : tradingMode === "OANDA_LIVE" ? 25 : 100,
    1,
    maximumDailyTrades,
    true
  ),
  MAX_DAILY_TRADES_PER_SYMBOL: boundedNumber(
    process.env.MAX_DAILY_TRADES_PER_SYMBOL,
    maximumDailyTradesPerSymbol,
    1,
    maximumDailyTradesPerSymbol,
    true
  ),
  MAX_TRADES_PER_MINUTE: boundedNumber(
    process.env.MAX_TRADES_PER_MINUTE,
    ultraPracticeProfile ? 100 : tradingMode === "OANDA_LIVE" ? 25 : 100,
    1,
    ultraPracticeProfile ? 100 : tradingMode === "OANDA_LIVE" ? 25 : 100,
    true
  ),
  NORMAL_STOP_LOSS_PIPS: boundedNumber(process.env.NORMAL_STOP_LOSS_PIPS, 10, 1, 100),
  NORMAL_TAKE_PROFIT_PIPS: boundedNumber(process.env.NORMAL_TAKE_PROFIT_PIPS, 20, 1, 200),

  // The hyper threshold applies only to OANDA Practice; other modes keep the
  // previous 50-point floor. Every candidate still passes broker and AI gates.
  MIN_CONFIDENCE: boundedNumber(
    process.env.MIN_SIGNAL_CONFIDENCE,
    hyperPracticeProfile ? 50 : 55,
    hyperPracticeProfile ? 45 : 50,
    100
  ),
  FOREX_SIGNAL_PROFILE: forexSignalProfile,

  SCAN_INTERVAL: boundedNumber(
    process.env.SCAN_INTERVAL_MS,
    ultraPracticeProfile ? 1_000 : hyperPracticeProfile ? 10_000 : 30_000,
    ultraPracticeProfile ? 1_000 : hyperPracticeProfile ? 10_000 : 30_000,
    300_000,
    true
  ),
  POSITION_MANAGEMENT_INTERVAL: boundedNumber(process.env.POSITION_MANAGEMENT_INTERVAL_MS, 10_000, 5_000, 20_000, true),
  SYMBOL_REENTRY_COOLDOWN_MS: boundedNumber(
    process.env.SYMBOL_REENTRY_COOLDOWN_MS,
    10 * 60 * 1000,
    0,
    60 * 60 * 1000,
    true
  ),

  RISK_PERCENT: boundedNumber(process.env.MAX_RISK_PERCENT, 0.25, 0.01, 5),
  DAILY_LOSS_LIMIT_ENABLED: dailyLossLimitEnabled,
  MAX_DAILY_LOSS: boundedNumber(process.env.MAX_DAILY_LOSS, 50, 0.01, 100000),
  TRADING_MODE: tradingMode,
  OANDA_ENVIRONMENT: oandaEnvironment,
  OANDA_ENVIRONMENT_VALID: oandaEnvironmentValid,
  OANDA_ORDER_EXECUTION_ENABLED: orderExecutionEnabled,
  OANDA_LIVE_CONFIRMED: oandaLiveConfirmed,
  LIVE_TRADING_ENABLED: executionReady,
  LIVE_EXECUTION_VARIANT: liveExecutionVariantValid ? liveExecutionVariantRaw : "INVALID",
  LIVE_EXECUTION_VARIANT_VALID: liveExecutionVariantValid,
  DEFAULT_UNITS: boundedNumber(process.env.DEFAULT_UNITS, 1000, 0.000001, 100000000),
  XAUUSD_UNITS: boundedNumber(process.env.XAUUSD_UNITS, 1, 0.000001, 1000000),
  NORMAL_STOP_LOSS_ACCOUNT: boundedNumber(
    process.env.NORMAL_STOP_LOSS_ACCOUNT ?? process.env.NORMAL_STOP_LOSS_USD,
    defaultAccountCashRisk,
    0.01,
    100000
  ),
  NORMAL_TAKE_PROFIT_ACCOUNT: boundedNumber(
    process.env.NORMAL_TAKE_PROFIT_ACCOUNT ?? process.env.NORMAL_TAKE_PROFIT_USD,
    defaultAccountCashReward,
    0.01,
    100000
  ),
  NORMAL_STOP_LOSS_USD: boundedNumber(process.env.NORMAL_STOP_LOSS_USD, defaultAccountCashRisk, 0.01, 100000),
  NORMAL_TAKE_PROFIT_USD: boundedNumber(process.env.NORMAL_TAKE_PROFIT_USD, defaultAccountCashReward, 0.01, 100000),
  ACCOUNT_TARGET_CURRENCY: String(process.env.ACCOUNT_TARGET_CURRENCY || "CHF").trim().toUpperCase(),
  XAUUSD_STOP_LOSS_AMOUNT: boundedNumber(process.env.XAUUSD_STOP_LOSS_AMOUNT, 7.5, 0.01, 100000),
  XAUUSD_TAKE_PROFIT_USD: boundedNumber(process.env.XAUUSD_TAKE_PROFIT_USD, 15, 0.01, 100000),

  OANDA_API_KEY: process.env.OANDA_API_KEY,
  OANDA_ACCOUNT_ID: process.env.OANDA_ACCOUNT_ID,

  AI_PROVIDER: aiProvider,
  AI_CONFIRMATION_REQUIRED: process.env.AI_CONFIRMATION_REQUIRED === "true",
  AI_MIN_CONFIDENCE: boundedNumber(process.env.AI_MIN_CONFIDENCE, 65, 0, 100),
  GEMINI_MODEL: geminiModel,
  GEMINI_API_KEY: process.env.GEMINI_API_KEY,
  OPENAI_MODEL: String(process.env.OPENAI_MODEL || "gpt-5-mini").trim(),
  OPENAI_API_KEY: process.env.OPENAI_API_KEY
};
