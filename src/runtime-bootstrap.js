"use strict";

require("dotenv").config();

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
  // The Practice laboratory now validates the user's strict mirror hypothesis:
  // MAIN SL -> INVERSE TP and MAIN TP -> INVERSE SL. Keep this selector
  // separate from OANDA_LIVE so a future real-money account still requires an
  // explicit LIVE_EXECUTION_VARIANT plus the existing live confirmation gate.
  const requestedPracticeVariant = String(process.env.PRACTICE_EXECUTION_VARIANT || "INVERSE")
    .trim()
    .toUpperCase();
  process.env.LIVE_EXECUTION_VARIANT = ["MAIN", "INVERSE"].includes(requestedPracticeVariant)
    ? requestedPracticeVariant
    : "INVERSE";
}

// ROHATO_AGGRESSIVE_100 is a Practice/PAPER laboratory profile. It scans all
// configured pairs twice per minute while broker verification, fixed SL/TP,
// one-position-per-symbol, cooldown and daily-loss protection remain mandatory.
// OANDA_LIVE is separately hard-capped by config.js.
process.env.MAX_DAILY_TRADES = requestedMode === "OANDA_LIVE" ? "25" : "100";
process.env.MAX_NEW_TRADES_PER_CYCLE = "7";
process.env.MAX_OPEN_POSITIONS = "15";
process.env.SCAN_INTERVAL_MS = "30000";
process.env.POSITION_MANAGEMENT_INTERVAL_MS = "5000";
process.env.SYMBOL_REENTRY_COOLDOWN_MS = "600000";
process.env.MIN_SIGNAL_CONFIDENCE = hasOpenAiKey ? "50" : "55";
process.env.FOREX_SIGNAL_PROFILE = "ROHATO_AGGRESSIVE_100";
process.env.NORMAL_STOP_LOSS_PIPS = "10";
process.env.NORMAL_TAKE_PROFIT_PIPS = "20";

if (hasOpenAiKey) {
  process.env.AI_PROVIDER = "OPENAI";
  process.env.AI_CONFIRMATION_REQUIRED = "true";
  process.env.AI_MIN_CONFIDENCE = String(process.env.AI_MIN_CONFIDENCE || "58");
  process.env.OPENAI_MODEL = String(process.env.OPENAI_MODEL || "gpt-5-mini");
}

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

  // Paired signals carry broker-price protective levels. Passing those through
  // preserves the strict mirror identity exactly instead of rebuilding a
  // second, non-equivalent 10/20 plan after the signal has been inverted.
  if (Number.isFinite(Number(request?.stopLossPrice)) && Number.isFinite(Number(request?.takeProfitPrice))) {
    return originalExecuteVerifiedMarketOrder(request);
  }

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

    const mirror = String(request?.strategyVariant || "").toUpperCase() === "INVERSE";
    const riskPips = mirror ? 20 : 10;
    const rewardPips = mirror ? 10 : 20;
    const riskAmount = units * riskPips * pipSize * factors.loss;
    const rewardAmount = units * rewardPips * pipSize * factors.gain;
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
  `profile=${config.FOREX_SIGNAL_PROFILE} scan=30s forex=15 confidence=${config.MIN_CONFIDENCE} ` +
  `maxNew=7 maxOpen=15 cooldown=10m MAIN=SL10/TP20 MIRROR=SL20/TP10 exits=SL_TP_ONLY maxDaily=${config.MAX_DAILY_TRADES}`
);
