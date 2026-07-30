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

// Authoritative aggressive-demo limits. These cannot be silently replaced by
// older Railway variables left from previous versions.
process.env.MAX_DAILY_TRADES = "1000";
process.env.MAX_NEW_TRADES_PER_CYCLE = "7";
process.env.MAX_OPEN_POSITIONS = "15";
process.env.SCAN_INTERVAL_MS = "60000";
process.env.MIN_SIGNAL_CONFIDENCE = "60";
process.env.NORMAL_STOP_LOSS_PIPS = "10";
process.env.NORMAL_TAKE_PROFIT_PIPS = "20";

// The original autonomous loop closed a verified OANDA position whenever a
// later scan returned HOLD or a weaker score. That produced the premature
// "Chiudi operazione" entries visible in OANDA. Patch only that block at load
// time: broker-side SL/TP remain authoritative; manual and emergency safety
// closures remain available.
const originalReadFileSync = fs.readFileSync.bind(fs);
const protectedExitMarker = "PROTECTED_EXIT_ONLY";
const signalExitStart = "      const sameSymbolIndex = botState.openTrades.findIndex((trade) => trade.symbol === symbol);";
const signalExitEnd = "      pushLog(";

function patchAutonomousBotSource(source) {
  if (source.includes(protectedExitMarker)) return source;

  const start = source.indexOf(signalExitStart);
  if (start < 0) {
    throw new Error("AUTONOMOUS_SIGNAL_EXIT_BLOCK_NOT_FOUND");
  }

  const end = source.indexOf(signalExitEnd, start);
  if (end <= start) {
    throw new Error("AUTONOMOUS_SIGNAL_EXIT_END_NOT_FOUND");
  }

  const replacement =
    "      // PROTECTED_EXIT_ONLY: a later HOLD/weak scan never closes an OANDA trade.\n" +
    "      // The verified broker Stop Loss and Take Profit manage the exit.\n\n";

  return source.slice(0, start) + replacement + source.slice(end);
}

fs.readFileSync = function protectedSourceRead(file, ...args) {
  const result = originalReadFileSync(file, ...args);
  if (!String(file || "").endsWith(`${path.sep}autonomous-bot.ts`)) return result;

  const text = Buffer.isBuffer(result) ? result.toString("utf8") : String(result);
  const patched = patchAutonomousBotSource(text);
  return Buffer.isBuffer(result) ? Buffer.from(patched, "utf8") : patched;
};

// execution-engine.ts is loaded here before autonomous-bot.ts so the verified
// fixed-pip wrapper is the implementation used by every later named import.
require("ts-node/register/transpile-only");

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
  if (quote && quote === String(accountCurrency || "").toUpperCase()) {
    return { loss: 1, gain: 1 };
  }

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

// A bulk pricing request can fail when one account instrument is temporarily
// unavailable. Recover symbols one by one without inventing prices.
oanda.getPrices = async function resilientGetPrices(symbols) {
  const requested = Array.isArray(symbols) ? symbols : [symbols];
  const bulk = await originalGetPrices(requested);
  if (Array.isArray(bulk) && bulk.length > 0) return bulk;

  const recovered = await Promise.all(
    requested.map(async (symbol) => {
      try {
        return await originalGetPrice(symbol);
      } catch (_error) {
        return null;
      }
    })
  );

  return recovered.filter(Boolean);
};

// Reuse the exact same OANDA pricing context between the fixed-pip calculation
// and the verified order engine. This prevents conversion drift between calls.
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
  if (!instrument || instrument.startsWith("XAU_")) {
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
    const factors = conversionFactors(
      pricing.price,
      pricing.homeConversions || [],
      instrument,
      account.currency
    );

    if (!Number.isFinite(units) || units <= 0 || !factors) {
      return { status: "REJECTED", reason: "FIXED_PIP_CONVERSION_UNAVAILABLE" };
    }

    const stopLossPips = 10;
    const takeProfitPips = 20;
    const riskAmount = units * stopLossPips * pipSize * factors.loss;
    const rewardAmount = units * takeProfitPips * pipSize * factors.gain;

    return originalExecuteVerifiedMarketOrder({
      ...request,
      riskAmount,
      rewardAmount
    });
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
  "scan=60s forex=15 confidence=60 maxNew=7 maxOpen=15 sl=10p tp=20p exits=SL_TP_ONLY maxDaily=1000"
);
