"use strict";

require("dotenv").config();

const fs = require("fs");
const path = require("path");

const environment = String(process.env.OANDA_ENVIRONMENT || "PRACTICE").trim().toUpperCase();
const requestedMode = String(process.env.TRADING_MODE || "PAPER").trim().toUpperCase();
const hasPracticeCredentials = Boolean(
  String(process.env.OANDA_API_KEY || "").trim() &&
  String(process.env.OANDA_ACCOUNT_ID || "").trim()
);
const forcePaper = process.env.FORCE_PAPER_MODE === "true";
const hasOpenAiKey = Boolean(String(process.env.OPENAI_API_KEY || "").trim());

// Automatically use only the OANDA Practice account when valid demo credentials exist.
// This never promotes the service to OANDA_LIVE and never bypasses real-money safeguards.
if (
  environment === "PRACTICE" &&
  requestedMode !== "OANDA_LIVE" &&
  hasPracticeCredentials &&
  !forcePaper
) {
  process.env.TRADING_MODE = "OANDA_DEMO";
  process.env.OANDA_ORDER_EXECUTION_ENABLED = "true";
  process.env.LIVE_EXECUTION_VARIANT = ["MAIN", "INVERSE"].includes(
    String(process.env.LIVE_EXECUTION_VARIANT || "MAIN").trim().toUpperCase()
  )
    ? String(process.env.LIVE_EXECUTION_VARIANT || "MAIN").trim().toUpperCase()
    : "MAIN";
}

// Aggressive OANDA Practice profile. The bot scans all configured pairs twice per minute,
// while broker verification, one-position-per-symbol, open-position caps and SL/TP remain mandatory.
process.env.MAX_DAILY_TRADES = "1000";
process.env.MAX_NEW_TRADES_PER_CYCLE = "7";
process.env.MAX_OPEN_POSITIONS = "15";
process.env.SCAN_INTERVAL_MS = "30000";
process.env.POSITION_MANAGEMENT_INTERVAL_MS = "5000";
process.env.MIN_SIGNAL_CONFIDENCE = hasOpenAiKey ? "50" : "55";
process.env.NORMAL_STOP_LOSS_PIPS = "10";
process.env.NORMAL_TAKE_PROFIT_PIPS = "20";

if (hasOpenAiKey) {
  process.env.AI_PROVIDER = "OPENAI";
  process.env.AI_CONFIRMATION_REQUIRED = "true";
  process.env.AI_MIN_CONFIDENCE = String(process.env.AI_MIN_CONFIDENCE || "58");
  process.env.OPENAI_MODEL = String(process.env.OPENAI_MODEL || "gpt-5-mini");
}

// The original autonomous loop closed a verified OANDA position whenever a
// later scan returned HOLD or a weaker score. Broker-side SL/TP are authoritative.
const originalReadFileSync = fs.readFileSync.bind(fs);
const protectedExitMarker = "PROTECTED_EXIT_ONLY";
const signalExitStart = "      const sameSymbolIndex = botState.openTrades.findIndex((trade) => trade.symbol === symbol);";
const signalExitEnd = "      pushLog(\n        `[${symbol}] ${rankedDecision.action} | setup score";

function patchAutonomousBotSource(source) {
  let patched = source;

  if (!patched.includes(protectedExitMarker)) {
    const start = patched.indexOf(signalExitStart);
    if (start < 0) throw new Error("AUTONOMOUS_SIGNAL_EXIT_BLOCK_NOT_FOUND");
    const end = patched.indexOf(signalExitEnd, start);
    if (end <= start) throw new Error("AUTONOMOUS_SIGNAL_EXIT_END_NOT_FOUND");

    const replacement =
      "      // PROTECTED_EXIT_ONLY: a later HOLD/weak scan never closes an OANDA trade.\n" +
      "      // The verified broker Stop Loss and Take Profit manage the exit.\n\n";
    patched = patched.slice(0, start) + replacement + patched.slice(end);
  }

  const oldAiGate =
    "  const aiGateConfigured = config.AI_CONFIRMATION_REQUIRED !== true ||\n" +
    "    (config.AI_PROVIDER === \"GEMINI\" && Boolean(config.GEMINI_API_KEY));";
  const newAiGate =
    "  const aiGateConfigured = config.AI_CONFIRMATION_REQUIRED !== true ||\n" +
    "    ([\"GEMINI\", \"OPENAI\"].includes(String(config.AI_PROVIDER)) &&\n" +
    "      Boolean(config.GEMINI_API_KEY || config.OPENAI_API_KEY));";
  if (patched.includes(oldAiGate)) patched = patched.replace(oldAiGate, newAiGate);

  const oldAiBlocked =
    "config.AI_CONFIRMATION_REQUIRED === true &&\n" +
    "              (config.AI_PROVIDER !== \"GEMINI\" || !config.GEMINI_API_KEY)\n" +
    "              ? \"AI confirmation is required but Gemini is not configured\"";
  const newAiBlocked =
    "config.AI_CONFIRMATION_REQUIRED === true &&\n" +
    "              (![\"GEMINI\", \"OPENAI\"].includes(String(config.AI_PROVIDER)) ||\n" +
    "                !(config.GEMINI_API_KEY || config.OPENAI_API_KEY))\n" +
    "              ? \"AI confirmation is required but the selected provider is not configured\"";
  if (patched.includes(oldAiBlocked)) patched = patched.replace(oldAiBlocked, newAiBlocked);

  return patched;
}

fs.readFileSync = function protectedSourceRead(file, ...args) {
  const result = originalReadFileSync(file, ...args);
  if (!String(file || "").endsWith(`${path.sep}autonomous-bot.ts`)) return result;
  const text = Buffer.isBuffer(result) ? result.toString("utf8") : String(result);
  const patched = patchAutonomousBotSource(text);
  return Buffer.isBuffer(result) ? Buffer.from(patched, "utf8") : patched;
};

require("ts-node/register/transpile-only");

const config = require("./config");
const aiConfirmation = require("./ai-confirmation");
const { installOpenAiTradeBrain } = require("./openai-trade-brain");
const openAiBrainEnabled = installOpenAiTradeBrain({ aiConfirmation, config });

const oanda = require("./oanda");
const originalGetPrices = oanda.getPrices.bind(oanda);
const originalGetPrice = oanda.getPrice.bind(oanda);
const originalGetPricingContext = oanda.getPricingContext.bind(oanda);

function normalizeOandaSymbol(symbol) {
  const compact = String(symbol || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return compact.length === 6 ? `${compact.slice(0, 3)}_${compact.slice(3)}` : compact;
}

function finitePositive(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function conversionFactors(price, homeConversions, instrument, accountCurrency) {
  const quote = normalizeOandaSymbol(instrument).split("_")[1] || "";
  if (quote && quote === String(accountCurrency || "").toUpperCase()) return { loss: 1, gain: 1 };

  const directLoss = finitePositive(price?.quoteHomeConversionFactors?.negativeUnits);
  const directGain = finitePositive(price?.quoteHomeConversionFactors?.positiveUnits);
  if (directLoss && directGain) return { loss: directLoss, gain: directGain };

  const home = Array.isArray(homeConversions)
    ? homeConversions.find((item) => String(item?.currency || "").toUpperCase() === quote)
    : null;
  const loss = finitePositive(home?.accountLoss);
  const gain = finitePositive(home?.accountGain);
  return loss && gain ? { loss, gain } : null;
}

// Recover symbols one by one if a bulk OANDA pricing call fails. No synthetic prices.
oanda.getPrices = async function resilientGetPrices(symbols) {
  const requested = Array.isArray(symbols) ? symbols : [symbols];
  const bulk = await originalGetPrices(requested);
  if (Array.isArray(bulk) && bulk.length > 0) return bulk;
  const recovered = await Promise.all(
    requested.map(async (symbol) => {
      try { return await originalGetPrice(symbol); } catch (_error) { return null; }
    })
  );
  return recovered.filter(Boolean);
};

const pricingContextCache = new Map();
oanda.getPricingContext = async function cachedPricingContext(symbol) {
  const instrument = normalizeOandaSymbol(symbol);
  const cached = pricingContextCache.get(instrument);
  if (cached && Date.now() - cached.savedAt <= 5000) return cached.value;
  const value = await originalGetPricingContext(instrument);
  if (value?.price) pricingContextCache.set(instrument, { savedAt: Date.now(), value });
  return value;
};

const executionEngine = require("./execution-engine");
const originalExecuteVerifiedMarketOrder = executionEngine.executeVerifiedMarketOrder;

executionEngine.executeVerifiedMarketOrder = async function executeFixedPipMarketOrder(request) {
  const instrument = normalizeOandaSymbol(request?.symbol);
  if (!instrument || instrument.startsWith("XAU_")) return originalExecuteVerifiedMarketOrder(request);

  try {
    const [account, instrumentInfo, pricing] = await Promise.all([
      oanda.getAccount(),
      oanda.getAccountInstrument(instrument),
      oanda.getPricingContext(instrument)
    ]);
    if (!account?.currency || !instrumentInfo || !pricing?.price) {
      return { status: "REJECTED", reason: "FIXED_PIP_METADATA_UNAVAILABLE" };
    }

    const pipLocation = Number(instrumentInfo.pipLocation);
    const pipSize = Number.isInteger(pipLocation) && pipLocation >= -12 && pipLocation <= 0
      ? 10 ** pipLocation
      : instrument.endsWith("_JPY") ? 0.01 : 0.0001;
    const units = Math.abs(Number(request?.units));
    const factors = conversionFactors(pricing.price, pricing.homeConversions || [], instrument, account.currency);
    if (!Number.isFinite(units) || units <= 0 || !factors) {
      return { status: "REJECTED", reason: "FIXED_PIP_CONVERSION_UNAVAILABLE" };
    }

    const riskAmount = units * 10 * pipSize * factors.loss;
    const rewardAmount = units * 20 * pipSize * factors.gain;
    return originalExecuteVerifiedMarketOrder({ ...request, riskAmount, rewardAmount });
  } catch (error) {
    const reason = String(error?.message || "FIXED_PIP_PRECHECK_FAILED")
      .replace(/Bearer\s+[^\s,;]+/gi, "Bearer [REDACTED]")
      .slice(0, 160);
    return { status: "REJECTED", reason };
  }
};

console.log(
  `[BOOTSTRAP] mode=${process.env.TRADING_MODE || "PAPER"} environment=${environment} ` +
  `orders=${process.env.OANDA_ORDER_EXECUTION_ENABLED === "true" ? "enabled" : "disabled"} ` +
  `brain=${openAiBrainEnabled ? `OPENAI:${config.OPENAI_MODEL}` : "DETERMINISTIC"} ` +
  `scan=30s forex=15 confidence=${config.MIN_CONFIDENCE} maxNew=7 maxOpen=15 ` +
  "sl=10p tp=20p exits=SL_TP_ONLY maxDaily=1000"
);
